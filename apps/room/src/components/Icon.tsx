import type { ReactNode } from "react";

export type IconName = "sweep" | "import" | "pin";

// 20칸 격자, 1.5 선, 둥근 끝. 색은 글자색(currentColor)을 따라가고, 뜻은 늘 옆의 글자가 말합니다.
const shapes: Record<IconName, ReactNode> = {
  sweep: <path d="M17 3l-6 6M9.5 7.5L12.5 10.5M9.5 7.5L3 10l7 7 2.5-6.5M10.5 8.5l-5.2 3.8M11.5 9.5l-3.8 5.2" />,
  import: <path d="M3 11v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5M10 3v9M6.5 8.5L10 12l3.5-3.5" />,
  pin: <path d="M6.5 3h7M8 3v4.5L5 11v2h10v-2l-3-3.5V3M10 13v4" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shapes[name]}
    </svg>
  );
}

// 먹색만 씁니다. 색은 파일 종류만 뜻하므로 브랜드에는 종류 색을 쓰지 않아요. 겹친 곳은 반투명이 쌓여 짙어집니다.
export function BrandMark({ size }: { size: number }) {
  return (
    <svg className="mark" viewBox="0 0 48 48" width={size} height={size} fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeWidth={1.5} aria-hidden="true" focusable="false">
      <rect x="4" y="10" width="22" height="22" rx="3" />
      <rect x="16" y="4" width="22" height="22" rx="3" />
      <rect x="20" y="20" width="22" height="22" rx="3" />
    </svg>
  );
}
