import type { ReactNode } from "react";
import type { Kind } from "../domain/model";
import { kindColors, kindEdges } from "./palette";

// 파일 하나 = 형식별 색의 반투명한 오브제. 실루엣과 바느질 선(점선)이 형식을 한 번 더 알려 줍니다.
const shapes: Record<Kind, { body: ReactNode; seams: ReactNode }> = {
  image: {
    body: <rect x="8" y="12" width="48" height="40" rx="2" />,
    seams: <><rect x="14" y="18" width="36" height="28" /><path d="M14 40 L25 30 L33 37 L39 32 L50 41" /><circle cx="42" cy="25" r="3" /></>,
  },
  video: {
    body: <><rect x="5" y="12" width="54" height="36" rx="4" /><rect x="22" y="52" width="20" height="4" rx="1" /></>,
    seams: <><rect x="10" y="17" width="44" height="26" rx="2" /><path d="M28 24 L39 30 L28 36 Z" /><path d="M32 48 V52" /></>,
  },
  audio: {
    body: <circle cx="32" cy="32" r="24" />,
    seams: <><circle cx="32" cy="32" r="15" /><circle cx="32" cy="32" r="6" /></>,
  },
  // 글(text)과 같은 종이에 왼쪽으로 튀어나온 라벨 탭을 달아, 색 없이도 PDF와 글이 구분됩니다.
  pdf: {
    body: <><path d="M16 6 H40 L50 16 V58 H16 Z" /><rect x="10" y="36" width="30" height="12" rx="2" /></>,
    seams: <><path d="M40 6 V16 H50" /><path d="M22 23 H44 M22 30 H44" /><path d="M15 42 H35" /></>,
  },
  text: {
    body: <path d="M16 6 H40 L50 16 V58 H16 Z" />,
    seams: <><path d="M40 6 V16 H50" /><path d="M22 23 H44 M22 30 H44 M22 37 H44 M22 44 H36" /></>,
  },
  office: {
    body: <><path d="M22 4 H50 V48 H22 Z" /><path d="M12 13 H40 V60 H12 Z" /></>,
    seams: <path d="M18 24 H34 M18 31 H34 M18 38 H34 M18 45 H28" />,
  },
  table: {
    body: <rect x="8" y="10" width="48" height="44" rx="2" />,
    seams: <path d="M8 22 H56 M8 33 H56 M8 44 H56 M24 10 V54 M40 10 V54" />,
  },
  design: {
    body: <path d="M32 8 C14 8 6 22 8 34 C10 48 22 56 32 54 C38 53 36 45 41 43 C47 41 56 44 57 32 C58 18 48 8 32 8 Z" />,
    seams: <><circle cx="20" cy="25" r="4" /><circle cx="31" cy="18" r="4" /><circle cx="43" cy="21" r="4" /><circle cx="19" cy="39" r="4" /><circle cx="31" cy="42" r="4" /></>,
  },
  archive: {
    body: <><rect x="10" y="16" width="44" height="40" rx="2" /><rect x="7" y="8" width="50" height="10" rx="2" /></>,
    seams: <><path d="M32 18 V56" /><rect x="27" y="26" width="10" height="7" /></>,
  },
  unknown: {
    body: <rect x="12" y="12" width="40" height="40" rx="10" />,
    seams: <rect x="18" y="18" width="28" height="28" rx="6" />,
  },
};

export function ObjectShape({ kind, color, size }: { kind: Kind; color?: string; size: number }) {
  const shape = shapes[kind];
  const fill = color ?? kindColors[kind];
  // 형식 색이면 진한 테두리(edge)로 그어 판 위에서도 3:1을 지킵니다. 상자처럼 따로 준 색은 그대로 씁니다.
  const edge = fill === kindColors[kind] ? kindEdges[kind] : fill;
  // 64칸 viewBox를 작게 그리면 선이 1px 아래로 뭉개지므로, 작을수록 viewBox 단위 굵기를 키웁니다(26px에서 약 1.25px·1px).
  const body = Math.max(1.6, 80 / size);
  const seam = Math.max(1.1, 64 / size);
  const dash = Math.max(2.5, 160 / size);
  return (
    <svg className="object" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <g fill={fill} fillOpacity="0.34" stroke={edge} strokeWidth={body} strokeLinejoin="round">{shape.body}</g>
      <g fill="none" stroke={edge} strokeWidth={seam} strokeOpacity="0.85" strokeDasharray={`${dash} ${dash}`} strokeLinecap="round">{shape.seams}</g>
    </svg>
  );
}
