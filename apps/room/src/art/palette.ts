import type { Kind } from "../domain/model";

// 색은 파일 형식의 몫입니다. 어느 프로젝트에 있든 이미지는 노랑, 글은 초록, 영상은 파랑, PDF·문서·발표는 빨강입니다.
// edge는 테두리와 바느질 선 색입니다. 밝은 채움색 그대로는 판 가장자리(--lightbox-3)에서 3:1이 안 되는 형식만 조금 어둡게 했습니다.
export const colorGroups: { label: string; color: string; edge: string; kinds: Kind[] }[] = [
  { label: "이미지", color: "#e3b015", edge: "#9d7b16", kinds: ["image"] },
  { label: "글·코드", color: "#3f9f50", edge: "#3b904a", kinds: ["text"] },
  { label: "영상", color: "#3d6fd3", edge: "#3d6fd3", kinds: ["video"] },
  { label: "PDF·문서·발표", color: "#e04a3a", edge: "#e04a3a", kinds: ["pdf", "office"] },
  { label: "표", color: "#ec8a2e", edge: "#b86e28", kinds: ["table"] },
  { label: "소리", color: "#8a5cd6", edge: "#8a5cd6", kinds: ["audio"] },
  { label: "디자인", color: "#d4479b", edge: "#d4479b", kinds: ["design"] },
  { label: "압축", color: "#8d6a45", edge: "#8d6a45", kinds: ["archive"] },
  { label: "기타", color: "#8b9098", edge: "#7b7f86", kinds: ["unknown"] },
];

const byKind = (pick: (group: (typeof colorGroups)[number]) => string) =>
  Object.fromEntries(colorGroups.flatMap((group) => group.kinds.map((kind) => [kind, pick(group)]))) as Record<Kind, string>;

export const kindColors = byKind((group) => group.color);
export const kindEdges = byKind((group) => group.edge);

export const boxColor = "#5f6670";
