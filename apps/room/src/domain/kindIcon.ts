import { paperArts, poly, quad, ring, wavy, type PaperArt, type PaperPart } from "../art/paperArts";
import { kindLabels, type Kind } from "./model";

// 사용자가 그린 파일 형식 아이콘. 빈 흰 캔버스(blank)에 그은 선과 도장만 둬요. 예전에 기존 종이 위에 그린 것은 그 종이를 바탕으로 그대로 그려요.
// 선은 그릴 때 그대로가 아니라 ObjectShape가 프로도와 같은 펜으로 다시 그어서, 누가 그려도 같은 그림체예요.
export type IconTool = "pen" | "ring" | "box" | "wave";
// pen은 지나간 점들(x, y, x, y…), 도장은 끌어 놓은 두 점(시작 x, y, 끝 x, y)이에요. 좌표는 바탕 종이 판 기준이에요.
export type IconStroke = { tool: IconTool; pts: number[]; fill: boolean };
export type KindIcon = { id: string; name: string; kind: Kind; base: string; strokes: IconStroke[]; at: number };
// use는 형식마다 지금 쓰는 아이콘 id예요. 없으면 기본 종이예요.
export type KindIconStore = { icons: KindIcon[]; use: Partial<Record<Kind, string>> };

export const kindIconLimit = 100;
export const strokeLimit = 80;
export const pointLimit = 400;
export const kindIconNameMax = 20;
// 펜이 잘리지 않게 모든 점은 종이 가장자리에서 6 안쪽에 둬요(paperArts와 같은 규칙).
const edge = 6;

export const emptyKindIcons: KindIconStore = { icons: [], use: {} };
export const kinds = Object.keys(kindLabels) as Kind[];
const tools: IconTool[] = ["pen", "ring", "box", "wave"];

// 빈 캔버스. 판 크기는 종이와 비슷하게, 이름 칸은 아래쪽이에요. 그린 것 말고는 아무것도 그리지 않아요.
export const blankPaper: PaperArt = { id: "blank", w: 100, h: 118, slot: { x: 12, y: 88, w: 76, h: 22, fill: "ink", on: "pale", center: true }, parts: [] };
export const baseOf = (kind: Kind, base: string): PaperArt => (base === blankPaper.id ? blankPaper : paperArts[kind].find((art) => art.id === base) ?? blankPaper);
const r1 = (n: number) => Math.round(n * 10) / 10;
export const clampPoint = (art: Pick<PaperArt, "w" | "h">, x: number, y: number): [number, number] => [r1(Math.min(art.w - edge, Math.max(edge, x))), r1(Math.min(art.h - edge, Math.max(edge, y)))];

function strokePath({ tool, pts }: IconStroke): string | null {
  if (tool === "pen") {
    if (pts.length < 4) return null;
    const pairs: [number, number][] = [];
    for (let at = 0; at + 1 < pts.length; at += 2) pairs.push([pts[at], pts[at + 1]]);
    return poly(pairs);
  }
  const [x1, y1, x2, y2] = pts;
  const [x, y, w, h] = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
  if (w < 2 && h < 2) return null;
  if (tool === "ring") return ring(r1(x + w / 2), r1(y + h / 2), r1(Math.max(1, w / 2)), r1(Math.max(1, h / 2)));
  if (tool === "box") return quad(r1(x), r1(y), r1(Math.max(1, w)), r1(Math.max(1, h)), 0.8);
  return wavy(r1(x), r1(y + h / 2), r1(x + Math.max(2, w)), Math.min(3, Math.max(1, h / 2)));
}

// 아이콘을 종이 그림으로. 이름 칸과 판 크기는 바탕 그대로라 부르는 쪽 자리 계산이 바뀌지 않아요.
// 채운 도장은 그 형식 색으로 칠해요. 색은 파일 형식에만 쓰는 규칙 그대로예요.
export function iconArt(icon: Pick<KindIcon, "id" | "kind" | "base" | "strokes" | "at">): PaperArt {
  const base = baseOf(icon.kind, icon.base);
  const parts: PaperPart[] = icon.strokes.flatMap((stroke): PaperPart[] => {
    const d = strokePath(stroke);
    if (!d) return [];
    const closed = stroke.tool === "ring" || stroke.tool === "box";
    return closed && stroke.fill ? [{ d, fill: "color" }, { d, pen: 0.7 }] : [{ d, pen: 0.7 }];
  });
  // id에 고친 시각을 붙여야 펜 선 캐시가 옛 그림을 돌려주지 않아요.
  return { ...base, id: `my-${icon.id}-${icon.at}-${icon.strokes.length}`, parts: [...base.parts, ...parts] };
}

const isKind = (value: unknown): value is Kind => typeof value === "string" && Object.hasOwn(kindLabels, value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// 저장소에서 읽은 값은 믿지 않아요. 망가진 칸은 버리고, 점은 종이 안으로 넣고, 개수는 상한까지만 둬요.
export function normalizeKindIcons(value: unknown): KindIconStore {
  const raw = (value ?? {}) as Partial<KindIconStore>;
  const seen = new Set<string>();
  const icons = (Array.isArray(raw.icons) ? raw.icons : []).flatMap((item): KindIcon[] => {
    const icon = (item ?? {}) as Partial<KindIcon>;
    if (typeof icon.id !== "string" || !icon.id || seen.has(icon.id) || !isKind(icon.kind)) return [];
    seen.add(icon.id);
    const base = baseOf(icon.kind, typeof icon.base === "string" ? icon.base : "");
    const strokes = (Array.isArray(icon.strokes) ? icon.strokes : []).flatMap((part): IconStroke[] => {
      const stroke = (part ?? {}) as Partial<IconStroke>;
      if (!tools.includes(stroke.tool as IconTool) || !Array.isArray(stroke.pts)) return [];
      const nums = stroke.pts.filter(finite).slice(0, stroke.tool === "pen" ? pointLimit * 2 : 4);
      const pts: number[] = [];
      for (let at = 0; at + 1 < nums.length; at += 2) pts.push(...clampPoint(base, nums[at], nums[at + 1]));
      if (pts.length < 4) return [];
      return [{ tool: stroke.tool as IconTool, pts, fill: stroke.fill === true }];
    }).slice(0, strokeLimit);
    return [{ id: icon.id, kind: icon.kind, base: base.id, strokes, name: typeof icon.name === "string" ? icon.name.trim().slice(0, kindIconNameMax) : "", at: finite(icon.at) ? icon.at : 0 }];
  }).slice(0, kindIconLimit);
  const use: KindIconStore["use"] = {};
  const usable = raw.use && typeof raw.use === "object" ? (raw.use as Record<string, unknown>) : {};
  for (const kind of kinds) {
    const id = usable[kind];
    // 지운 아이콘이나 다른 형식의 아이콘을 가리키면 기본 종이로 돌아가요.
    if (typeof id === "string" && icons.some((icon) => icon.id === id && icon.kind === kind)) use[kind] = id;
  }
  return { icons, use };
}
