"use client";

import React from "react";
import { useTriggerAction, defineComponent } from "@openuidev/react-lang";
import { Play, Download, Copy, ExternalLink, Zap } from "lucide-react";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

export interface ActionButtonProps {
  label: string;
  variant?: "primary" | "secondary" | "outline" | "success" | "danger";
  icon?: "play" | "download" | "copy" | "link" | "zap";
  prompt?: string;
  action?: unknown;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  label,
  variant = "primary",
  icon = "zap",
  prompt,
  action,
}) => {
  const triggerAction = useTriggerAction();
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    if (!triggerAction) return;
    setLoading(true);
    try {
      if (action) {
        await triggerAction(prompt || label, undefined, action as never);
      } else if (prompt) {
        await triggerAction(prompt);
      }
    } catch (e) {
      console.error("[ActionButton error]:", e);
    } finally {
      setLoading(false);
    }
  };

  const icons = {
    play: <Play className="w-3.5 h-3.5" />,
    download: <Download className="w-3.5 h-3.5" />,
    copy: <Copy className="w-3.5 h-3.5" />,
    link: <ExternalLink className="w-3.5 h-3.5" />,
    zap: <Zap className="w-3.5 h-3.5" />,
  };

  const variantStyles = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-xs",
    secondary: "bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200",
    outline: "border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300",
    success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs",
    danger: "bg-rose-600 hover:bg-rose-700 text-white shadow-xs",
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 cursor-pointer ${variantStyles[variant]}`}
    >
      {icons[icon]}
      <span>{label}</span>
      {loading && <span className="animate-spin text-[10px]">⏳</span>}
    </button>
  );
};

// ===== OpenUI 组件库定义 =====
export const ActionButtonDef = defineComponent({
  name: "ActionButton",
  description: "交互动作按钮，支持触发客户端本地工具执行 (Run)、修改状态 (Set) 或向 Agent 发送提示词 (ToAssistant)",
  props: z.object({
    label: z.any().optional().describe("按钮文案"),
    variant: z.any().optional().describe("按钮样式主题"),
    icon: z.any().optional().describe("图标类型"),
    prompt: z.any().optional().describe("点击后向 AI 发送的分析提问"),
    action: z.any().optional().describe("OpenUI 结构化动作流配置"),
  }),
  component: ({ props }: { props: Record<string, unknown> }) => {
    return (
      <ComponentSafeWrapper name="ActionButton">
        <ActionButton
          label={String(props?.label || "点击执行")}
          variant={props?.variant as React.ComponentProps<typeof ActionButton>["variant"]}
          icon={props?.icon as React.ComponentProps<typeof ActionButton>["icon"]}
          prompt={props?.prompt ? String(props.prompt) : undefined}
          action={props?.action}
        />
      </ComponentSafeWrapper>
    );
  },
});
