import type { Kind } from "../domain/model";
import type { PaperTones } from "./palette";

// 형식마다 세 장의 손그림 종이. 면(fill)은 형식 색으로 칠하고, 선(pen)은 ObjectShape가 프로도의 펜으로 흔들리게 긋습니다.
// 길은 펜이 읽을 수 있게 절대 좌표 M·L·C·Z만 씁니다. 선이 잘리지 않게 모든 점은 가장자리에서 6 안쪽에 둡니다.

type Tone = keyof PaperTones;

export type Slot = {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: Tone;
  on: Tone; // 글자 아래 종이 색. 테스트가 4.5:1을 확인합니다.
  mono?: boolean;
  center?: boolean;
  arc?: string; // 있으면 이 곡선을 따라 한 줄로 찍습니다.
};

// detail은 작게(40px 아래) 그릴 때 빼는 잔선입니다. 바깥 윤곽에는 붙이지 않아요.
export type PaperPart = { d: string; fill: Tone } | { d: string; pen: number; tone?: Tone; detail?: boolean };
export type PaperArt = { id: string; w: number; h: number; slot: Slot; parts: PaperPart[] };

const r1 = (n: number) => Math.round(n * 10) / 10;
// 손으로 그린 사각형: 네 변이 살짝 부풀거나 들어간 닫힌 길. b는 흔들림 크기.
export const quad = (x: number, y: number, w: number, h: number, b = 1.2) =>
  `M${x} ${y}C${r1(x + w * 0.33)} ${r1(y - b)} ${r1(x + w * 0.66)} ${r1(y + b * 0.6)} ${x + w} ${y}C${r1(x + w + b * 0.6)} ${r1(y + h * 0.33)} ${r1(x + w - b)} ${r1(y + h * 0.66)} ${x + w} ${y + h}C${r1(x + w * 0.66)} ${r1(y + h + b)} ${r1(x + w * 0.33)} ${r1(y + h - b * 0.5)} ${x} ${y + h}C${r1(x - b * 0.7)} ${r1(y + h * 0.66)} ${r1(x + b * 0.5)} ${r1(y + h * 0.33)} ${x} ${y}Z`;
// 타원(원은 rx=ry).
export const ring = (x: number, y: number, rx: number, ry = rx) =>
  `M${r1(x - rx)} ${y}C${r1(x - rx)} ${r1(y - ry * 1.32)} ${r1(x + rx)} ${r1(y - ry * 1.32)} ${r1(x + rx)} ${y}C${r1(x + rx)} ${r1(y + ry * 1.32)} ${r1(x - rx)} ${r1(y + ry * 1.32)} ${r1(x - rx)} ${y}Z`;
// 꺾은선. close면 닫아요.
export const poly = (pts: [number, number][], close = false) => `M${pts.map((p) => `${p[0]} ${p[1]}`).join("L")}${close ? "Z" : ""}`;
// 살짝 물결치는 가로줄(글줄 같은 것).
export const wavy = (x1: number, y: number, x2: number, a = 1) => `M${x1} ${y}C${r1(x1 + (x2 - x1) * 0.3)} ${y - a} ${r1(x1 + (x2 - x1) * 0.6)} ${y + a} ${x2} ${y}`;

/* ── 이미지: 노랑 ── */
const image: PaperArt[] = [
  { id: "print", w: 100, h: 118, slot: { x: 14, y: 84, w: 72, h: 24, fill: "ink", on: "pale", center: true }, parts: [
    { d: quad(6, 6, 88, 106), fill: "pale" },
    { d: quad(14, 14, 72, 64, 0.8), fill: "soft" },
    { d: "M14 64C26 48 36 46 46 56C52 62 58 64 66 56C72 50 80 52 86 58L86 78L14 78Z", fill: "color" },
    { d: ring(66, 32, 8), fill: "pale" },
    { d: quad(6, 6, 88, 106), pen: 1 },
    { d: quad(14, 14, 72, 64, 0.8), pen: 0.7 },
    { d: "M14 64C26 48 36 46 46 56C52 62 58 64 66 56C72 50 80 52 86 58", pen: 0.7, detail: true },
    { d: ring(66, 32, 8), pen: 0.6, detail: true },
  ] },
  { id: "slide", w: 110, h: 100, slot: { x: 20, y: 64, w: 70, h: 22, fill: "ink", on: "soft", center: true }, parts: [
    { d: "M18 6C40 5 70 7 92 6C98 6 104 10 104 18L104 84C104 90 98 94 92 94C70 95 40 93 18 94C11 94 6 90 6 84L6 18C6 10 11 6 18 6Z", fill: "soft" },
    { d: quad(28, 16, 54, 40, 0.5), fill: "pale" },
    { d: "M28 46C36 38 44 36 52 42C60 48 68 38 82 44L82 56L28 56Z", fill: "color" },
    { d: ring(70, 28, 5), fill: "color" },
    { d: "M18 6C40 5 70 7 92 6C98 6 104 10 104 18L104 84C104 90 98 94 92 94C70 95 40 93 18 94C11 94 6 90 6 84L6 18C6 10 11 6 18 6Z", pen: 1 },
    { d: quad(28, 16, 54, 40, 0.5), pen: 0.8 },
    { d: "M28 46C36 38 44 36 52 42C60 48 68 38 82 44", pen: 0.6, detail: true },
    { d: ring(70, 28, 5), pen: 0.5, detail: true },
  ] },
  { id: "snap", w: 124, h: 100, slot: { x: 28, y: 70, w: 76, h: 17, fill: "ink", on: "pale", center: true }, parts: [
    { d: poly([[10, 26], [106, 12], [116, 86], [18, 94]], true), fill: "pale" },
    { d: poly([[21, 33], [98, 22], [104, 60], [26, 70]], true), fill: "soft" },
    { d: poly([[24, 58], [102, 48], [104, 60], [26, 70]], true), fill: "color" },
    { d: ring(82, 34, 6), fill: "pale" },
    { d: poly([[44, 14], [78, 8], [81, 22], [47, 28]], true), fill: "color" },
    { d: poly([[10, 26], [106, 12], [116, 86], [18, 94]], true), pen: 1 },
    { d: poly([[21, 33], [98, 22], [104, 60], [26, 70]], true), pen: 0.7 },
    { d: "M24 58C50 55 76 51 102 48", pen: 0.5, detail: true },
    { d: ring(82, 34, 6), pen: 0.6, detail: true },
    { d: poly([[44, 14], [78, 8], [81, 22], [47, 28]], true), pen: 0.7 },
  ] },
];

/* ── 글·코드: 초록 ── */
const text: PaperArt[] = [
  { id: "memo", w: 100, h: 118, slot: { x: 18, y: 74, w: 66, h: 32, fill: "ink", on: "pale" }, parts: [
    { d: "M8 8L70 6L92 28L92 110L8 112Z", fill: "pale" },
    { d: "M70 6L70 28L92 28Z", fill: "soft" },
    { d: "M8 8L70 6L92 28L92 110L8 112Z", pen: 1 },
    { d: "M70 7L70 28L91 28", pen: 0.8 },
    { d: wavy(20, 40, 58), pen: 0.7, tone: "color" },
    { d: wavy(20, 52, 76), pen: 0.7, tone: "color", detail: true },
    { d: wavy(20, 64, 66), pen: 0.7, tone: "color", detail: true },
  ] },
  { id: "sticky", w: 104, h: 104, slot: { x: 18, y: 34, w: 60, h: 34, fill: "ink", on: "soft" }, parts: [
    { d: "M8 10L96 8L96 70C88 80 80 88 70 96L10 96Z", fill: "soft" },
    { d: "M96 70C86 72 76 74 70 96C80 90 90 82 96 70Z", fill: "pale" },
    { d: "M8 10L96 8L96 70C88 80 80 88 70 96L10 96Z", pen: 1 },
    { d: "M96 70C86 72 76 74 70 96", pen: 0.8 },
    { d: wavy(20, 24, 66), pen: 0.7, tone: "color" },
  ] },
  { id: "strip", w: 136, h: 100, slot: { x: 38, y: 38, w: 80, h: 40, fill: "ink", on: "pale" }, parts: [
    { d: "M16 10L122 8L128 20L122 32L130 44L123 56L130 68L122 80L128 88L122 92L16 92Z", fill: "pale" },
    { d: ring(25, 26, 4.6), fill: "edge" },
    { d: ring(25, 50, 4.6), fill: "edge" },
    { d: ring(25, 74, 4.6), fill: "edge" },
    { d: "M16 10L122 8L128 20L122 32L130 44L123 56L130 68L122 80L128 88L122 92L16 92Z", pen: 1 },
    { d: "M25 26C14 28 6 22 12 16M25 50C14 52 6 46 12 40M25 74C14 76 6 70 12 64", pen: 1 },
    { d: "M34 10L34 92", pen: 0.6, tone: "color", detail: true },
    { d: wavy(40, 25, 106), pen: 0.6, tone: "color", detail: true },
  ] },
];

/* ── 영상: 파랑 ── */
const video: PaperArt[] = [
  { id: "slate", w: 112, h: 100, slot: { x: 18, y: 70, w: 76, h: 20, fill: "ink", on: "pale", center: true }, parts: [
    { d: quad(8, 30, 96, 62), fill: "pale" },
    { d: "M8 30L10 10L104 6L106 26Z", fill: "edge" },
    { d: "M44 42L44 62L62 52Z", fill: "color" },
    { d: quad(8, 30, 96, 62), pen: 1 },
    { d: "M8 30L10 10L104 6L106 26Z", pen: 0.9 },
    { d: "M26 10C28 16 30 22 32 28M50 9C52 15 54 21 56 27M74 8C76 14 78 20 80 26", pen: 1.4, tone: "pale", detail: true },
    { d: "M44 42L44 62L62 52Z", pen: 0.8 },
  ] },
  { id: "ticket", w: 132, h: 96, slot: { x: 18, y: 29, w: 76, h: 38, fill: "ink", on: "pale", center: true }, parts: [
    { d: "M8 8L124 7L124 38C115 38 115 58 124 58L124 88L8 89L8 58C17 58 17 38 8 38Z", fill: "pale" },
    { d: "M96 8L124 7L124 38C115 38 115 58 124 58L124 88L96 88Z", fill: "color" },
    { d: "M8 8L124 7L124 38C115 38 115 58 124 58L124 88L8 89L8 58C17 58 17 38 8 38Z", pen: 1 },
    { d: "M96 12L96 21M96 28L96 37M96 44L96 53M96 60L96 69M96 76L96 85", pen: 0.7, detail: true },
  ] },
  { id: "film", w: 136, h: 96, slot: { x: 40, y: 38, w: 72, h: 20, fill: "ink", on: "pale", center: true }, parts: [
    { d: quad(6, 8, 124, 80, 1), fill: "color" },
    { d: quad(14, 25, 16, 46, 0.4), fill: "pale" },
    { d: quad(36, 25, 80, 46, 0.5), fill: "pale" },
    { d: quad(122, 25, 8, 46, 0.3), fill: "pale" },
    { d: "M14 13L22 13L22 19L14 19ZM34 13L42 13L42 19L34 19ZM54 13L62 13L62 19L54 19ZM74 13L82 13L82 19L74 19ZM94 13L102 13L102 19L94 19ZM114 13L122 13L122 19L114 19Z", fill: "pale" },
    { d: "M14 75L22 75L22 81L14 81ZM34 75L42 75L42 81L34 81ZM54 75L62 75L62 81L54 81ZM74 75L82 75L82 81L74 81ZM94 75L102 75L102 81L94 81ZM114 75L122 75L122 81L114 81Z", fill: "pale" },
    { d: quad(6, 8, 124, 80, 1), pen: 1 },
    { d: quad(14, 25, 16, 46, 0.4), pen: 0.7 },
    { d: quad(36, 25, 80, 46, 0.5), pen: 0.7 },
    { d: "M130 25L122 25L122 71L130 71", pen: 0.7 },
  ] },
];

/* ── PDF: 빨강, 접힌 귀 ── */
const pdf: PaperArt[] = [
  { id: "tab", w: 100, h: 118, slot: { x: 18, y: 74, w: 66, h: 32, fill: "ink", on: "pale" }, parts: [
    { d: "M10 8L70 6L92 28L92 110L10 112Z", fill: "pale" },
    { d: "M70 6L70 28L92 28Z", fill: "soft" },
    { d: quad(6, 22, 42, 20, 0.6), fill: "color" },
    { d: "M10 8L70 6L92 28L92 110L10 112Z", pen: 1 },
    { d: "M70 7L70 28L91 28", pen: 0.8 },
    { d: quad(6, 22, 42, 20, 0.6), pen: 0.8 },
    { d: wavy(22, 56, 78), pen: 0.45, tone: "edge", detail: true },
    { d: wavy(22, 66, 70), pen: 0.45, tone: "edge", detail: true },
  ] },
  { id: "seal", w: 124, h: 100, slot: { x: 18, y: 54, w: 62, h: 30, fill: "ink", on: "pale" }, parts: [
    { d: "M10 8L96 6L118 28L118 92L10 94Z", fill: "pale" },
    { d: "M96 6L96 28L118 28Z", fill: "soft" },
    { d: poly([[90, 68], [84, 88], [94, 82], [100, 70]], true), fill: "color" },
    { d: poly([[106, 68], [112, 88], [102, 82], [96, 70]], true), fill: "color" },
    { d: ring(98, 58, 13), fill: "color" },
    { d: "M10 8L96 6L118 28L118 92L10 94Z", pen: 1 },
    { d: "M96 7L96 28L117 28", pen: 0.8 },
    { d: poly([[90, 68], [84, 88], [94, 82], [100, 70]]), pen: 0.7 },
    { d: poly([[106, 68], [112, 88], [102, 82], [96, 70]]), pen: 0.7 },
    { d: ring(98, 58, 13), pen: 0.9 },
    { d: ring(98, 58, 8), pen: 0.5, tone: "pale", detail: true },
    { d: wavy(22, 24, 84), pen: 0.45, tone: "edge", detail: true },
    { d: wavy(22, 34, 76), pen: 0.45, tone: "edge", detail: true },
  ] },
  { id: "staple", w: 104, h: 128, slot: { x: 18, y: 80, w: 58, h: 30, fill: "ink", on: "pale" }, parts: [
    { d: "M24 8L94 12L92 110L22 106Z", fill: "color" },
    { d: "M24 8L94 12L92 110L22 106Z", pen: 0.9 },
    { d: "M8 22L66 20L88 42L88 120L8 122Z", fill: "pale" },
    { d: "M66 20L66 42L88 42Z", fill: "soft" },
    { d: "M8 22L66 20L88 42L88 120L8 122Z", pen: 1 },
    { d: "M66 21L66 42L87 42", pen: 0.8 },
    { d: "M12 38L14 32L30 24L33 29", pen: 1.2 },
    { d: wavy(20, 54, 74), pen: 0.45, tone: "edge", detail: true },
    { d: wavy(20, 64, 66), pen: 0.45, tone: "edge", detail: true },
  ] },
];

/* ── 문서: 빨강, 네모 귀와 클립·바인더 ── */
const office: PaperArt[] = [
  { id: "clip", w: 100, h: 120, slot: { x: 18, y: 80, w: 66, h: 30, fill: "ink", on: "pale" }, parts: [
    { d: quad(8, 18, 84, 96), fill: "pale" },
    { d: quad(8, 18, 84, 96), pen: 1 },
    { d: "M28 14C28 6 44 6 44 14L44 40C44 48 32 48 32 40L32 20", pen: 1.1 },
    { d: wavy(22, 52, 78), pen: 0.6, tone: "color" },
    { d: wavy(22, 61, 70), pen: 0.6, tone: "color", detail: true },
    { d: wavy(22, 70, 74), pen: 0.6, tone: "color", detail: true },
  ] },
  { id: "binder", w: 128, h: 100, slot: { x: 46, y: 52, w: 70, h: 30, fill: "ink", on: "pale" }, parts: [
    { d: quad(26, 10, 94, 82), fill: "pale" },
    { d: quad(8, 8, 22, 86, 0.8), fill: "color" },
    { d: ring(38, 24, 4), fill: "soft" },
    { d: ring(38, 50, 4), fill: "soft" },
    { d: ring(38, 76, 4), fill: "soft" },
    { d: quad(26, 10, 94, 82), pen: 1 },
    { d: quad(8, 8, 22, 86, 0.8), pen: 1 },
    { d: "M20 26C20 16 38 14 38 24", pen: 0.8 },
    { d: "M20 52C20 42 38 40 38 50", pen: 0.8 },
    { d: "M20 78C20 68 38 66 38 76", pen: 0.8 },
    { d: wavy(50, 28, 108), pen: 0.6, tone: "color" },
    { d: wavy(50, 38, 96), pen: 0.6, tone: "color", detail: true },
  ] },
  { id: "letter", w: 96, h: 128, slot: { x: 16, y: 80, w: 64, h: 30, fill: "ink", on: "pale" }, parts: [
    { d: quad(8, 8, 80, 112), fill: "pale" },
    { d: "M8 8L88 8L88 30L8 30Z", fill: "color" },
    { d: poly([[66, 8], [80, 8], [80, 48], [73, 41], [66, 48]], true), fill: "edge" },
    { d: quad(8, 8, 80, 112), pen: 1 },
    { d: wavy(8, 30, 88, 0.8), pen: 0.8 },
    { d: poly([[66, 8], [66, 48], [73, 41], [80, 48], [80, 8]]), pen: 0.8 },
    { d: wavy(18, 44, 58), pen: 0.6, tone: "color" },
    { d: wavy(18, 56, 76), pen: 0.6, tone: "color", detail: true },
    { d: wavy(18, 66, 70), pen: 0.6, tone: "color", detail: true },
  ] },
];

/* ── 발표: 청록 ── */
const slides: PaperArt[] = [
  { id: "easel", w: 118, h: 104, slot: { x: 14, y: 48, w: 90, h: 20, fill: "ink", on: "pale", center: true }, parts: [
    { d: quad(6, 6, 106, 66), fill: "pale" },
    { d: "M30 40L30 30L40 30L40 40Z", fill: "soft" },
    { d: "M48 40L48 18L58 18L58 40Z", fill: "color" },
    { d: "M66 40L66 26L76 26L76 40Z", fill: "soft" },
    { d: quad(6, 6, 106, 66), pen: 1 },
    { d: "M58 72L58 86M58 86L42 98M58 86L74 98", pen: 0.9 },
    { d: "M30 40L30 30L40 30L40 40M48 40L48 18L58 18L58 40M66 40L66 26L76 26L76 40", pen: 0.6, detail: true },
    { d: "M22 42L94 42", pen: 0.6, detail: true },
  ] },
  { id: "deck", w: 132, h: 104, slot: { x: 40, y: 46, w: 62, h: 36, fill: "ink", on: "pale" }, parts: [
    { d: quad(34, 8, 92, 56), fill: "soft" },
    { d: quad(34, 8, 92, 56), pen: 0.9 },
    { d: quad(22, 20, 92, 56), fill: "soft" },
    { d: quad(22, 20, 92, 56), pen: 0.9 },
    { d: quad(8, 34, 98, 62), fill: "pale" },
    { d: ring(24, 66, 11), fill: "color" },
    { d: "M24 66L24 55C30.1 55 35 59.9 35 66Z", fill: "soft" },
    { d: quad(8, 34, 98, 62), pen: 1 },
    { d: ring(24, 66, 11), pen: 0.7 },
    { d: "M24 55L24 66L35 66", pen: 0.6, detail: true },
  ] },
  { id: "screen", w: 96, h: 128, slot: { x: 22, y: 70, w: 52, h: 22, fill: "ink", on: "pale", center: true }, parts: [
    { d: quad(14, 16, 68, 86), fill: "pale" },
    { d: quad(8, 8, 80, 10, 0.6), fill: "soft" },
    { d: "M24 62L36 48L48 54L70 30L70 62Z", fill: "color" },
    { d: quad(14, 16, 68, 86), pen: 1 },
    { d: quad(8, 8, 80, 10, 0.6), pen: 1 },
    { d: quad(12, 100, 72, 6, 0.4), fill: "soft" },
    { d: quad(12, 100, 72, 6, 0.4), pen: 0.9 },
    { d: "M48 106L48 114", pen: 0.7 },
    { d: ring(48, 117, 3.5), pen: 0.7 },
    { d: "M24 62L36 48L48 54L70 30", pen: 0.9 },
  ] },
];

/* ── 표: 주황 ── */
const table: PaperArt[] = [
  { id: "grid", w: 100, h: 118, slot: { x: 16, y: 76, w: 70, h: 30, fill: "ink", on: "pale" }, parts: [
    { d: quad(8, 8, 84, 104), fill: "pale" },
    { d: quad(8, 8, 84, 18, 0.6), fill: "soft" },
    { d: quad(8, 8, 84, 104), pen: 1 },
    { d: "M8 26L92 26M8 44L92 44M38 8L38 62M64 8L64 62", pen: 0.55 },
    { d: "M8 62L92 62", pen: 0.55, detail: true },
  ] },
  { id: "receipt", w: 100, h: 126, slot: { x: 18, y: 74, w: 64, h: 32, fill: "ink", on: "pale", center: true }, parts: [
    { d: "M8 8L92 8L92 110L86 118L80 110L74 118L68 110L62 118L56 110L50 118L44 110L38 118L32 110L26 118L20 110L14 118L8 110Z", fill: "pale" },
    { d: quad(16, 16, 68, 11, 0.5), fill: "color" },
    { d: "M8 8L92 8L92 110L86 118L80 110L74 118L68 110L62 118L56 110L50 118L44 110L38 118L32 110L26 118L20 110L14 118L8 110Z", pen: 1 },
    { d: "M16 36L21 36M25 36L30 36M34 36L39 36M50 36L84 36", pen: 0.6, tone: "edge", detail: true },
    { d: "M16 46L21 46M25 46L30 46M34 46L39 46M50 46L84 46", pen: 0.6, tone: "edge", detail: true },
    { d: "M16 56L21 56M25 56L30 56M34 56L39 56M50 56L84 56", pen: 0.6, tone: "edge", detail: true },
    { d: "M14 66L86 66", pen: 0.8 },
  ] },
  { id: "board", w: 108, h: 124, slot: { x: 22, y: 76, w: 64, h: 26, fill: "ink", on: "pale" }, parts: [
    { d: quad(8, 14, 92, 104), fill: "color" },
    { d: quad(18, 24, 72, 86, 0.8), fill: "pale" },
    { d: quad(38, 7, 32, 15, 0.6), fill: "soft" },
    { d: quad(8, 14, 92, 104), pen: 1 },
    { d: quad(18, 24, 72, 86, 0.8), pen: 0.7 },
    { d: quad(38, 7, 32, 15, 0.6), pen: 0.8 },
    { d: quad(25, 33, 9, 9, 0.3), fill: "soft" },
    { d: quad(25, 51, 9, 9, 0.3), fill: "soft" },
    { d: "M18 46L90 46M18 64L90 64M40 26L40 70", pen: 0.55 },
    { d: quad(25, 33, 9, 9, 0.3), pen: 0.5, detail: true },
    { d: quad(25, 51, 9, 9, 0.3), pen: 0.5, detail: true },
    { d: "M26 37L29 41L35 31M26 55L29 59L35 49", pen: 0.6, detail: true },
    { d: wavy(46, 38, 80), pen: 0.6, tone: "color", detail: true },
    { d: wavy(46, 56, 72), pen: 0.6, tone: "color", detail: true },
  ] },
];

/* ── 소리: 보라 ── */
const audio: PaperArt[] = [
  { id: "cassette", w: 112, h: 80, slot: { x: 18, y: 38, w: 76, h: 20, fill: "ink", on: "pale", center: true }, parts: [
    { d: quad(6, 6, 100, 68), fill: "pale" },
    { d: quad(16, 12, 80, 22, 0.6), fill: "soft" },
    { d: ring(36, 23, 6), fill: "color" },
    { d: ring(76, 23, 6), fill: "color" },
    { d: quad(6, 6, 100, 68), pen: 1 },
    { d: quad(16, 12, 80, 22, 0.6), pen: 0.6, detail: true },
    { d: ring(36, 23, 6), pen: 0.6 },
    { d: ring(76, 23, 6), pen: 0.6 },
    { d: "M28 74L34 62L78 62L84 74", pen: 0.7, detail: true },
  ] },
  { id: "vinyl", w: 126, h: 104, slot: { x: 16, y: 64, w: 64, h: 20, fill: "ink", on: "pale", center: true }, parts: [
    { d: ring(84, 52, 36), fill: "ink" },
    { d: ring(84, 52, 26), pen: 0.5, tone: "edge", detail: true },
    { d: ring(84, 52, 36), pen: 1 },
    { d: quad(8, 8, 80, 88), fill: "pale" },
    { d: ring(48, 36, 18), fill: "color" },
    { d: ring(48, 36, 5), fill: "pale" },
    { d: quad(8, 8, 80, 88), pen: 1 },
    { d: ring(48, 36, 18), pen: 0.7 },
  ] },
  { id: "bubble", w: 108, h: 114, slot: { x: 24, y: 56, w: 60, h: 20, fill: "ink", on: "soft", center: true }, parts: [
    { d: "M54 8C84 8 102 24 102 48C102 72 84 86 56 86C48 86 42 85 36 83L16 106L22 78C12 70 8 60 8 48C8 24 26 8 54 8Z", fill: "soft" },
    { d: "M54 8C84 8 102 24 102 48C102 72 84 86 56 86C48 86 42 85 36 83L16 106L22 78C12 70 8 60 8 48C8 24 26 8 54 8Z", pen: 1 },
    { d: "M20 36L30 36L35 26L41 46L47 18L53 50L59 24L65 42L71 30L76 36L88 36", pen: 1.0 },
  ] },
];

/* ── 디자인: 분홍 ── */
// 받침점(px,py) 기준으로 a도 돌린 칩 꼭짓점: 로컬 x는 좌우, y는 위(-)로.
const chip = (px: number, py: number, a: number, pts: [number, number][]) => { const r = (a * Math.PI) / 180; return poly(pts.map(([x, y]): [number, number] => [r1(px + x * Math.cos(r) - y * Math.sin(r)), r1(py + x * Math.sin(r) + y * Math.cos(r))]), true); };
const star = (cx: number, cy: number, ro: number, ri: number) => poly(Array.from({ length: 10 }, (_, i) => { const a = (-90 + i * 36) * Math.PI / 180; const r = i % 2 ? ri : ro; return [r1(cx + r * Math.cos(a)), r1(cy + r * Math.sin(a))] as [number, number]; }), true);
const design: PaperArt[] = [
  { id: "palette", w: 112, h: 100, slot: { x: 16, y: 56, w: 46, h: 30, fill: "ink", on: "pale", center: true }, parts: [
    { d: "M56 6C86 6 106 24 104 50C102 68 88 72 78 64C70 58 62 64 66 76C70 90 58 94 46 92C20 88 6 70 8 48C10 22 30 6 56 6Z", fill: "pale" },
    { d: ring(28, 40, 7), fill: "color" },
    { d: ring(46, 22, 7), fill: "soft" },
    { d: ring(72, 22, 7), fill: "edge" },
    { d: ring(88, 42, 6), fill: "color" },
    { d: "M56 6C86 6 106 24 104 50C102 68 88 72 78 64C70 58 62 64 66 76C70 90 58 94 46 92C20 88 6 70 8 48C10 22 30 6 56 6Z", pen: 1 },
    { d: ring(28, 40, 7), pen: 0.5, detail: true },
    { d: ring(46, 22, 7), pen: 0.5, detail: true },
    { d: ring(72, 22, 7), pen: 0.5, detail: true },
    { d: ring(88, 42, 6), pen: 0.5, detail: true },
  ] },
  { id: "chips", w: 120, h: 120, slot: { x: 37, y: 64, w: 46, h: 44, fill: "ink", on: "pale", center: true }, parts: [
    { d: chip(60, 104, -22, [[-18, 0], [18, 0], [18, -84], [-18, -84]]), fill: "pale" },
    { d: chip(60, 104, -22, [[-18, -62], [18, -62], [18, -84], [-18, -84]]), fill: "edge" },
    { d: chip(60, 104, -22, [[-18, 0], [18, 0], [18, -84], [-18, -84]]), pen: 0.9 },
    { d: chip(60, 104, 22, [[-18, 0], [18, 0], [18, -84], [-18, -84]]), fill: "pale" },
    { d: chip(60, 104, 22, [[-18, -62], [18, -62], [18, -84], [-18, -84]]), fill: "soft" },
    { d: chip(60, 104, 22, [[-18, 0], [18, 0], [18, -84], [-18, -84]]), pen: 0.9 },
    { d: quad(34, 12, 52, 98, 0.8), fill: "pale" },
    { d: quad(34, 12, 52, 24, 0.5), fill: "color" },
    { d: quad(34, 36, 52, 24, 0.5), fill: "soft" },
    { d: quad(34, 12, 52, 98, 0.8), pen: 1 },
    { d: "M34 36L86 36M34 60L86 60", pen: 0.6, detail: true },
  ] },
  { id: "sticker", w: 124, h: 88, slot: { x: 58, y: 22, w: 52, h: 46, fill: "ink", on: "pale", center: true }, parts: [
    { d: quad(8, 8, 108, 72), fill: "pale" },
    { d: star(32, 44, 22, 10), fill: "color" },
    { d: quad(8, 8, 108, 72), pen: 1 },
    { d: star(32, 44, 22, 10), pen: 0.9 },
    { d: "M26 40C27 37 29 34 31 33", pen: 0.7, tone: "pale", detail: true },
  ] },
];

/* ── 압축: 갈색 ── */
const archive: PaperArt[] = [
  { id: "box", w: 112, h: 100, slot: { x: 34, y: 38, w: 68, h: 46, fill: "ink", on: "soft" }, parts: [
    { d: quad(8, 26, 96, 66), fill: "soft" },
    { d: "M8 26L22 8L90 8L104 26Z", fill: "pale" },
    { d: quad(16, 26, 14, 66, 0.4), fill: "color" },
    { d: quad(8, 26, 96, 66), pen: 1 },
    { d: "M8 26L22 8L90 8L104 26", pen: 0.9 },
    { d: "M16 26L16 92M30 26L30 92", pen: 0.6, detail: true },
  ] },
  { id: "luggage", w: 92, h: 128, slot: { x: 16, y: 46, w: 60, h: 62, fill: "ink", on: "pale" }, parts: [
    { d: quad(8, 10, 76, 110), fill: "pale" },
    { d: quad(8, 10, 76, 14, 0.4), fill: "color" },
    { d: quad(8, 10, 76, 110), pen: 1 },
    { d: "M16 12L16 22M24 12L24 22M32 12L32 22M40 12L40 22M48 12L48 22M56 12L56 22", pen: 0.5, detail: true },
    { d: quad(63, 18, 12, 22, 0.6), fill: "edge" },
    { d: quad(63, 18, 12, 22, 0.6), pen: 0.8 },
  ] },
  { id: "folder", w: 132, h: 88, slot: { x: 14, y: 54, w: 100, h: 22, fill: "ink", on: "soft" }, parts: [
    { d: "M10 20L12 8L44 8L50 20Z", fill: "soft" },
    { d: quad(8, 18, 116, 62), fill: "soft" },
    { d: quad(8, 30, 116, 12, 0.4), fill: "color" },
    { d: "M10 20L12 8L44 8L50 20", pen: 0.9 },
    { d: quad(8, 18, 116, 62), pen: 1 },
    { d: "M8 30L124 30M8 42L124 42", pen: 0.6, detail: true },
    { d: "M17 31L17 41M26 31L26 41M35 31L35 41M44 31L44 41M53 31L53 41M62 31L62 41M71 31L71 41M80 31L80 41M89 31L89 41M98 31L98 41M107 31L107 41M116 31L116 41", pen: 0.5, detail: true },
    { d: quad(98, 34, 14, 18, 0.6), fill: "edge" },
    { d: quad(98, 34, 14, 18, 0.6), pen: 0.8 },
  ] },
];

/* ── 기타: 회색 ── */
const unknown: PaperArt[] = [
  { id: "tag", w: 112, h: 84, slot: { x: 38, y: 28, w: 64, h: 28, fill: "ink", on: "pale", center: true }, parts: [
    { d: "M30 8L104 6L106 78L30 78L8 42Z", fill: "pale" },
    { d: "M30 8L104 6L106 78L30 78L8 42Z", pen: 1 },
    { d: ring(26, 42, 5), pen: 0.6 },
  ] },
  { id: "punch", w: 128, h: 82, slot: { x: 20, y: 44, w: 90, h: 22, fill: "ink", on: "pale", center: true }, parts: [
    { d: "M24 8C56 7 90 9 120 8C121 30 119 52 120 74C84 75 44 73 8 74C9 56 7 40 8 24Z", fill: "pale" },
    { d: "M24 8C56 7 90 9 120 8C121 30 119 52 120 74C84 75 44 73 8 74C9 56 7 40 8 24Z", pen: 1 },
    { d: quad(30, 18, 7, 12, 0.3), fill: "edge" },
    { d: quad(46, 18, 7, 12, 0.3), fill: "edge" },
    { d: quad(70, 18, 7, 12, 0.3), fill: "edge" },
    { d: quad(94, 18, 7, 12, 0.3), fill: "edge" },
    { d: wavy(20, 36, 110, 0.6), pen: 0.5, tone: "color", detail: true },
  ] },
  { id: "label", w: 78, h: 112, slot: { x: 13, y: 50, w: 54, h: 30, fill: "ink", on: "pale", center: true }, parts: [
    { d: "M10 32C10 15 23 8 40 8C57 8 70 15 70 32L72 106L8 106Z", fill: "pale" },
    { d: quad(10, 88, 60, 12, 0.5), fill: "soft" },
    { d: "M10 32C10 15 23 8 40 8C57 8 70 15 70 32L72 106L8 106Z", pen: 1 },
    { d: ring(40, 26, 9), fill: "soft" },
    { d: ring(40, 26, 9), pen: 0.6, detail: true },
    { d: ring(40, 26, 4), pen: 0.7 },
    { d: "M43 23C51 12 63 10 70 18", pen: 0.6, detail: true },
  ] },
];

// 첫 장이 seed 없을 때(범례 같은 곳)의 모양입니다.
export const paperArts: Record<Kind, PaperArt[]> = { image, text, video, pdf, office, slides, table, audio, design, archive, unknown };
