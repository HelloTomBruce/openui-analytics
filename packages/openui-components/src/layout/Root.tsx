"use client";

import React from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { ComponentSafeWrapper } from "../internal/ComponentSafeWrapper";

// Root 根容器定义：页面顶级布局容器（库的 root 组件，纯容器无独立 React 组件实现）
export const RootComponent = defineComponent({
  name: "Root",
  description: "页面顶级布局容器",
  props: z.object({
    children: z.any().optional().describe("子组件列表"),
  }),
  component: ({
    props,
    renderNode,
  }: {
    props?: { children?: unknown };
    renderNode?: (node?: unknown) => React.ReactNode;
  }) => {
    const rawChildren = props?.children;
    return (
      <ComponentSafeWrapper name="Root">
        <div className="space-y-4 w-full">
          {renderNode ? renderNode(rawChildren) : null}
        </div>
      </ComponentSafeWrapper>
    );
  },
});
