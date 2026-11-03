import type { Thing } from "../domain/model";
import { hash } from "../domain/sky";
import { colorGroups } from "./palette";

// 방 하나 = 공중에 뜬 화병 하나. 좌표는 가운데가 x=0, 입구가 y=-100, 바닥이 y=100입니다.
// 오른쪽 옆모습만 곡선(c1x c1y c2x c2y x y)으로 적고 왼쪽은 거울처럼 그립니다.
const profiles: { top: number; curves: number[][] }[] = [
  { top: 24, curves: [[20, -92, 16, -86, 16, -78], [16, -62, 60, -52, 60, -12], [60, 30, 34, 70, 28, 100]] },
  { top: 20, curves: [[20, -50, 24, -10, 40, 30], [50, 56, 72, 74, 72, 100]] },
  { top: 12, curves: [[12, -60, 12, -48, 14, -36], [18, -14, 62, -12, 62, 42], [62, 76, 38, 92, 34, 100]] },
  { top: 26, curves: [[26, -92, 28, -88, 34, -84], [72, -70, 80, -30, 80, 4], [80, 52, 50, 86, 34, 94], [32, 96, 30, 98, 30, 100]] },
  { top: 14, curves: [[14, -90, 12, -84, 14, -78], [38, -70, 38, -30, 18, -22], [70, -14, 76, 60, 40, 84], [34, 88, 30, 94, 30, 100]] },
  { top: 36, curves: [[30, -92, 22, -88, 22, -78], [22, -66, 72, -58, 72, -14], [72, 30, 44, 76, 30, 100]] },
  { top: 44, curves: [[24, -86, 16, -60, 16, -20], [16, 30, 30, 60, 46, 84], [50, 90, 50, 96, 50, 100]] },
  { top: 20, curves: [[20, -88, 18, -82, 24, -76], [80, -60, 88, -8, 84, 20], [80, 62, 44, 88, 34, 100]] },
];

function vasePath({ top, curves }: (typeof profiles)[number]): string {
  const right = curves.map(([a, b, c, d, x, y]) => `C${a} ${b} ${c} ${d} ${x} ${y}`);
  // 왼쪽은 바닥에서 입구로 거슬러 올라가니 곡선마다 조절점 순서를 뒤집습니다.
  const starts = [[top, -100], ...curves.map((curve) => curve.slice(4))];
  const left = curves.map(([a, b, c, d], i) => `C${-c} ${d} ${-a} ${b} ${-starts[i][0]} ${starts[i][1]}`).reverse();
  return `M${top} -100${right.join("")}H${-curves[curves.length - 1][4]}${left.join("")}Z`;
}

export const vasePaths = profiles.map(vasePath);

// 같은 방은 언제나 같은 화병입니다. 저장하지 않고 방 id에서 정합니다.
export function vaseIndex(roomId: string): number {
  return Math.floor(hash(roomId, 11) * vasePaths.length);
}

export type VaseBand = { label: string; color: string; y: number; height: number };

// 형식별 용량을 바닥부터 쌓습니다. 전체 높이는 ratio이고, 칸 비율은 형식별 용량 비율입니다.
export function vaseBands(parts: { label: string; color: string; size: number }[], ratio: number): VaseBand[] {
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  const level = Math.min(1, Math.max(0, ratio));
  if (total === 0 || level === 0) return [];
  let top = 100;
  return parts.map(({ label, color, size }) => {
    const height = (size / total) * level * 200;
    top -= height;
    return { label, color, y: top, height };
  });
}

// 파일을 색 묶음으로 나눠 용량을 더합니다. 목록의 색 막대와 화병이 함께 씁니다.
export function kindParts(things: Thing[]): { label: string; color: string; size: number }[] {
  return colorGroups
    .map(({ label, color, kinds }) => ({ label, color, size: things.reduce((sum, thing) => (!thing.missing && kinds.includes(thing.kind) ? sum + thing.size : sum), 0) }))
    .filter((part) => part.size > 0);
}

export function kindSummary(parts: { label: string; size: number }[]): string {
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  return [...parts].sort((a, b) => b.size - a.size).slice(0, 3).map((part) => `${part.label} ${Math.round((part.size / total) * 100)}%`).join(", ");
}
