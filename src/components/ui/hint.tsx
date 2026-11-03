"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HintProps {
  /** 提示文案（原 title 属性内容） */
  label: string;
  /** 弹出方位，默认 top */
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactElement;
}

/**
 * 图标按钮等无文字元素的悬浮提示封装，替代 HTML title 属性。
 *
 * 受控 open：仅 hover 与键盘焦点（:focus-visible）时弹出。
 * 不用 Radix 默认的「任意 focus 即开」：Dialog 挂载会把初始焦点
 * 赋给第一个可聚焦元素，若 focus 即弹 tooltip，弹窗一打开就会冒提示，
 * 且 tooltip 的 DismissableLayer 会截住第一个 Esc。
 */
export function Hint({ label, side = "top", children }: HintProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip open={open}>
        <TooltipTrigger
          asChild
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={(e) => {
            // 仅键盘焦点弹提示（程序化聚焦/鼠标点击聚焦不弹）
            if (e.currentTarget.matches(":focus-visible")) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent
          side={side}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
