import { useId, type ReactNode } from "react";

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

// 빼꼼 프로도 로고(design/logo/folduct-symbol.svg). 판 아래에서 올라온 관이 F의 기둥, 머리로 꺾인 관이 윗줄, 열린 입구로 끝나는 가지가 가운뎃줄이에요.
// 치수는 판 824의 황금비 수열(824/φⁿ)에서 나오고, 머리는 판의 황금 교차점에 있어요. 색은 흰 판(--surface)과 로고 전용 --brand 둘뿐이에요. size는 높이예요.
const tube = ["M294.5 984L294.5 489A74.3 74.3 0 0 1 368.8 414.7L560.6 414.7", "M294.5 609.3L489 609.3"];
export function BrandMark({ size }: { size: number }) {
  const plate = `brand-plate-${useId()}`;
  return (
    <svg className="mark" viewBox="100 100 824 824" width={size} height={size} aria-hidden="true" focusable="false">
      <clipPath id={plate}><rect x="100" y="100" width="824" height="824" rx="185" /></clipPath>
      <rect x="100" y="100" width="824" height="824" rx="185" fill="var(--surface)" />
      <g clipPath={`url(#${plate})`} fill="none">
        {tube.map((d) => <path key={d} d={d} stroke="var(--brand)" strokeWidth={155.3} />)}
        {tube.map((d) => <path key={`in${d}`} d={d} stroke="var(--surface)" strokeWidth={120.2} />)}
        <ellipse cx="489" cy="609.3" rx="28.4" ry="68.9" fill="var(--surface)" stroke="var(--brand)" strokeWidth={17.5} />
        <ellipse cx="489" cy="609.3" rx="10.8" ry="51.3" fill="var(--brand)" />
        <ellipse cx="609.3" cy="414.7" rx="97.3" ry="83.7" fill="var(--surface)" stroke="var(--brand)" strokeWidth={17.5} />
        <ellipse cx="609.3" cy="414.7" rx="68.9" ry="55.3" fill="var(--brand)" />
        <ellipse cx="572.1" cy="411.7" rx="16.7" ry="20" fill="var(--surface)" />
        <ellipse cx="646.4" cy="410.7" rx="17.7" ry="21.2" fill="var(--surface)" />
      </g>
      <rect x="100" y="100" width="824" height="824" rx="185" fill="none" stroke="var(--line-strong)" strokeWidth={8} />
    </svg>
  );
}
