"use client";

import React from "react";
import { useTriggerAction } from "@openuidev/react-lang";
import { Play, Download, Copy, ExternalLink, Zap } from "lucide-react";

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
