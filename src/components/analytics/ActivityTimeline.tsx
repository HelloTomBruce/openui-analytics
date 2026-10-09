"use client";

import { GitCommit, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";

export interface TimelineItem {
  time: string;
  title: string;
  desc?: string;
  status?: "success" | "warning" | "error" | "info";
  author?: string;
  tag?: string;
}

export interface ActivityTimelineProps {
  title?: string;
  description?: string;
  items: TimelineItem[];
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  title = "活动与事件轨迹",
  description,
  items = [],
}) => {
  let rawItems: unknown[] = [];
  if (Array.isArray(items)) {
    rawItems = items;
  } else if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      if (Array.isArray(parsed)) rawItems = parsed;
    } catch {
      rawItems = [];
    }
  }

  const safeItems: TimelineItem[] = rawItems
    .filter((it): it is Record<string, unknown> => it != null && typeof it === "object")
    .map((it) => ({
      time: String(it.time || it.date || it.created_at || "最近"),
      title: String(it.title || it.message || it.name || "事件记录"),
      desc: it.desc || it.description ? String(it.desc || it.description) : undefined,
      status: (["success", "warning", "error", "info"].includes(String(it.status)) ? it.status : "info") as TimelineItem["status"],
      author: it.author || it.author_name ? String(it.author || it.author_name) : undefined,
      tag: it.tag ? String(it.tag) : undefined,
    }));

  const statusIcons = {
    success: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
    warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
    error: <XCircle className="w-3.5 h-3.5 text-rose-500" />,
    info: <GitCommit className="w-3.5 h-3.5 text-blue-500" />,
  };

  const statusDotBg = {
    success: "bg-emerald-500/10 border-emerald-500/30",
    warning: "bg-amber-500/10 border-amber-500/30",
    error: "bg-rose-500/10 border-rose-500/30",
    info: "bg-blue-500/10 border-blue-500/30",
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
      <div className="mb-4">
        {title && (
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-blue-500" />
            <span>{title}</span>
          </h3>
        )}
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {description}
          </p>
        )}
      </div>

      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
        {safeItems.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-4">
            暂无时间线记录
          </div>
        ) : (
          safeItems.map((item, idx) => {
            const status = item.status || "info";
            return (
              <div key={`timeline-${idx}`} className="relative group">
                {/* 节点图标 */}
                <div
                  className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full border flex items-center justify-center bg-white dark:bg-slate-900 ${statusDotBg[status] || statusDotBg.info}`}
                >
                  {statusIcons[status] || statusIcons.info}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {item.title}
                    </span>
                    {item.tag && (
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded font-mono">
                        {item.tag}
                      </span>
                    )}
                    {item.author && (
                      <span className="text-[10px] text-slate-400">@{item.author}</span>
                    )}
                    <span className="text-[10px] text-slate-400 ms-auto font-mono">
                      {item.time}
                    </span>
                  </div>

                  {item.desc && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {item.desc}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
