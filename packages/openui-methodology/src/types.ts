/**
 * 方法卡契约：内置通用分析思维的结构化定义。
 * 卡是纯数据资产——编排代码对「有几张卡、是什么卡」零感知。
 */

export interface MethodCard {
  /** 稳定 id（小写中划线，如 "pareto"）：execute 阶段按 id 匹配注入 */
  id: string;
  /** 方法名（中文，展示用） */
  name: string;
  /** 适用信号：一句话描述何时选这个方法 */
  when: string;
  /** 分析流程步骤（有序） */
  steps: string[];
  /** 图表配对：意图映射到组件库组件名（validateCards 校验存在性） */
  chartPairing: string[];
  /** execute 模式注入的展开指导（预算 ≤600B 渲染截断） */
  executeGuidance: string;
}

/** 卡 id 规范：小写字母开头，小写字母/数字/中划线，≤40 字符 */
export const METHOD_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
