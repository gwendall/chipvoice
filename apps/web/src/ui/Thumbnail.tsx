import type { ReactNode } from "react";

/** Reserve media geometry before its data or pixels arrive, including on SSR. */
export function Thumbnail({ width, height = width, children, className = "" }: {
  width: number;
  height?: number;
  children?: ReactNode;
  className?: string;
}) {
  return <span className={`thumbnail ${className}`} style={{
    display: "inline-flex", boxSizing: "border-box", width, height, aspectRatio: `${width} / ${height}`,
    flexShrink: 0, verticalAlign: "middle", overflow: "hidden",
    backgroundColor: "var(--case, #e6e3d9)",
  }}>{children}</span>;
}
