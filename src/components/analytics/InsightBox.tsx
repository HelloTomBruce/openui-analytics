import React from "react";
import { Lightbulb, Info, AlertTriangle, CheckCircle2 } from "lucide-react";

export interface InsightBoxProps {
  type?: "tip" | "info" | "warning" | "success";
  title?: string;
  children?: React.ReactNode;
  content?: string;
}

export const InsightBox: React.FC<InsightBoxProps> = ({
  type = "info",
  title,
  children,
  content,
}) => {
  const styles = {
    tip: {
      bg: "bg-amber-50 dark:bg-amber-950/20",
      border: "border-amber-200 dark:border-amber-800",
      text: "text-amber-900 dark:text-amber-200",
      icon: <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
    },
    info: {
      bg: "bg-blue-50 dark:bg-blue-950/20",
      border: "border-blue-200 dark:border-blue-800",
      text: "text-blue-900 dark:text-blue-200",
      icon: <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />,
    },
    warning: {
      bg: "bg-rose-50 dark:bg-rose-950/20",
      border: "border-rose-200 dark:border-rose-800",
      text: "text-rose-900 dark:text-rose-200",
      icon: <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />,
    },
    success: {
      bg: "bg-emerald-50 dark:bg-emerald-950/20",
      border: "border-emerald-200 dark:border-emerald-800",
      text: "text-emerald-900 dark:text-emerald-200",
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />,
    },
  }[type];

  return (
    <div className={`rounded-xl border p-4 ${styles.bg} ${styles.border}`}>
      <div className="flex gap-2.5 items-start">
        <div className="shrink-0 mt-0.5">{styles.icon}</div>
        <div className="space-y-1 text-xs">
          {title && (
            <h5 className={`font-semibold ${styles.text}`}>{title}</h5>
          )}
          <div className={`${styles.text} leading-relaxed opacity-90`}>
            {children || content}
          </div>
        </div>
      </div>
    </div>
  );
};
