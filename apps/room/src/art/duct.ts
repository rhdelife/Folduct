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
export function makePen(start: number, step = 2.6) {
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
        const shift = wave(t, k1, seed) * 0.5;
        let half = (w / 2) * (1 + wave(t, k2, seed + 11) * 0.26);
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
    const half = spec.width / 2 + spec.scallop * Math.abs(Math.sin((Math.PI * i) / spec.rib)) + swell;
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

function draw(spec: Spec, { w, layers = [], moving = false, seed = 1, live = false }: { w: number; layers?: DuctLayer[]; moving?: boolean; seed?: number; live?: boolean }): DuctDrawing["items"] {
  const pen = makePen(seed);
  const { L, R, body } = tube(spec);
  const items: DuctDrawing["items"] = [];
  // 팔은 관 뒤에서 나오고, 끝에 작은 손을 답니다.
  spec.arms.forEach((arm, at) => {
    const [x, y] = armEnd(arm);
    const pieces = [...pen(arm, w), dot(x, y, Math.max(2.4, w * 0.8))];
    if (live) items.push({ part: at === 0 ? "armL" : "armR", parts: pieces });
    else items.push(...pieces);
  });
  items.push({ d: spec.foot, tone: "foot" }, ...pen(spec.foot, w));
  const last = L.length - 1;
  if (moving) {
    // 주름 한 칸씩 부풀어 파일이 관을 지나가는 것처럼 보입니다.
    for (let i = 0, rib = 0; i < last; i += spec.rib, rib += 1) {
      const end = Math.min(last, i + spec.rib);
      const left = L.slice(i, end + 1);
      const right = R.slice(i, end + 1);
      const color = layerColorAt(layers, (i + end) / 2 / last);
      const fill = poly([...left, ...[...right].reverse()]);
      items.push({ rib, parts: [color && layers.length ? { d: fill, tone: "layer", color } : { d: fill, tone: "white" }, ...pen(open(left), w), ...pen(open(right), w), ...pen(open([L[end], R[end]]), w * 0.62)] });
    }
  } else {
    items.push({ d: body, tone: "white" });
    let from = 0;
    layers.forEach(({ color, share }, i) => {
      const isLast = i === layers.length - 1;
      const to = isLast ? last : Math.min(last, from + Math.round(last * share));
      if (to > from) items.push({ d: poly([...L.slice(from, Math.min(last, to + 1) + 1), ...R.slice(from, Math.min(last, to + 1) + 1).reverse()]), tone: "layer", color, i, n: layers.length });
      from = to;
    });
    items.push(...pen(body, w));
    for (let i = spec.rib; i < L.length - 2; i += spec.rib) items.push(...pen(open([L[i], R[i]]), w * 0.62));
  }
  // 살아 있는 그림의 얼굴은 표정 시트가 맡습니다. 머리는 끄덕이고 갸웃하게 한 덩어리로 묶어요.
  if (live) {
    items.push({ part: "head", parts: [{ d: oval(spec.head), tone: "white" }, ...pen(oval(spec.head), w), { face: spec.inner }] });
    for (const tick of spec.ticks ?? []) items.push(...pen(tick, w * 0.8));
    if (spec.paperAt) items.push(paperGroup(spec.paperAt, w, pen));
    return items;
  }
  items.push({ d: oval(spec.head), tone: "white" }, ...pen(oval(spec.head), w), { d: oval(spec.inner), tone: "ink" });
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

// ── 플로팅 창과 인트로의 자세 7가지 ──
const stand = { line: "M36 108C36 88 36 72 44 60C50 52 58 48 68 46", width: 34, rib: 6, scallop: 2.2, head: [70, 38, 29, 25], inner: [70, 38, 22, 18], eyes: [[60, 37], [81, 36]], foot: "M12 106L58 106L60 114L10 114Z" } as const;
const restArm = "M22 82C14 82 8 86 5 93";
const poses: Record<DuctPose, Spec> = {
  idle: { ...stand, head: [...stand.head], inner: [...stand.inner], eyes: [[60, 37], [81, 36]], arms: [restArm, "M50 80C58 79 65 82 70 89"] },
  watch: { ...stand, line: "M36 108C34 86 38 68 52 58C62 52 74 50 84 50", head: [86, 42, 27, 24], inner: [88, 42, 20, 17], eyes: [[87, 41], [102, 40]], arms: ["M22 84C14 84 8 88 5 95", "M52 80C60 79 68 82 73 89"] },
  offer: { ...stand, head: [...stand.head], inner: [...stand.inner], eyes: [[60, 37], [81, 36]], arms: [restArm, "M50 80C62 81 76 82 90 80"], paperAt: [102, 78, 10] },
  move: { ...stand, head: [...stand.head], inner: [...stand.inner], eyes: [[60, 37], [81, 36]], arms: [restArm, "M50 80C62 78 72 72 78 64"], paperAt: [80, 54, -6] },
  done: { ...stand, line: "M50 108C50 92 52 72 56 56C58 48 60 44 62 40", head: [62, 30, 29, 25], inner: [62, 30, 22, 18], eyes: [[52, 30], [73, 29]], face: "happy", foot: "M26 106L74 106L76 114L24 114Z", ticks: ["M20 14L12 8", "M102 12L110 5"], arms: ["M37 78C26 72 20 62 18 50", "M68 76C80 70 88 60 90 48"] },
  rest: { ...stand, line: "M36 108C36 102 38 96 44 92C50 88 58 86 66 86", rib: 3, head: [70, 78, 29, 24], inner: [70, 78, 22, 17], eyes: [[60, 78], [81, 77]], face: "closed", arms: ["M24 100C18 100 12 102 8 107", "M58 104C68 105 78 106 88 108"] },
  shock: { ...stand, line: "M42 108C42 90 40 74 32 60C28 52 26 48 24 44", head: [26, 34, 27, 23], inner: [26, 34, 20, 16], eyes: [[18, 33], [35, 32]], face: "wide", foot: "M18 106L66 106L68 114L16 114Z", arms: ["M26 76C16 70 8 62 2 62", "M56 78C68 72 78 62 84 50"], ticks: ["M64 18L72 12", "M68 34L78 32"] },
};

export function drawPose(pose: DuctPose, { px, layers, live }: { px: number; layers?: DuctLayer[]; live?: boolean }): DuctDrawing {
  return { viewBox: boardBox, items: draw(poses[pose], { w: ductWeight(px), layers, moving: pose === "move", live }) };
}

// ── 인트로에서 파일을 먹는 프레임. 스프라이트 시트(art/duct-eat.png)의 원본이고, 0번은 idle과 같아 벡터 그림과 이어집니다. ──
// 허리가 휘어도 팔이 몸에서 떨어지지 않게 관 안쪽에서 시작합니다.
const armsUp = ["M34 82C18 78 8 72 6 64", "M42 80C60 76 68 70 72 62"];
const armsDown = ["M34 82C14 82 8 86 5 93", "M42 80C58 79 65 82 70 89"];
const mouth = (x: number, y: number, rx: number, ry: number, inRx: number, inRy: number) => ({ head: [x, y, rx, ry] as [number, number, number, number], inner: [x, y, inRx, inRy] as [number, number, number, number] });
// 받침은 그대로 두고 허리만 옆으로 휩니다. sway가 프레임마다 바뀌면 관이 꿈틀대요.
const wriggle = (sway: number, end: Pt = [70, 40]) => `M36 108C36 98 ${36 + sway} 92 ${36 + sway} 80C${36 + sway} 72 ${40 + sway * 0.4} 66 ${44 + sway * 0.4} 60C50 52 ${end[0] - 10} ${end[1] + 6} ${end[0]} ${end[1]}`;
const wide = { ...mouth(73, 33, 32, 30, 25.5, 24.5), eyes: [[62, 20], [85, 19]] as [Pt, Pt], eyeScale: 0.85, arms: armsUp };
const tall = { ...mouth(73, 33, 31, 31, 24.5, 25.5), eyes: [[63, 19], [84, 18]] as [Pt, Pt], eyeScale: 0.85, arms: armsUp };
const closing = { ...mouth(72, 38, 32, 25, 25, 15), eyes: [[61, 33], [83, 32]] as [Pt, Pt], eyeScale: 0.85, arms: armsDown };
const shut = { ...mouth(70, 42, 34, 20, 27, 8), eyes: [[60, 42], [81, 41]] as [Pt, Pt], face: "closed" as const, arms: armsDown };
const chewUp = { ...mouth(70, 39, 31, 23, 24, 14), eyes: [[60, 38], [81, 37]] as [Pt, Pt], face: "happy" as const, arms: armsDown };
const shutEnd: Pt = [68, 46];
const eatFrames: Spec[] = [
  poses.idle,
  { ...poses.idle, ...mouth(68, 43, 30, 22, 23, 15), eyes: [[58, 42], [79, 41]] },
  { ...poses.idle, line: wriggle(0), ...mouth(71, 35, 30, 27.5, 23.5, 21), eyes: [[61, 27], [83, 26]], eyeScale: 0.95, arms: armsUp },
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
  { ...poses.idle, ...shut, ...mouth(70, 42, 32, 21, 25, 10), line: wriggle(-3, shutEnd) },
  // 마지막 꿀꺽: 가장 크게 불룩해져 받침까지 내려갑니다. 끝으로 갈수록 잦아들어 서 있는 그림에 닿아요.
  ...([[0.84, 8, 5], [0.62, 9, -5], [0.4, 9, 3], [0.18, 8, -2]] as const).map(([at, size, sway]): Spec => ({ ...poses.idle, line: wriggle(sway, shutEnd), bulge: [at, size], face: "happy", arms: armsDown })),
];
export const eatFrameCount = eatFrames.length;
export const eatBoard = { width: board.w, height: board.h };

export function drawEatFrame(frame: number, px: number): DuctDrawing {
  return { viewBox: boardBox, items: draw(eatFrames[frame], { w: ductWeight(px) }) };
}

// ── 표정 시트(art/duct-faces.png)의 프레임. 모든 프로도가 한 장을 같이 씁니다. 몸은 방마다 모양과 색이 달라 코드로 그려요. ──
const faceEyes: [Pt, Pt] = [[-10, -1], [11, -2]];
const faceOval = "M-22 0C-22 -23.8 22 -23.8 22 0C22 23.8 -22 23.8 -22 0Z";
const lookBy = (dx: number, dy: number): DuctPiece[] => faceEyes.map(([x, y], at) => dot(x + dx, y + dy, at ? 4.1 : 3.8, "white"));
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
  const pen = makePen(frame + 1);
  return { viewBox: "-22 -18 44 36", items: [{ d: faceOval, tone: "ink" }, ...faceDraw[faceFrames[frame]](pen)] };
}

// 로고: 프로도 얼굴만. 흰 입구 테를 펜으로 두르고, 어두운 구멍에 기본 표정(base) 눈을 둡니다. 판 가운데에 놓도록 0,0이 얼굴 가운데예요.
export function drawBrandFace(): DuctDrawing {
  const head = [0, 0, 29, 25];
  return { viewBox: "-36 -36 72 72", items: [{ d: oval(head), tone: "white" }, ...makePen(1)(oval(head), 2.8), { d: faceOval, tone: "ink" }, ...lookBy(0, 0)] };
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

function roomSpec(shape: number, length: number): Spec {
  const level = Math.min(1, Math.max(0, length));
  const path = roomPaths[shape % ductShapeCount];
  const points = path.slice(0, Math.max(8, Math.round((path.length - 1) * (shortest + (1 - shortest) * level))) + 1);
  const end = points[points.length - 1];
  const back = points[points.length - 5];
  const span = Math.hypot(end[0] - back[0], end[1] - back[1]) || 1;
  const x = end[0] + ((end[0] - back[0]) / span) * 8;
  const y = end[1] + ((end[1] - back[1]) / span) * 8;
  const rx = 29 - 4 * level;
  const ry = rx * 0.86;
  const spec: Spec = { points, width: 34 - 8 * level, rib: 6, scallop: 2.2, head: [x, y, rx, ry], inner: [x, y, rx - 7, ry - 7], eyes: [[x - 10, y - 1], [x + 11, y - 2]], foot: "", arms: [] };
  const base = points[0][0];
  spec.foot = `M${base - 24} 106L${base + 22} 106L${base + 24} 114L${base - 26} 114Z`;
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
