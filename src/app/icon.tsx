import { ImageResponse } from "next/og";

export const size = {
  width: 48,
  height: 48,
};
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)",
          borderRadius: "12px",
          position: "relative",
          boxShadow: "inset 0 0 0 1.5px rgba(255, 255, 255, 0.15)",
        }}
      >
        {/* 背景光晕 */}
        <div
          style={{
            position: "absolute",
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(59,130,246,0.5) 0%, rgba(139,92,246,0) 70%)",
            top: "4px",
            left: "4px",
          }}
        />

        {/* 柱状图条 (Bar 1) */}
        <div
          style={{
            position: "absolute",
            bottom: "9px",
            left: "10px",
            width: "6px",
            height: "14px",
            background: "linear-gradient(to top, #3b82f6, #60a5fa)",
            borderRadius: "2px",
          }}
        />

        {/* 柱状图条 (Bar 2) */}
        <div
          style={{
            position: "absolute",
            bottom: "9px",
            left: "19px",
            width: "6px",
            height: "22px",
            background: "linear-gradient(to top, #6366f1, #818cf8)",
            borderRadius: "2px",
          }}
        />

        {/* 柱状图条 (Bar 3) */}
        <div
          style={{
            position: "absolute",
            bottom: "9px",
            left: "28px",
            width: "6px",
            height: "29px",
            background: "linear-gradient(to top, #8b5cf6, #c084fc)",
            borderRadius: "2px",
          }}
        />

        {/* AI 闪耀星标 (Sparkle Icon) */}
        <svg
          style={{
            position: "absolute",
            top: "7px",
            right: "7px",
            width: "13px",
            height: "13px",
          }}
          viewBox="0 0 24 24"
          fill="#38bdf8"
        >
          <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
