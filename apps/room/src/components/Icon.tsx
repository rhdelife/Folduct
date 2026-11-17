import type { ReactNode } from "react";
import { drawBrandFace } from "../art/duct";

export type IconName = "sweep" | "import" | "pin" | "settings" | "close" | "trash" | "chevron" | "work";

// 20칸 격자, 1.5 선, 둥근 끝. 색은 글자색(currentColor)을 따라가고, 뜻은 늘 옆의 글자가 말합니다.
const shapes: Record<IconName, ReactNode> = {
  sweep: <path d="M17 3l-6 6M9.5 7.5L12.5 10.5M9.5 7.5L3 10l7 7 2.5-6.5M10.5 8.5l-5.2 3.8M11.5 9.5l-3.8 5.2" />,
  import: <path d="M3 11v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5M10 3v9M6.5 8.5L10 12l3.5-3.5" />,
  pin: <path d="M6.5 3h7M8 3v4.5L5 11v2h10v-2l-3-3.5V3M10 13v4" />,
  trash: <path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 10a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1l.8-10M8.5 9v5M11.5 9v5" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  chevron: <path d="M8 5l5 5-5 5" />,
  work: <path d="M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM10 6.5V10l2.5 1.5M8.5 1.8h3" />,
  settings: <path d="M10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM10 4.8a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4ZM10 2.5v2.3M10 15.2v2.3M2.5 10h2.3M15.2 10h2.3M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shapes[name]}
    </svg>
  );
}

// 프로도 얼굴 로고(design/logo/folduct-symbol.svg, scripts/make-logo.mjs). 흰 판 가운데에 방 그림과 같은 펜으로 그린 얼굴 하나예요.
// 색은 흰 판(--surface)과 로고 전용 --brand 둘뿐이에요. size는 높이예요.
const face = drawBrandFace();
export function BrandMark({ size }: { size: number }) {
  return (
    <svg className="mark" viewBox="100 100 824 824" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="100" y="100" width="824" height="824" rx="185" fill="var(--surface)" />
      <svg x="100" y="100" width="824" height="824" viewBox={face.viewBox}>
        {face.items.map((item, i) => "d" in item && <path key={i} d={item.d} fill={item.tone === "ink" ? "var(--brand)" : "var(--surface)"} fillRule={item.even ? "evenodd" : undefined} />)}
      </svg>
      <rect x="100" y="100" width="824" height="824" rx="185" fill="none" stroke="var(--line-strong)" strokeWidth={8} />
    </svg>
  );
}
