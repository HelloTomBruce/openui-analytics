"use client";

import React, { useState } from "react";
import { X, Sliders, Key, Globe, Bot, Database, ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DatasourceSettings } from "./datasources/DatasourceSettings";
import {
  CUSTOM_PROVIDER_ID,
  LLM_PROVIDER_PRESETS,
} from "@/lib/llmProviders";
import { useProviderCatalog } from "@/hooks/useProviderCatalog";

export interface SettingsModalProps {
  /** Provider 预设 id（llmProviders.ts），custom = 自由输入；缺省视为 custom */
  providerId?: string;
  apiKey: string;
  baseURL: string;
  model: string;
  accessToken: string;
  temperature: string;
  /** 最大输出 tokens（1024–65536），留空走服务端默认；Anthropic 端点必填 max_tokens */
  maxTokens: string;
  /** 接口协议：openai 兼容（/chat/completions）或 anthropic（/v1/messages，如 Kimi Coding） */
  protocol: "openai" | "anthropic";
  onProviderChange: (v: string) => void;
  onApiKeyChange: (v: string) => void;
  onBaseURLChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onAccessTokenChange: (v: string) => void;
  onTemperatureChange: (v: string) => void;
  onMaxTokensChange: (v: string) => void;
  onProtocolChange: (v: "openai" | "anthropic") => void;
  onSave: () => void;
  onClose: () => void;
}

type SettingsTab = "model" | "datasources";

const SETTINGS_TABS: { id: SettingsTab; label: string; Icon: typeof Bot }[] = [
  { id: "model", label: "模型配置", Icon: Bot },
  { id: "datasources", label: "数据源", Icon: Database },
];

/** 协议 + Base URL 字段：预设 Provider 收进「高级」折叠区，自定义时直接展开 */
function EndpointFields({
  protocol,
  baseURL,
  onProtocolChange,
  onBaseURLChange,
}: Pick<
  SettingsModalProps,
  "protocol" | "baseURL" | "onProtocolChange" | "onBaseURLChange"
>) {
  return (
    <>
      <fieldset>
        <legend className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
          <Sliders className="w-3.5 h-3.5" />
          <span>接口协议</span>
        </legend>
        <RadioGroup
          value={protocol}
          onValueChange={(v) => onProtocolChange(v as "openai" | "anthropic")}
          className="flex gap-4"
          aria-label="接口协议"
        >
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <RadioGroupItem value="openai" />
            <span>OpenAI 兼容</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <RadioGroupItem value="anthropic" />
            <span>Anthropic</span>
          </label>
        </RadioGroup>
      </fieldset>

      <div>
        <label htmlFor="settings-base-url" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
          <Globe className="w-3.5 h-3.5" />
          <span>Base URL</span>
        </label>
        <input
          id="settings-base-url"
          type="text"
          value={baseURL}
          onChange={(e) => onBaseURLChange(e.target.value)}
          placeholder={
            protocol === "anthropic"
              ? "https://api.kimi.com/coding"
              : "https://api.openai.com/v1"
          }
          className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
        />
      </div>
    </>
  );
}

export function SettingsModal({
  providerId = CUSTOM_PROVIDER_ID,
  apiKey,
  baseURL,
  model,
  accessToken,
  temperature,
  maxTokens,
  protocol,
  onProviderChange,
  onApiKeyChange,
  onBaseURLChange,
  onModelChange,
  onAccessTokenChange,
  onTemperatureChange,
  onMaxTokensChange,
  onProtocolChange,
  onSave,
  onClose,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  // 动态 Provider 目录：初始内置精选，挂载后合并 models.dev 全量目录
  const { presets, loading } = useProviderCatalog();
  // 当前 Provider 预设（custom / 未知 id 时为 undefined → 自由输入形态）
  const preset = presets.find((p) => p.id === providerId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[calc(100%-2rem)] sm:max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 gap-4 text-xs"
      >
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-blue-500" />
            <DialogTitle className="font-bold text-sm">设置</DialogTitle>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as SettingsTab)}
          className="gap-4"
        >
          <TabsList className="w-full h-auto p-1 text-xs font-medium bg-slate-100 dark:bg-slate-800/70">
            {SETTINGS_TABS.map(({ id, label, Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="flex-1 h-auto py-1.5 gap-1.5 text-xs data-active:font-semibold data-active:text-blue-600 dark:data-active:text-blue-400 data-active:bg-white dark:data-active:bg-slate-900 data-active:shadow-xs"
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="model" className="space-y-3 text-xs mt-0">
            <div>
              <label htmlFor="settings-provider" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                <Bot className="w-3.5 h-3.5" />
                <span>Provider{loading && <span className="text-slate-400 font-normal">（目录同步中…）</span>}</span>
              </label>
              <Select
                value={providerId}
                onValueChange={onProviderChange}
                name="settings-provider"
              >
                <SelectTrigger
                  id="settings-provider"
                  className="w-full h-auto py-2.5 text-xs font-medium bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="text-xs max-h-72">
                  <SelectGroup>
                    <SelectLabel>常用</SelectLabel>
                    {LLM_PROVIDER_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {(() => {
                    const builtinIds = new Set(
                      LLM_PROVIDER_PRESETS.map((p) => p.id)
                    );
                    const rest = presets.filter((p) => !builtinIds.has(p.id));
                    if (!rest.length) return null;
                    return (
                      <SelectGroup>
                        <SelectLabel>全部 Provider（models.dev 目录）</SelectLabel>
                        {rest.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })()}
                  <SelectItem value={CUSTOM_PROVIDER_ID}>自定义</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="settings-api-key" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                <Key className="w-3.5 h-3.5" />
                <span>API Key</span>
              </label>
              <input
                id="settings-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder={preset?.keyHint ?? "sk-..."}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </div>

            <div>
              <label htmlFor="settings-model" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                <Bot className="w-3.5 h-3.5" />
                <span>Model（手动输入，可从建议中选择）</span>
              </label>
              <input
                id="settings-model"
                type="text"
                list={preset ? "settings-model-options" : undefined}
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder={preset?.defaultModel ?? "gpt-4o-mini / deepseek-chat"}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
              />
              {preset && (
                <datalist id="settings-model-options">
                  {preset.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </div>

            {preset ? (
              <Collapsible className="rounded-lg border border-slate-100 dark:border-slate-800">
                <CollapsibleTrigger className="group w-full cursor-pointer select-none px-2.5 py-2 text-slate-500 font-medium flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" />
                  <span>高级：协议与接口地址</span>
                  <ChevronDown className="w-3.5 h-3.5 ml-auto transition-transform group-data-open:rotate-180" />
                </CollapsibleTrigger>
                {/* forceMount：折叠时字段保持挂载（与原 details 行为一致），hidden 由 Radix 控制 */}
                <CollapsibleContent forceMount className="px-2.5 pb-2.5 space-y-3 data-closed:hidden">
                  <EndpointFields
                    protocol={protocol}
                    baseURL={baseURL}
                    onProtocolChange={onProtocolChange}
                    onBaseURLChange={onBaseURLChange}
                  />
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <div className="space-y-3">
                <EndpointFields
                  protocol={protocol}
                  baseURL={baseURL}
                  onProtocolChange={onProtocolChange}
                  onBaseURLChange={onBaseURLChange}
                />
              </div>
            )}

            <div>
              <label htmlFor="settings-temperature" className="block text-slate-500 mb-1 font-medium flex items-center justify-between">
                <span>Temperature（0–2，数据分析建议 0.2）</span>
                <span className="font-mono text-slate-400">{temperature}</span>
              </label>
              <Slider
                id="settings-temperature"
                value={[Number(temperature) || 0]}
                min={0}
                max={2}
                step={0.1}
                onValueChange={([v]) => onTemperatureChange(String(v))}
                className="w-full"
              />
            </div>

            <div>
              <label htmlFor="settings-max-tokens" className="block text-slate-500 mb-1 font-medium flex items-center justify-between">
                <span>最大输出 Tokens（Anthropic 协议必填，推理模型建议 32768+）</span>
                <span className="font-mono text-slate-400">{maxTokens || "16384（默认）"}</span>
              </label>
              <input
                id="settings-max-tokens"
                type="number"
                min="1024"
                max="65536"
                step="1024"
                value={maxTokens}
                onChange={(e) => onMaxTokensChange(e.target.value)}
                placeholder="留空使用服务端默认 16384"
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <label htmlFor="settings-access-token" className="block text-slate-500 mb-1 font-medium flex items-center gap-1">
                <Key className="w-3.5 h-3.5" />
                <span>访问令牌（部署鉴权，可选）</span>
              </label>
              <input
                id="settings-access-token"
                type="password"
                value={accessToken}
                onChange={(e) => onAccessTokenChange(e.target.value)}
                placeholder="服务端配置 OPENUI_API_AUTH_TOKEN 时必填"
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </div>
          </TabsContent>

          <TabsContent
            value="datasources"
            className="max-h-[60vh] overflow-y-auto pr-0.5 mt-0"
          >
            <DatasourceSettings />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs hover:bg-slate-100"
          >
            取消
          </button>
          <button
            onClick={onSave}
            className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 shadow-xs"
          >
            保存配置
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
