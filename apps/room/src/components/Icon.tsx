import type { ReactNode } from "react";

export type IconName = "sweep" | "import" | "pin" | "settings";

// 20칸 격자, 1.5 선, 둥근 끝. 색은 글자색(currentColor)을 따라가고, 뜻은 늘 옆의 글자가 말합니다.
const shapes: Record<IconName, ReactNode> = {
  sweep: <path d="M17 3l-6 6M9.5 7.5L12.5 10.5M9.5 7.5L3 10l7 7 2.5-6.5M10.5 8.5l-5.2 3.8M11.5 9.5l-3.8 5.2" />,
  import: <path d="M3 11v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5M10 3v9M6.5 8.5L10 12l3.5-3.5" />,
  pin: <path d="M6.5 3h7M8 3v4.5L5 11v2h10v-2l-3-3.5V3M10 13v4" />,
  settings: <path d="M10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM10 4.8a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4ZM10 2.5v2.3M10 15.2v2.3M2.5 10h2.3M15.2 10h2.3M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shapes[name]}
    </svg>
  );
}

// 주름관 로고(design/logo/folduct-symbol.svg). 세로 관이 기둥, 꺾인 관과 머리가 윗줄, 내민 팔이 가운뎃줄인 F예요. 색은 브랜드 전용 토큰 --brand 하나만 씁니다. size는 높이예요.
export function BrandMark({ size }: { size: number }) {
  return (
    <svg className="mark" viewBox="-4 -8 128 128" width={size} height={size} fill="var(--brand)" aria-hidden="true" focusable="false">
      <path d="M42 64C54 64 66 64 78 64" fill="none" stroke="var(--brand)" strokeWidth={13} strokeLinecap="round" />
      <path d="M70 64a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z" />
      <path d="M14 106L54 106L56 114L12 114Z" />
      <path d="M47 112L47 40.1L47.2 36.8L47.7 34.2L48.2 32.8L48.9 32L49.9 31.5L51.5 31.2L54.1 31L72 31L72 5L53.9 5L50.9 5.1L47.9 5.4L45.8 5.8L42.7 6.5L40.7 7.2L37.7 8.5L35.7 9.6L32.9 11.5L31.1 13L29.5 14.6L27.3 17.4L26 19.3L24.4 22.4L23.1 25.7L22.2 29.1L21.5 32.6L21.1 37.5L21 112Z" />
      <path fillRule="evenodd" d="M67 20C67 -7.7 117 -7.7 117 20C117 47.7 67 47.7 67 20ZM78.3 19.8A5.8 6.6 -8 1 0 89.7 18.2A5.8 6.6 -8 1 0 78.3 19.8ZM95 18.8A6.1 7 -8 1 0 107 17.2A6.1 7 -8 1 0 95 18.8Z" />
    </svg>
  );
}
