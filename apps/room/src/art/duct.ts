import type { Thing } from "../domain/model";
import { hash } from "../domain/sky";
import { colorGroups } from "./palette";

// 방 하나 = 받침 위에 선 주름관 하나. 좌표는 136×130 칸이고, 선은 굵기가 흔들리는 채운 리본이라 손으로 그린 맛이 납니다.
// 같은 값이면 언제나 같은 선이 나와요. 다시 그려도 흔들리지 않습니다.
type Pt = [number, number];
type Spec = {
  line?: string;
  points?: Pt[];
  width: number;
  rib: number;
  scallop: number;
  head: [number, number, number, number];
  inner: [number, number, number, number];
  eyes: [Pt, Pt];
  foot: string;
  arms: string[];
  face?: "happy" | "closed" | "wide";
  ticks?: string[];
  paperAt?: [number, number, number];
  // 삼킨 파일이 지나가는 자리. 관 길이의 비율과 불룩한 정도예요.
  bulge?: [number, number];
  eyeScale?: number;
};

export type DuctTone = "ink" | "white" | "foot" | "paper" | "solid" | "layer";
export type DuctPiece = { d: string; tone: DuctTone; even?: boolean; color?: string; i?: number; n?: number };
// 살아 있는 그림에서 표정 시트가 앉을 자리: 얼굴의 가운데와 반지름.
export type DuctFaceSlot = { face: [number, number, number, number] };
export type DuctPart = "head" | "armL" | "armR";
export type DuctGroup = { rib?: number; transform?: string; part?: DuctPart; parts: (DuctPiece | DuctFaceSlot)[] };
export type DuctDrawing = { viewBox: string; items: (DuctPiece | DuctGroup)[] };
export type DuctLayer = { label: string; color: string; share: number };
export type DuctPose = "idle" | "watch" | "offer" | "move" | "done" | "rest" | "shock";

const f1 = (n: number) => n.toFixed(1).replace(/\.0$/, "");

function flatten(d: string): { pts: Pt[]; closed: boolean }[] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
  const subs: { pts: Pt[]; closed: boolean }[] = [];
  let pts: Pt[] = [];
  let closed = false;
  let cmd = "";
  let cur: Pt = [0, 0];
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLCZ]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === "M") {
      if (pts.length) subs.push({ pts, closed });
      cur = [num(), num()];
      pts = [cur];
      closed = false;
      cmd = "L";
    } else if (cmd === "L") {
      cur = [num(), num()];
      pts.push(cur);
    } else if (cmd === "C") {
      const [a, b, c, e, x, y] = [num(), num(), num(), num(), num(), num()];
      for (let s = 1; s <= 16; s += 1) {
        const t = s / 16;
        const u = 1 - t;
        pts.push([u * u * u * cur[0] + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * x, u * u * u * cur[1] + 3 * u * u * t * b + 3 * u * t * t * e + t * t * t * y]);
      }
      cur = [x, y];
    } else if (cmd === "Z") {
      closed = true;
    }
  }
  if (pts.length) subs.push({ pts, closed });
  return subs;
}

function resample(points: Pt[], closed: boolean, step: number): { out: Pt[]; total: number } {
  const pts = closed ? [...points, points[0]] : points;
  const lens = [0];
  for (let k = 1; k < pts.length; k += 1) lens.push(lens[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const total = lens[lens.length - 1] || 1;
  const n = Math.max(3, Math.round(total / step));
  const out: Pt[] = [];
  let at = 0;
  for (let s = 0; s < (closed ? n : n + 1); s += 1) {
    const want = (s / n) * total;
    while (at < lens.length - 2 && lens[at + 1] < want) at += 1;
    const f = (want - lens[at]) / (lens[at + 1] - lens[at] || 1);
    out.push([pts[at][0] + (pts[at + 1][0] - pts[at][0]) * f, pts[at][1] + (pts[at + 1][1] - pts[at][1]) * f]);
  }
  return { out, total };
}

function smooth(pts: Pt[]): string {
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[pts.length - 1], pts[0]);
  return `M${f1(start[0])} ${f1(start[1])}${pts.map((p, i) => {
    const m = mid(p, pts[(i + 1) % pts.length]);
    return `Q${f1(p[0])} ${f1(p[1])} ${f1(m[0])} ${f1(m[1])}`;
  }).join("")}Z`;
}

const wave = (t: number, k: number, seed: number) => Math.sin(2 * Math.PI * k * t + seed * 2.399) * 0.6 + Math.sin(2 * Math.PI * (k * 2 + 1) * t + seed * 1.13) * 0.4;

// 펜 하나. 그을 때마다 다음 씨앗을 써서 선마다 다르게, 그러나 언제나 같게 흔들립니다. 파일 종이(ObjectShape)도 같은 펜으로 그려요.
// step은 선을 따라 점을 찍는 간격이에요. 작게 그리는 종이는 화면 1px보다 촘촘한 점이 보이지 않으니 넓게 찍어요.
export function makePen(start: number, step = 2.6, roughness = 1) {
  let count = start;
  return (d: string, w: number, tone: DuctTone = "ink"): DuctPiece[] =>
    flatten(d).map(({ pts, closed }) => {
      count += 1;
      const seed = count % 97;
      const { out, total } = resample(pts, closed, step);
      const n = out.length;
      const k1 = Math.max(1, Math.round(total / 34));
      const k2 = Math.max(1, Math.round(total / 26));
      const L: Pt[] = [];
      const R: Pt[] = [];
      out.forEach((p, i) => {
        const a = closed ? out[(i - 1 + n) % n] : out[Math.max(0, i - 1)];
        const b = closed ? out[(i + 1) % n] : out[Math.min(n - 1, i + 1)];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const m = Math.hypot(dx, dy) || 1;
        const nx = -dy / m;
        const ny = dx / m;
        const t = i / (closed ? n : n - 1);
        const shift = wave(t, k1, seed) * 0.5 * roughness;
        let half = (w / 2) * (1 + wave(t, k2, seed + 11) * 0.26 * roughness);
        if (!closed) half *= Math.min(1, 0.42 + (Math.min(t, 1 - t) * total) / 5);
        L.push([p[0] + nx * (shift + half), p[1] + ny * (shift + half)]);
        R.push([p[0] + nx * (shift - half), p[1] + ny * (shift - half)]);
      });
      return closed ? { d: smooth(L) + smooth([...R].reverse()), tone, even: true } : { d: smooth([...L, ...[...R].reverse()]), tone };
    });
}

const oval = ([x, y, rx, ry]: readonly number[]) => `M${x - rx} ${y}C${x - rx} ${y - ry * 1.32} ${x + rx} ${y - ry * 1.32} ${x + rx} ${y}C${x + rx} ${y + ry * 1.32} ${x - rx} ${y + ry * 1.32} ${x - rx} ${y}Z`;
const poly = (pts: Pt[]) => `M${pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join("L")}Z`;
const open = (pts: Pt[]) => `M${pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join("L")}`;

function collar([x, y, rx, ry]: Spec["head"]): string {
  const pt = (dx: number, dy: number) => `${f1(x + dx * rx)} ${f1(y + dy * ry)}`;
  return `M${pt(-1, 0.03)}C${pt(-1, -0.53)} ${pt(-0.53, -1)} ${pt(0.03, -1)}`
    + `C${pt(0.6, -1)} ${pt(1, -0.58)} ${pt(1, -0.04)}`
    + `C${pt(1, 0.53)} ${pt(0.54, 1)} ${pt(-0.06, 1)}`
    + `C${pt(-0.63, 1)} ${pt(-1, 0.59)} ${pt(-1, 0.03)}Z`;
}

function footAt(x: number): string {
  return `M${x - 19} 106L${x + 17} 106`
    + `C${x + 20} 106 ${x + 21} 107 ${x + 22} 109L${x + 23} 111`
    + `C${x + 24} 113 ${x + 22} 114 ${x + 20} 114L${x - 22} 114`
    + `C${x - 24} 114 ${x - 26} 113 ${x - 25} 111L${x - 24} 109`
    + `C${x - 23} 107 ${x - 22} 106 ${x - 19} 106Z`;
}

// 주름선을 받침 쪽으로 살짝 휘어 관의 둥근 단면을 보여 줘요.
function ribSeam([lx, ly]: Pt, [rx, ry]: Pt): string {
  const dx = rx - lx;
  const dy = ry - ly;
  const control = (t: number) => `${f1(lx + dx * t + dy * 0.08)} ${f1(ly + dy * t - dx * 0.08)}`;
  return `M${f1(lx)} ${f1(ly)}C${control(1 / 3)} ${control(2 / 3)} ${f1(rx)} ${f1(ry)}`;
}

const tilt = (-8 * Math.PI) / 180;
function dot(x: number, y: number, r: number, tone: DuctTone = "ink"): DuctPiece {
  const dx = r * Math.cos(tilt);
  const dy = r * Math.sin(tilt);
  const ry = f1(r * 1.14);
  return { d: `M${f1(x - dx)} ${f1(y - dy)}A${f1(r)} ${ry} -8 1 0 ${f1(x + dx)} ${f1(y + dy)}A${f1(r)} ${ry} -8 1 0 ${f1(x - dx)} ${f1(y - dy)}Z`, tone };
}

function tube(spec: Spec) {
  const out = spec.points ?? resample(flatten(spec.line!)[0].pts, false, 2).out;
  const L: Pt[] = [];
  const R: Pt[] = [];
  out.forEach((p, i) => {
    const a = out[Math.max(0, i - 1)];
    const b = out[Math.min(out.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    const swell = spec.bulge ? spec.bulge[1] * Math.exp(-(((i / (out.length - 1) - spec.bulge[0]) / 0.1) ** 2)) : 0;
    const fold = Math.sin((Math.PI * i) / spec.rib) ** 2;
    const half = spec.width / 2 + spec.scallop * fold + swell;
    // 꺾이는 안쪽은 굵기보다 반지름이 작으면 선이 되돌아가 엉킵니다. 되돌아가는 점은 앞 점에 붙여 접습니다.
    const unfold = (side: Pt[], point: Pt): Pt => {
      const last = side[side.length - 1];
      return last && (point[0] - last[0]) * dx + (point[1] - last[1]) * dy <= 0 ? last : point;
    };
    L.push(unfold(L, [p[0] - (dy / m) * half, p[1] + (dx / m) * half]));
    R.push(unfold(R, [p[0] + (dy / m) * half, p[1] - (dx / m) * half]));
  });
  return { L, R, body: poly([...L, ...[...R].reverse()]) };
}

function layerColorAt(layers: DuctLayer[], at: number): string | null {
  let upTo = 0;
  for (const layer of layers) {
    upTo += layer.share;
    if (at <= upTo) return layer.color;
  }
  return layers.at(-1)?.color ?? null;
}

const armEnd = (d: string): Pt => (d.match(/-?\d*\.?\d+/g) ?? []).slice(-2).map(Number) as Pt;

function draw(spec: Spec, { w, layers = [], moving = false, seed = 1, live = false, flow = false }: { w: number; layers?: DuctLayer[]; moving?: boolean; seed?: number; live?: boolean; flow?: boolean }): DuctDrawing["items"] {
  const pen = makePen(seed, 2.2, 0.48);
  const { L, R, body } = tube(spec);
  const rim = collar(spec.head);
  const shell = [{ d: rim, tone: "white" as const }, ...pen(rim, w * 0.9)];
  const items: DuctDrawing["items"] = [];
  // 팔은 관 뒤에서 나오고, 끝에 작은 손을 답니다.
  spec.arms.forEach((arm, at) => {
    const [x, y] = armEnd(arm);
    const pieces = [...pen(arm, w * 0.78), dot(x, y, Math.max(2.1, w * 0.68))];
    if (live) items.push({ part: at === 0 ? "armL" : "armR", parts: pieces });
    else items.push(...pieces);
  });
  items.push({ d: spec.foot, tone: "foot" }, ...pen(spec.foot, w * 0.83));
  const last = L.length - 1;
  if (moving) {
    // 주름 한 칸씩 부풀어 파일이 관을 지나가는 것처럼 보입니다.
    for (let i = 0, rib = 0; i < last; i += spec.rib, rib += 1) {
      const end = Math.min(last, i + spec.rib);
      const left = L.slice(i, end + 1);
      const right = R.slice(i, end + 1);
      const color = layerColorAt(layers, (i + end) / 2 / last);
      const fill = poly([...left, ...[...right].reverse()]);
      items.push({ rib, parts: [color && layers.length ? { d: fill, tone: "layer", color } : { d: fill, tone: "white" }, ...pen(open(left), w * 0.9), ...pen(open(right), w * 0.9), ...pen(open([L[end], R[end]]), w * 0.55)] });
    }
  } else {
    items.push({ d: body, tone: "white" });
    // 인트로에서 색이 관을 따라 흐르도록 얇게 썹니다. 다음 조각이 한 칸 겹쳐 조각 사이 틈이 안 보여요.
    for (let i = 0; flow && layers.length && i < last; i += 1) {
      items.push({ d: poly([...L.slice(i, i + 3), ...R.slice(i, i + 3).reverse()]), tone: "layer", color: layerColorAt(layers, (i + 0.5) / last)!, i, n: last });
    }
    let from = 0;
    (flow ? [] : layers).forEach(({ color, share }, i) => {
      const isLast = i === layers.length - 1;
      const to = isLast ? last : Math.min(last, from + Math.round(last * share));
      if (to > from) items.push({ d: poly([...L.slice(from, Math.min(last, to + 1) + 1), ...R.slice(from, Math.min(last, to + 1) + 1).reverse()]), tone: "layer", color, i, n: layers.length });
      from = to;
    });
    items.push(...pen(body, w * 0.9));
    for (let i = spec.rib; i < L.length - 2; i += spec.rib) items.push(...pen(ribSeam(L[i], R[i]), w * 0.55));
  }
  // 살아 있는 그림의 얼굴은 표정 시트가 맡습니다. 머리는 끄덕이고 갸웃하게 한 덩어리로 묶어요.
  if (live) {
    items.push({ part: "head", parts: [...shell, { face: spec.inner }] });
    for (const tick of spec.ticks ?? []) items.push(...pen(tick, w * 0.8));
    if (spec.paperAt) items.push(paperGroup(spec.paperAt, w, pen));
    return items;
  }
  items.push(...shell, { d: oval(spec.inner), tone: "ink" });
  const [a, b] = spec.eyes;
  const r = Math.max(3.4, w) * (spec.eyeScale ?? 1);
  if (spec.face === "happy") {
    for (const [x, y] of [a, b]) items.push(...pen(`M${x - 5} ${y + 2}C${x - 3} ${y - 4} ${x + 3} ${y - 4} ${x + 5} ${y + 2}`, w * 0.85, "white"));
  } else if (spec.face === "closed") {
    for (const [x, y] of [a, b]) items.push(...pen(`M${x - 5} ${y}L${x + 5} ${y}`, w * 0.9, "white"));
  } else if (spec.face === "wide") {
    items.push(dot(a[0], a[1], r + 2.4, "white"), dot(b[0], b[1], r + 2.8, "white"), dot(a[0], a[1] + 1, 1.8), dot(b[0], b[1] + 1, 1.9));
  } else {
    items.push(dot(a[0], a[1], r, "white"), dot(b[0], b[1], r * 1.08, "white"));
  }
  for (const tick of spec.ticks ?? []) items.push(...pen(tick, w * 0.8));
  if (spec.paperAt) items.push(paperGroup(spec.paperAt, w, pen));
  return items;
}

function paperGroup([x, y, rot]: [number, number, number], w: number, pen: ReturnType<typeof makePen>): DuctGroup {
  const sheet = "M-11 -14L5 -14L11 -8L11 14L-11 14Z";
  return { transform: `translate(${x} ${y}) rotate(${rot})`, parts: [{ d: sheet, tone: "paper" }, ...pen(sheet, w * 0.8), ...pen("M5 -14L5 -8L11 -8", w * 0.55)] };
}

// 아주 작게 그릴 때는 선이 뭉쳐요. 눈만 또렷한 실루엣으로 그립니다.
function silhouette(spec: Spec): DuctDrawing["items"] {
  const [a, b] = spec.eyes;
  return [{ d: spec.foot, tone: "solid" }, { d: tube(spec).body, tone: "solid" }, { d: oval(spec.head), tone: "solid" }, dot(a[0], a[1], 6, "white"), dot(b[0], b[1], 6.4, "white")];
}

// 크게 그려도 화면에 보이는 선 굵기는 비슷하게 둡니다. px는 그림이 차지하는 폭이에요.
export const ductWeight = (px: number) => (px >= 260 ? 1.9 : px >= 200 ? 2.4 : px >= 140 ? 3 : px >= 100 ? 3.5 : px >= 64 ? 4.4 : px >= 40 ? 6 : 8.5);
export const ductSilhouetteUnder = 32;

const board = { x: -8, y: -8, w: 136, h: 130 };
const boardBox = `${board.x} ${board.y} ${board.w} ${board.h}`;

// ── 플로팅 창(메뉴 막대 작은 창)의 자세 7가지 ──
// 2026-11-17: 한쪽으로 휘지 않고 받침 가운데(x 60)에서 위로 곧게 서요(요청: 방향을 띠며 휘는 게 별로라서). 자세는 팔·머리 높이·종이로만 달라요.
const stand = { line: "M60 108C60 90 60 70 60 50", width: 34, rib: 6, scallop: 2.2, head: [60, 36, 29, 25], inner: [60, 36, 22, 18], eyes: [[50, 35], [71, 34]], foot: footAt(60) } as const;
const leftArm = "M46 82C38 82 32 86 29 93";
const poses: Record<DuctPose, Spec> = {
  idle: { ...stand, head: [...stand.head], inner: [...stand.inner], eyes: [[50, 35], [71, 34]], arms: [leftArm, "M74 80C82 79 89 82 94 89"] },
  watch: { ...stand, head: [...stand.head], inner: [...stand.inner], eyes: [[55, 35], [76, 34]], arms: [leftArm, "M74 80C82 79 89 82 94 89"] },
  offer: { ...stand, head: [...stand.head], inner: [...stand.inner], eyes: [[52, 35], [73, 34]], arms: [leftArm, "M74 80C84 81 94 82 102 80"], paperAt: [112, 78, 10] },
  move: { ...stand, head: [...stand.head], inner: [...stand.inner], eyes: [[50, 34], [71, 33]], arms: [leftArm, "M74 80C86 78 96 72 102 64"], paperAt: [104, 54, -6] },
  done: { ...stand, line: "M60 108C60 90 60 66 60 44", head: [60, 30, 29, 25], inner: [60, 30, 22, 18], eyes: [[50, 30], [71, 29]], face: "happy", foot: footAt(60), ticks: ["M20 14L12 8", "M102 12L110 5"], arms: ["M47 78C36 72 30 62 28 50", "M78 76C90 70 98 60 100 48"] },
  rest: { ...stand, line: "M60 108C60 102 60 96 60 90", rib: 3, head: [60, 78, 29, 24], inner: [60, 78, 22, 17], eyes: [[50, 78], [71, 77]], face: "closed", arms: ["M46 100C40 100 34 102 30 107", "M74 100C80 100 86 102 90 107"] },
  shock: { ...stand, line: "M60 108C60 90 60 66 60 46", head: [60, 32, 27, 23], inner: [60, 32, 20, 16], eyes: [[52, 31], [69, 30]], face: "wide", foot: footAt(60), arms: ["M44 76C34 70 26 62 20 62", "M76 78C88 72 98 62 104 50"], ticks: ["M92 18L100 12", "M96 34L106 32"] },
};

export function drawPose(pose: DuctPose, { px, layers, live, flow }: { px: number; layers?: DuctLayer[]; live?: boolean; flow?: boolean }): DuctDrawing {
  return { viewBox: boardBox, items: draw(poses[pose], { w: ductWeight(px), layers, moving: pose === "move", live, flow }) };
}

// ── 인트로에서 파일을 먹는 프레임. 스프라이트 시트(art/duct-eat.png)의 원본이고, 0번은 idle과 같아 인트로의 벡터 그림과 이어집니다. ──
// 2026-11-17: 자세처럼 받침 가운데(x 60)에서 위로 곧게 서서 먹어요. 삼키는 동안 허리만 좌우로 조금 꿈틀대고, 머리는 늘 몸 바로 위예요.
// 허리가 휘어도 팔이 몸에서 떨어지지 않게 관 안쪽에서 시작합니다.
const armsUp = ["M58 82C42 78 32 72 30 64", "M66 80C84 76 92 70 96 62"];
const armsDown = ["M58 82C38 82 32 86 29 93", "M66 80C82 79 89 82 94 89"];
const mouth = (x: number, y: number, rx: number, ry: number, inRx: number, inRy: number) => ({ head: [x, y, rx, ry] as [number, number, number, number], inner: [x, y, inRx, inRy] as [number, number, number, number] });
// 받침과 목은 가운데에 두고 허리만 좌우로 휩니다. sway가 프레임마다 바뀌면 관이 꿈틀대요.
const wriggle = (sway: number, end: Pt = [60, 44]) => `M60 108C60 98 ${60 + sway} 92 ${60 + sway} 80C${60 + sway} 70 ${end[0]} ${end[1] + 12} ${end[0]} ${end[1]}`;
const wide = { ...mouth(60, 33, 32, 30, 25.5, 24.5), eyes: [[49, 20], [72, 19]] as [Pt, Pt], eyeScale: 0.85, arms: armsUp };
const tall = { ...mouth(60, 33, 31, 31, 24.5, 25.5), eyes: [[50, 19], [71, 18]] as [Pt, Pt], eyeScale: 0.85, arms: armsUp };
const closing = { ...mouth(60, 38, 32, 25, 25, 15), eyes: [[49, 33], [71, 32]] as [Pt, Pt], eyeScale: 0.85, arms: armsDown };
const shut = { ...mouth(60, 42, 34, 20, 27, 8), eyes: [[50, 42], [71, 41]] as [Pt, Pt], face: "closed" as const, arms: armsDown };
const chewUp = { ...mouth(60, 39, 31, 23, 24, 14), eyes: [[50, 38], [71, 37]] as [Pt, Pt], face: "happy" as const, arms: armsDown };
const shutEnd: Pt = [60, 50];
const eatFrames: Spec[] = [
  poses.idle,
  { ...poses.idle, ...mouth(60, 43, 30, 22, 23, 15), eyes: [[50, 42], [71, 41]] },
  { ...poses.idle, line: wriggle(0), ...mouth(60, 35, 30, 27.5, 23.5, 21), eyes: [[50, 27], [72, 26]], eyeScale: 0.95, arms: armsUp },
  { ...poses.idle, ...wide, line: wriggle(0) },
  { ...poses.idle, ...tall, line: wriggle(2) },
  // 받아먹는 한 바퀴: 입을 여닫는 동안 삼킨 덩어리가 위에서 아래로 내려가고 허리가 좌우로 휩니다.
  { ...poses.idle, ...wide, line: wriggle(4), bulge: [0.86, 6] },
  { ...poses.idle, ...closing, line: wriggle(6, shutEnd), bulge: [0.72, 7] },
  { ...poses.idle, ...shut, line: wriggle(2, shutEnd), bulge: [0.58, 7] },
  { ...poses.idle, ...closing, line: wriggle(-4, shutEnd), bulge: [0.44, 7] },
  { ...poses.idle, ...wide, line: wriggle(-6), bulge: [0.3, 7] },
  { ...poses.idle, ...tall, line: wriggle(-2), bulge: [0.16, 6] },
  { ...poses.idle, ...chewUp, line: wriggle(3, shutEnd) },
  { ...poses.idle, ...shut, ...mouth(60, 42, 32, 21, 25, 10), line: wriggle(-3, shutEnd) },
  // 마지막 꿀꺽: 가장 크게 불룩해져 받침까지 내려갑니다. 끝으로 갈수록 잦아들어 서 있는 그림에 닿아요.
  ...([[0.84, 8, 5], [0.62, 9, -5], [0.4, 9, 3], [0.18, 8, -2]] as const).map(([at, size, sway]): Spec => ({ ...poses.idle, line: wriggle(sway, shutEnd), bulge: [at, size], face: "happy", arms: armsDown })),
];
export const eatFrameCount = eatFrames.length;
export const eatBoard = { width: board.w, height: board.h };

export function drawEatFrame(frame: number, px: number): DuctDrawing {
  return { viewBox: boardBox, items: draw(eatFrames[frame], { w: ductWeight(px) }) };
}

// ── 표정 시트(art/duct-faces.png)의 프레임. 모든 프로도가 한 장을 같이 씁니다. 몸은 방마다 모양과 색이 달라 코드로 그려요. ──
const faceEyes: [Pt, Pt] = [[-10.5, -1.4], [10.5, -1.6]];
const faceOval = "M-22 0C-22 -23.8 22 -23.8 22 0C22 23.8 -22 23.8 -22 0Z";
const lookBy = (dx: number, dy: number): DuctPiece[] => faceEyes.map(([x, y]) => dot(x + dx, y + dy, 3.95, "white"));
const lidBy = (dx: number, dy: number): ((pen: ReturnType<typeof makePen>) => DuctPiece[]) => (pen) => faceEyes.flatMap(([x, y]) => pen(`M${x - 5 + dx} ${y + dy}L${x + 5 + dx} ${y + dy}`, 2.4, "white"));
const faceDraw = {
  base: () => lookBy(0, 0),
  blink: () => faceEyes.map(([x, y]) => ({ d: oval([x, y, 4, 1.5]), tone: "white" as const })),
  shut: lidBy(0, 0),
  lookR: () => lookBy(5, 0),
  lookDR: () => lookBy(4, 3),
  lookD: () => lookBy(0, 4),
  lookDL: () => lookBy(-4, 3),
  lookL: () => lookBy(-5, 0),
  lookUL: () => lookBy(-4, -3),
  lookU: () => lookBy(0, -4),
  lookUR: () => lookBy(4, -3),
  happy: (pen: ReturnType<typeof makePen>) => faceEyes.flatMap(([x, y]) => pen(`M${x - 5} ${y + 2}C${x - 3} ${y - 4} ${x + 3} ${y - 4} ${x + 5} ${y + 2}`, 2.2, "white")),
  wide: () => [...faceEyes.map(([x, y], at) => dot(x, y, at ? 6.2 : 5.8, "white")), ...faceEyes.map(([x, y]) => dot(x, y + 1, 1.9))],
  worried: (pen: ReturnType<typeof makePen>) => [...lookBy(0, 3), ...pen("M-16 -6L-7 -10", 2, "white"), ...pen("M8 -11L17 -7", 2, "white")],
  sleepy: lidBy(0, 3),
  tilt: () => [dot(-11, -5, 3.8, "white"), dot(11, 2, 4.1, "white")],
};
export type FaceExpr = keyof typeof faceDraw;
export const faceFrames = Object.keys(faceDraw) as FaceExpr[];
export const faceCell = { width: 240, height: 196 };

export function drawFaceFrame(frame: number): DuctDrawing {
  const pen = makePen(frame + 1, 2.2, 0.48);
  return { viewBox: "-22 -18 44 36", items: [{ d: faceOval, tone: "ink" }, ...faceDraw[faceFrames[frame]](pen)] };
}

// 로고: 프로도 얼굴만. 치수는 판 824의 황금비 수열 g(n)=824/φⁿ 이에요.
// 얼굴 폭 g1(좌우 여백 g2/2씩), 높이 g2+g4, 테 두께 g5, 펜 g7, 눈 g5×2g6·사이 g3, 눈높이는 가운데보다 g8 위.
// 펜이 방 그림과 같은 결로 흔들리게 머리 반지름을 29칸으로 줄여 그리고, viewBox가 판 824 전체예요.
const phi = (1 + Math.sqrt(5)) / 2;
const g = (n: number) => 824 / phi ** n;
export function drawBrandFace(): DuctDrawing {
  const u = (px: number) => (px * 29 * 2) / g(1);
  const rim = [0, 0, u(g(1) / 2), u((g(2) + g(4)) / 2)];
  const hole = [0, 0, rim[2] - u(g(5)), rim[3] - u(g(5))];
  const eyes = [-1, 1].map((side) => ({ d: oval([u((side * g(3)) / 2), -u(g(8)), u(g(5) / 2), u(g(6))]), tone: "white" as const }));
  return { viewBox: `${f1(-u(412))} ${f1(-u(412))} ${f1(u(824))} ${f1(u(824))}`, items: [{ d: oval(rim), tone: "white" }, ...makePen(1)(oval(rim), u(g(7))), { d: oval(hole), tone: "ink" }, ...eyes] };
}

// 커서가 어느 쪽에 있는지로 볼 곳을 고릅니다. 화면 좌표라 y는 아래가 +예요.
const lookOrder: FaceExpr[] = ["lookR", "lookDR", "lookD", "lookDL", "lookL", "lookUL", "lookU", "lookUR"];
export function lookExpr(dx: number, dy: number): FaceExpr {
  return lookOrder[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
}

export const poseFace: Record<DuctPose, FaceExpr> = { idle: "base", watch: "lookR", offer: "lookR", move: "lookU", done: "happy", rest: "sleepy", shock: "wide" };

// ── 방마다 다른 주름관 8가지. 길이는 용량이라 긴 선을 용량만큼만 잘라 씁니다. ──
const roomLines = [
  "M18 108C18 78 16 58 32 46C50 34 74 58 92 44C104 36 106 26 102 20",
  "M102 108C102 78 104 58 88 46C70 34 46 58 28 44C16 36 14 26 18 20",
  "M36 108C36 88 36 72 44 60C50 52 58 48 68 46C80 44 88 38 92 26",
  "M84 108C84 88 84 72 76 60C70 52 62 48 52 46C40 44 32 38 28 26",
  "M50 108C46 94 44 84 50 72C56 62 66 56 66 44C66 36 62 30 58 24",
  "M70 108C74 94 76 84 70 72C64 62 54 56 54 44C54 36 58 30 62 24",
  "M60 108C60 90 58 70 60 50C61 40 62 34 62 24",
  "M36 108C36 94 42 84 52 74C62 64 64 52 58 42C54 34 54 30 58 22",
];
const roomPaths = roomLines.map((line) => resample(flatten(line)[0].pts, false, 2).out);
export const ductShapeCount = roomLines.length;
const shortest = 0.34;
// 길이는 용량만 뜻해요. 선마다 길이가 달라 비율로 자르면 같은 용량도 모양 따라 길이가 달랐어요.
// 그래서 가장 짧은 선의 길이를 끝으로 두고, 어느 모양이든 같은 점 수(점 간격이 같아 같은 길이)만큼 잘라요.
const reach = Math.min(...roomPaths.map((path) => path.length)) - 1;
export function ductReach(length: number): number {
  const level = Math.min(1, Math.max(0, length));
  return Math.max(8, Math.round(reach * (shortest + (1 - shortest) * level)));
}
function roomSpec(shape: number, length: number): Spec {
  const level = Math.min(1, Math.max(0, length));
  const path = roomPaths[shape % ductShapeCount];
  const points = path.slice(0, ductReach(level) + 1);
  const end = points[points.length - 1];
  const back = points[points.length - 5];
  const span = Math.hypot(end[0] - back[0], end[1] - back[1]) || 1;
  const x = end[0] + ((end[0] - back[0]) / span) * 8;
  const y = end[1] + ((end[1] - back[1]) / span) * 8;
  const rx = 29 - 4 * level;
  const ry = rx * 0.86;
  const spec: Spec = { points, width: 34 - 8 * level, rib: 6, scallop: 2.2, head: [x, y, rx, ry], inner: [x, y, rx - 7, ry - 7], eyes: [[x - 10, y - 1], [x + 11, y - 2]], foot: "", arms: [] };
  const base = points[0][0];
  spec.foot = footAt(base);
  // 팔은 받침에서 일정한 높이에 답니다. 관이 짧으면 가운데쯤이에요.
  const { L, R } = tube(spec);
  const at = Math.min(Math.round(L.length / 2), 18);
  const center: Pt = [(L[at][0] + R[at][0]) / 2, (L[at][1] + R[at][1]) / 2];
  spec.arms = [L[at], R[at]].map((p) => {
    const m = Math.hypot(p[0] - center[0], p[1] - center[1]) || 1;
    const nx = (p[0] - center[0]) / m;
    const ny = (p[1] - center[1]) / m;
    const pt = (out: number, down: number) => `${f1(p[0] + nx * out)} ${f1(p[1] + ny * out + down)}`;
    return `M${pt(-2, 0)}C${pt(6, 0)} ${pt(12, 2)} ${pt(15, 8)}`;
  });
  return spec;
}

// 그림 판을 방마다 옮겨 몸이 판 가운데에 오게 합니다. 이름표가 몸 아래 가운데에 앉아요.
function centeredLeft(spec: Spec): number {
  const { L, R } = tube(spec);
  const xs = [...L, ...R].map((p) => p[0]);
  const [hx, , rx] = spec.head;
  const base = spec.points![0][0];
  const left = Math.min(...xs, hx - rx, base - 26);
  const right = Math.max(...xs, hx + rx, base + 24);
  return Math.round((left + right) / 2 - board.w / 2);
}

export function drawRoom(shape: number, length: number, { px, layers, live }: { px: number; layers?: DuctLayer[]; live?: boolean }): DuctDrawing {
  const spec = roomSpec(shape, length);
  const viewBox = `${centeredLeft(spec)} ${board.y} ${board.w} ${board.h}`;
  return { viewBox, items: px < ductSilhouetteUnder ? silhouette(spec) : draw(spec, { w: ductWeight(px), layers, seed: shape + 1, live }) };
}

// 머리의 자리. 그림 칸 가운데를 0으로, 칸 폭을 1로 잽니다. 파일이 이 입에서 나와요.
export function ductMouth(shape: number, length: number): { x: number; y: number } {
  const spec = roomSpec(shape, length);
  return { x: (spec.head[0] - centeredLeft(spec) - board.w / 2) / board.w, y: (spec.head[1] - board.y - board.h / 2) / board.w };
}

// ── 홈의 프로도 한 명. 방을 먹이면 그 방 용량만큼 몸이 늘어나요. ──
// 아무것도 안 먹으면 받침 위에 목만 내민 짧은 몸(stub)이에요. 마디 0이 머리 바로 아래이고, 뒤 마디일수록 받침 쪽이에요. 작은 방도 늘어난 게 보이게 최소 길이를 둡니다.
const stub = 16;
const segMin = 10;
const segGrow = 90;
const stackX = 52;
const neckR = 24;
export const stackSegLength = (length: number) => segMin + segGrow * Math.min(1, Math.max(0, length));

function stackSpec(lengths: number[]) {
  const total = stub + lengths.reduce((sum, length) => sum + stackSegLength(length), 0);
  const points: Pt[] = [];
  // 받침에서 위로 곧게 서요. 점 간격 2라 마디 경계를 점 번호로 잘라요.
  // 옆으로 흔들거나 고개를 오른쪽으로 꺾지 않아요(2026-11-17 요청: 한쪽으로 휘는 모양이 별로라서). 목은 예전 고개 숙인 호와 같은 길이만큼 곧게 더 올라가요.
  const neck = (neckR * 50 * Math.PI) / 180;
  for (let t = 0; t <= total + neck; t += 2) points.push([stackX, 108 - t]);
  let at = 0;
  const cuts = [0, ...[...lengths].reverse().map((length) => (at += stackSegLength(length)) / 2)].map((cut) => Math.round(cut + stub / 2)).reverse();
  const end = points[points.length - 1];
  const back = points[points.length - 5];
  const span = Math.hypot(end[0] - back[0], end[1] - back[1]) || 1;
  const x = end[0] + ((end[0] - back[0]) / span) * 8;
  const y = end[1] + ((end[1] - back[1]) / span) * 8;
  const rx = 27;
  const ry = rx * 0.86;
  const spec: Spec = { points, width: 30, rib: 6, scallop: 2.2, head: [x, y, rx, ry], inner: [x, y, rx - 7, ry - 7], eyes: [[x - 10, y - 1], [x + 11, y - 2]], foot: footAt(stackX), arms: [] };
  const { L, R } = tube(spec);
  const armAt = Math.min(Math.round(L.length / 2), 12);
  const center: Pt = [(L[armAt][0] + R[armAt][0]) / 2, (L[armAt][1] + R[armAt][1]) / 2];
  spec.arms = [L[armAt], R[armAt]].map((p) => {
    const m = Math.hypot(p[0] - center[0], p[1] - center[1]) || 1;
    const nx = (p[0] - center[0]) / m;
    const ny = (p[1] - center[1]) / m;
    const pt = (out: number, down: number) => `${f1(p[0] + nx * out)} ${f1(p[1] + ny * out + down)}`;
    return `M${pt(-2, 0)}C${pt(6, 0)} ${pt(12, 2)} ${pt(15, 8)}`;
  });
  // cuts[i]~cuts[i+1]: 마디 i의 점 번호(머리 쪽 끝부터). 0번째 값이 목이 시작하는 자리예요.
  return { spec, cuts, L, R };
}

export type StackGeometry = { box: [number, number, number, number]; segs: { top: number; bottom: number; left: number; right: number }[]; mouth: Pt; right: number };

// 그리지 않고 자리만 잽니다. 배치(heroLayout)가 마디마다 단추와 이름표를 붙이는 데 써요. 좌표는 그림 판 단위예요.
export function stackGeometry(lengths: number[]): StackGeometry {
  const { spec, cuts, L, R } = stackSpec(lengths);
  const [hx, hy, , ry] = spec.head;
  const top = Math.floor(Math.min(hy - ry - 6, ...L.map((p) => p[1]), ...R.map((p) => p[1])));
  const box: [number, number, number, number] = [board.x, top, board.w, 122 - top];
  const xs = (from: number, to: number) => [...L.slice(from, to + 1), ...R.slice(from, to + 1)];
  // 위아래는 가운데 선의 경계 점으로 잽니다. 주름 굴곡으로 재면 이웃 마디와 몇 칸씩 겹쳐요.
  const line = spec.points!;
  const segs = lengths.map((_, i) => {
    const pts = xs(cuts[i + 1], cuts[i]);
    return { top: line[cuts[i]][1], bottom: line[cuts[i + 1]][1], left: Math.min(...pts.map((p) => p[0])), right: Math.max(...pts.map((p) => p[0])) };
  });
  return { box, segs, mouth: [hx, hy], right: Math.max(...xs(0, cuts[0]).map((p) => p[0])) };
}

// 몸은 마디를 나누지 않은 관 하나예요. 먹은 방 용량만큼 길어지고, layers를 주면 그 방 파일 형식 색을 받침부터 용량 비율만큼 칠해요.
// 차오르는 움직임은 칠한 색 위에 가림 네모 하나를 아래에서 위로 걷어 올려 만들어요(RoomFace wipe). 얇은 조각으로 나누면 조각 사이 줄무늬가 보였어요.
export function drawStack(lengths: number[], { px, live, layers = [] }: { px: number; live?: boolean; layers?: DuctLayer[] }): DuctDrawing {
  const { spec } = stackSpec(lengths);
  const [x, y, bw, bh] = stackGeometry(lengths).box;
  return { viewBox: `${x} ${y} ${bw} ${bh}`, items: draw(spec, { w: ductWeight(px), seed: 31, live, layers }) };
}

// 용량을 길이로 바꿉니다. 1MB가 가장 짧고 128GB에서 끝까지 자라요. 로그라 작은 방끼리도 차이가 보입니다.
export function ductLength(bytes: number): number {
  return bytes > 1024 * 1024 ? Math.min(1, Math.log2(bytes / (1024 * 1024)) / 17) : 0;
}

// 같은 방은 언제나 같은 모양입니다. 저장하지 않고 방 id에서 정합니다.
export function ductIndex(roomId: string): number {
  return Math.floor(hash(roomId, 11) * ductShapeCount);
}

// 받침에서 머리 쪽으로 형식별 용량 비율만큼 주름을 칠합니다.
export function ductLayers(parts: { label: string; color: string; size: number }[]): DuctLayer[] {
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  return total === 0 ? [] : parts.map(({ label, color, size }) => ({ label, color, share: size / total }));
}

// 파일을 색 묶음으로 나눠 용량을 더합니다. 목록의 색 막대와 주름관이 함께 씁니다.
export function kindParts(things: Thing[]): { label: string; color: string; size: number }[] {
  return colorGroups
    .map(({ label, color, kinds }) => ({ label, color, size: things.reduce((sum, thing) => (!thing.missing && kinds.includes(thing.kind) ? sum + thing.size : sum), 0) }))
    .filter((part) => part.size > 0);
}

export function kindSummary(parts: { label: string; size: number }[]): string {
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  return [...parts].sort((a, b) => b.size - a.size).slice(0, 3).map((part) => `${part.label} ${Math.round((part.size / total) * 100)}%`).join(", ");
}
