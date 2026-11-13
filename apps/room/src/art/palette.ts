import type { Kind } from "../domain/model";

// 색은 파일 형식의 몫입니다. 어느 프로젝트에 있든 이미지는 노랑, 글은 초록, 영상은 파랑, PDF·문서는 빨강, 발표는 청록입니다.
// color는 주름 칸과 색 막대, edge는 판 위에서 3:1이 필요한 진한 색입니다. 이 줄 모양은 export-figma-tokens.mjs가 그대로 읽으니 필드를 끼워 넣지 않습니다.
export const colorGroups: { label: string; color: string; edge: string; kinds: Kind[] }[] = [
  { label: "이미지", color: "#e5bb4d", edge: "#8e6e1a", kinds: ["image"] },
  { label: "글·코드", color: "#5f9b6d", edge: "#3b5f4d", kinds: ["text"] },
  { label: "영상", color: "#2a64ad", edge: "#123f80", kinds: ["video"] },
  { label: "PDF·문서", color: "#c9553f", edge: "#8d2d1e", kinds: ["pdf", "office"] },
  { label: "발표", color: "#2b9a95", edge: "#1b6763", kinds: ["slides"] },
  { label: "표", color: "#dd8b47", edge: "#a35a22", kinds: ["table"] },
  { label: "소리", color: "#8371c0", edge: "#54438e", kinds: ["audio"] },
  { label: "디자인", color: "#c95b93", edge: "#863a62", kinds: ["design"] },
  { label: "압축", color: "#98743f", edge: "#6b4d29", kinds: ["archive"] },
  { label: "기타", color: "#a5a5a1", edge: "#6e6e6a", kinds: ["unknown"] },
];

// 종이는 형식마다 다섯 단입니다. 위 color·edge에 밝은 두 단과 글자색을 더해, 먼지 낀 듯 차분한 톤으로 맞췄습니다.
const paperShades: Record<string, { pale: string; soft: string; ink: string }> = {
  이미지: { pale: "#fbefc8", soft: "#f0d78c", ink: "#453508" },
  "글·코드": { pale: "#dfefd5", soft: "#abd1a8", ink: "#1e3a2a" },
  영상: { pale: "#dce7f3", soft: "#94aecb", ink: "#0b2a52" },
  "PDF·문서": { pale: "#f8e0d8", soft: "#eaab9a", ink: "#4c1409" },
  발표: { pale: "#d6eeec", soft: "#93cdc8", ink: "#0d3533" },
  표: { pale: "#fbe5d0", soft: "#f3c096", ink: "#4d2408" },
  소리: { pale: "#e7e3f4", soft: "#bfb7df", ink: "#2a1f52" },
  디자인: { pale: "#f9dde8", soft: "#efb7cf", ink: "#4a1233" },
  압축: { pale: "#eee2cd", soft: "#cfb189", ink: "#37250e" },
  기타: { pale: "#ecebe5", soft: "#d0cec7", ink: "#2d2d2a" },
};

const byKind = <T,>(pick: (group: (typeof colorGroups)[number]) => T) =>
  Object.fromEntries(colorGroups.flatMap((group) => group.kinds.map((kind) => [kind, pick(group)]))) as Record<Kind, T>;

export const kindColors = byKind((group) => group.color);
export const kindEdges = byKind((group) => group.edge);

export type PaperTones = { pale: string; soft: string; color: string; edge: string; ink: string };
export const kindTones = byKind<PaperTones>(({ label, color, edge }) => ({ ...paperShades[label], color, edge }));

export const boxColor = "#5f6670";

export const mix = (from: string, to: string, amount: number) =>
  `#${[1, 3, 5].map((at) => {
    const [a, b] = [from, to].map((hex) => parseInt(hex.slice(at, at + 2), 16));
    return Math.round(a + (b - a) * amount).toString(16).padStart(2, "0");
  }).join("")}`;

// 상자처럼 따로 준 색에도 같은 다섯 단을 만들어 줍니다. 헥스가 아니면 섞을 수 없어 한 색으로 칠합니다.
export function tonesFrom(color: string): PaperTones {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return { pale: color, soft: color, color, edge: color, ink: color };
  return { pale: mix(color, "#ffffff", 0.78), soft: mix(color, "#ffffff", 0.5), color, edge: mix(color, "#000000", 0.32), ink: mix(color, "#000000", 0.62) };
}
