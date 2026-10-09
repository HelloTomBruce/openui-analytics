import React from "react";

export interface MetricGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
}

export const MetricGrid: React.FC<MetricGridProps> = ({
  children,
  columns = 3,
}) => {
  const colClass = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  }[columns] || "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return <div className={`grid gap-4 w-full ${colClass}`}>{children}</div>;
};
