import type { DynamicSourceConfig } from "../config";
import type { SchemaCard } from "./card";
import {
  readSchemaCard,
  writeSchemaCard,
  deleteSchemaCard,
} from "./store";

/**
 * Schema Card 生命周期状态机（从 manager 抽出的内聚模块）：
 * 三个按源 id 的私有状态（标脏集合 / 构建结果 / 串行链）+ 对外五个语义动作。
 *
 * - ensure：tools() 装配时惰性触发——无卡且从未尝试过才建（failed 熔断，
 *   防不可用源每次装配都触发失败洪水）
 * - invalidate：标脏 + 后台重建（配置变更 / 执行期列缺失 / 重灌共用；
 *   不幂等——连续失效各自入队，串行链合并并发）
 * - refresh：手动重建（返回完成 promise，明确的失败重试授权）
 * - drop：源删除时清理全部内存状态与落盘卡（防 id 复用读到旧卡 / 磁盘残留）
 *
 * 卡的「怎么构建」由调用方注入（manager 持有连接装配知识），
 * 本模块只管状态与落盘生命周期。
 */

export interface SchemaCardLifecycle {
  /** 读卡（stale=true 表示标脏重建中）；无卡/坏卡返回 null */
  get(id: string): Promise<{ card: SchemaCard; stale: boolean } | null>;
  /** tools 装配惰性触发（fire-and-forget，不阻塞装配） */
  ensure(source: DynamicSourceConfig): void;
  /** 标脏 + 后台重建（配置变更 / 执行期列缺失 / 重灌共用；不幂等，连续失效各自入队） */
  invalidate(source: DynamicSourceConfig): void;
  /**
   * 仅标脏不排队：供「连接缓存 key-change」场景——旧连接关闭前只标记，
   * 新连接建立后再 pumpIfDirty 触发（保持「重建不抢查询连接时序」的旧契约）
   */
  markDirty(source: DynamicSourceConfig): void;
  /** 标脏存在时触发后台重建（与 invalidate 的差异仅在不重复标脏） */
  pumpIfDirty(source: DynamicSourceConfig): void;
  /** 手动重建：排队串行执行，返回完成 promise（失败上抛由调用方处置） */
  refresh(source: DynamicSourceConfig): Promise<void>;
  /** 源删除：清三个内存状态 + 删落盘卡文件 */
  drop(id: string): void;
}

export function createSchemaCardLifecycle(opts: {
  cardsDir: string;
  buildCard: (source: DynamicSourceConfig) => Promise<SchemaCard>;
}): SchemaCardLifecycle {
  const { cardsDir, buildCard } = opts;
  /** 标脏集合：配置变更/执行期列缺失/重灌置位，重建成功后清除 */
  const dirty = new Set<string>();
  /** 构建结果：ok（新鲜）/ failed（最近一次失败，ensure 熔断直到新失效事件） */
  const buildState = new Map<string, "ok" | "failed">();
  /** 按源串行链：并发触发（装配/标脏/手动刷新）合并排队 */
  const chains = new Map<string, Promise<void>>();

  const scheduleBuild = (source: DynamicSourceConfig): void => {
    const prev = chains.get(source.id) ?? Promise.resolve();
    const task = prev
      .catch(() => {})
      .then(async () => {
        try {
          const card = await buildCard(source);
          await writeSchemaCard(cardsDir, card);
          dirty.delete(source.id);
          buildState.set(source.id, "ok");
        } catch (err) {
          dirty.delete(source.id);
          buildState.set(source.id, "failed");
          console.warn(
            `[schema-card] 重建失败（${source.id}）:`,
            err instanceof Error ? err.message : err
          );
        }
      });
    chains.set(source.id, task);
    // fire-and-forget：调用方（tools 装配/错误钩子）不等待
    task.catch(() => {});
  };

  return {
    async get(id) {
      const card = await readSchemaCard(cardsDir, id);
      if (!card) return null;
      return { card, stale: dirty.has(id) };
    },

    ensure(source) {
      void readSchemaCard(cardsDir, source.id)
        .then((card) => {
          const attempted = buildState.has(source.id);
          if (card === null && !attempted) {
            scheduleBuild(source); // 无卡且从未尝试 → 建一次
          } else if (dirty.has(source.id)) {
            scheduleBuild(source); // 标脏 → 重建
          }
        })
        .catch(() => {});
    },

    invalidate(source) {
      // 不做幂等短路：连续失效事件（如快速两次配置变更）需各自入队——
      // 串行链天然合并并发，重复构建代价小；用旧 source 引用构建才是风险
      dirty.add(source.id);
      buildState.delete(source.id); // 新失效事件 = 失败重试授权
      scheduleBuild(source);
    },

    markDirty(source) {
      dirty.add(source.id);
      buildState.delete(source.id);
    },

    pumpIfDirty(source) {
      if (dirty.has(source.id)) scheduleBuild(source);
    },

    refresh(source) {
      dirty.add(source.id);
      buildState.delete(source.id); // 手动刷新 = 明确的重试授权
      const prev = chains.get(source.id) ?? Promise.resolve();
      const task = prev
        .catch(() => {})
        .then(async () => {
          const card = await buildCard(source);
          await writeSchemaCard(cardsDir, card);
          dirty.delete(source.id);
          buildState.set(source.id, "ok");
        });
      chains.set(source.id, task);
      return task;
    },

    drop(id) {
      dirty.delete(id);
      buildState.delete(id);
      chains.delete(id);
      // 落盘卡删除：失败忽略（文件不存在即目标态）
      void deleteSchemaCard(cardsDir, id).catch(() => {});
    },
  };
}
