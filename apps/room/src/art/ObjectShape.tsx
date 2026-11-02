import { useId, type ReactNode } from "react";
import type { Kind } from "../domain/model";
import { kindColors, kindTones, tonesFrom, type PaperTones } from "./palette";

// 파일 하나 = 형식별 색의 납작한 종이 한 장. 테두리 없이 면으로 칠하고, 구멍은 진짜로 뚫어 겹치면 아래 종이가 보입니다.
// 기울기는 그리는 쪽에서 줍니다. 여기서는 똑바로 그려요.

type Slot = {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: keyof PaperTones;
  on: keyof PaperTones; // 글자 아래 종이 색. 테스트가 4.5:1을 확인합니다.
  mono?: boolean;
  center?: boolean;
  arc?: string; // 있으면 이 곡선을 따라 한 줄로 찍습니다.
};

export type PaperArt = {
  id: string;
  w: number;
  h: number;
  slot: Slot;
  // full이 아니면 작은 크기용: 자잘한 선을 빼고 굵은 표시만 남깁니다. hair는 크기와 상관없이 1px쯤 되는 선 굵기입니다.
  draw: (t: PaperTones, full: boolean, hair: number) => ReactNode;
};

const box = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}z`;
const dot = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;
const dots = (xs: number[], y: number, r: number) => xs.map((x) => dot(x, y, r)).join("");
const rules = (ys: number[], x1: number, x2: number) => ys.map((y) => `M${x1} ${y}H${x2}`).join("");

const line = (d: string, stroke: string, width: number) => <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;

/* ── 이미지: 노랑 ── */
const photoPrint: PaperArt = {
  id: "print",
  w: 100,
  h: 122,
  slot: { x: 8, y: 87, w: 84, h: 32, fill: "ink", on: "pale" },
  draw: (t) => (
    <>
      <path d={box(0, 0, 100, 122)} fill={t.pale} />
      <path d={box(8, 8, 84, 76)} fill={t.soft} />
      <circle cx="69" cy="30" r="10" fill={t.pale} />
      <path d="M8 66C22 50 36 48 50 60C58 67 64 70 72 66C80 62 86 56 92 54V84H8Z" fill={t.color} />
      <path d="M8 84V76C24 66 44 70 62 84Z" fill={t.edge} />
    </>
  ),
};

const slideMount: PaperArt = {
  id: "slide",
  w: 104,
  h: 104,
  slot: { x: 12, y: 76, w: 80, h: 22, fill: "ink", on: "pale", center: true },
  draw: (t) => (
    <>
      <path d={box(0, 0, 104, 104)} fill={t.pale} />
      <path d={box(16, 12, 72, 58)} fill={t.soft} />
      <path d="M16 70L40 40L56 56L68 46L88 70Z" fill={t.color} />
      <circle cx="70" cy="28" r="7" fill={t.pale} />
    </>
  ),
};

const snapshot: PaperArt = {
  id: "snapshot",
  w: 112,
  h: 118,
  slot: { x: 15, y: 90, w: 82, h: 22, fill: "ink", on: "pale", center: true },
  draw: (t, full) => (
    <>
      <rect x="3" y="12" width="106" height="103" fill={t.pale} />
      <path d={box(9, 18, 94, 91)} fill={t.soft} />
      {full && <path d={box(9, 74, 94, 35)} fill={t.color} />}
      <circle cx="82" cy="36" r="8" fill={t.pale} />
      <path d="M31 84C31 66 35 58 41 54L37 37L46 44C49 43 53 43 56 44L65 37L61 54C67 58 71 66 71 84Z" fill={t.edge} />
      {line("M71 80C84 80 86 66 79 62", t.edge, 5)}
      {full && <path d={box(13, 88, 86, 26)} fill={t.pale} />}
      <path d="M38 0H76L73 4L76 8L73 12L76 16H38L41 12L38 8L41 4Z" fill={full ? t.soft : t.pale} />
    </>
  ),
};

/* ── 글: 초록 ── */
const memo: PaperArt = {
  id: "memo",
  w: 100,
  h: 124,
  slot: { x: 10, y: 26, w: 80, h: 50, fill: "ink", on: "pale" },
  draw: (t, full, hair) => (
    <>
      <path d={box(0, 0, 100, 124) + dots(full ? [14, 32, 50, 68, 86] : [20, 50, 80], 10, full ? 3.6 : 5.5)} fill={t.pale} />
      {full ? (
        <path d={rules([20], 0, 100) + rules([80, 90, 100, 110], 10, 90)} stroke={t.soft} strokeWidth={hair} />
      ) : (
        <path d={rules([42, 64, 86], 14, 86) + rules([108], 14, 56)} stroke={t.color} strokeWidth="9" />
      )}
    </>
  ),
};

const sticky: PaperArt = {
  id: "sticky",
  w: 100,
  h: 100,
  slot: { x: 10, y: 12, w: 80, h: 58, fill: "ink", on: "soft" },
  draw: (t, full, hair) => (
    <>
      <path d="M0 0H100V70L70 100H0Z" fill={t.soft} />
      <path d="M100 70H70V100Z" fill={t.color} />
      {full ? line("M10 84c7-6 11 4 18 0s9-6 16-1", t.edge, hair * 1.4) : <path d={rules([24, 46], 14, 86) + rules([68], 14, 52)} stroke={t.edge} strokeWidth="9" />}
    </>
  ),
};

const notebookStrip: PaperArt = {
  id: "strip",
  w: 134,
  h: 64,
  slot: { x: 30, y: 7, w: 90, h: 52, fill: "pale", on: "edge" },
  draw: (t, full, hair) => (
    <>
      <path d={`M0 0H128L132 6L127 13L133 20L126 28L131 35L127 43L134 51L128 57L131 64H0Z${dot(12, 13, 4)}${dot(12, 32, 4)}${dot(12, 51, 4)}`} fill={t.edge} />
      {full ? <path d="M23 0V64" stroke={t.color} strokeWidth={hair} /> : <path d={rules([20, 44], 34, 112)} stroke={t.pale} strokeWidth="10" />}
    </>
  ),
};

/* ── 영상: 파랑 ── */
const ticket: PaperArt = {
  id: "ticket",
  w: 132,
  h: 68,
  slot: { x: 13, y: 8, w: 85, h: 52, fill: "pale", on: "color", mono: true },
  draw: (t, full, hair) => (
    <>
      <path d={`M3 0H99A5 5 0 0 0 109 0H129Q132 0 132 3V28A6 6 0 0 0 132 40V65Q132 68 129 68H109A5 5 0 0 0 99 68H3Q0 68 0 65V40A6 6 0 0 0 0 28V3Q0 0 3 0Z${full ? [11, 18.5, 26, 33.5, 41, 48.5, 56].map((y) => dot(104, y, 1.3)).join("") : ""}`} fill={t.color} />
      {full && <path d={rules([60], 13, 92)} stroke={t.soft} strokeWidth={hair} />}
      <path d={full ? "M110 26L122 34L110 42Z" : "M42 16L90 34L42 52Z"} fill={t.pale} />
    </>
  ),
};

const filmStrip: PaperArt = {
  id: "film",
  w: 128,
  h: 84,
  slot: { x: 12, y: 19, w: 88, h: 49, fill: "ink", on: "pale" },
  draw: (t, full) => {
    const holes = (y: number) => [5, 20, 35, 50, 65, 80, 95, 110].map((x) => box(x, y, 9, 8)).join("");
    const big = (y: number) => [6, 37, 68, 99].map((x) => box(x, y, 19, 11)).join("");
    return (
      <>
        <path d={box(0, 0, 128, 84) + (full ? holes(5) + holes(71) : big(4) + big(69))} fill={full ? t.edge : t.color} />
        <path d={full ? box(6, 18, 98, 48) : box(8, 22, 112, 40)} fill={t.pale} />
        {full && <path d={box(108, 18, 20, 48)} fill={t.soft} />}
      </>
    );
  },
};

const slate: PaperArt = {
  id: "slate",
  w: 112,
  h: 112,
  slot: { x: 10, y: 50, w: 92, h: 44, fill: "pale", on: "color" },
  draw: (t, full, hair) => {
    const bars = (y: number, h: number, lean: number, xs: number[]) => xs.map((x) => `M${x} ${y}h11l${lean} ${h}h-11z`).join("");
    return (
      <>
        <g transform="rotate(-8 3 30)">
          <path d={box(0, 18, 112, 12)} fill={t.edge} />
          <path d={bars(18, 12, -6, [10, 32, 54, 76, 98])} fill={t.pale} />
        </g>
        <path d={box(0, 31, 112, 12)} fill={t.edge} />
        <path d={bars(31, 12, 6, [4, 26, 48, 70, 92])} fill={t.pale} />
        <path d="M0 43H112V108Q112 112 108 112H4Q0 112 0 108Z" fill={t.color} />
        {full ? <path d="M0 95H112M56 95V112" stroke={t.soft} strokeWidth={hair} /> : <path d={rules([64, 88], 14, 98)} stroke={t.pale} strokeWidth="9" />}
      </>
    );
  },
};

/* ── PDF·문서: 빨강 ── */
const clipDoc: PaperArt = {
  id: "clipdoc",
  w: 98,
  h: 128,
  slot: { x: 10, y: 46, w: 78, h: 46, fill: "ink", on: "pale" },
  draw: (t, full, hair) => (
    <>
      <path d="M0 8H70L98 36V128H0Z" fill={t.pale} />
      <path d="M70 8V36H98Z" fill={t.soft} />
      {full ? (
        <>
          <path d={box(10, 96, 34, 5)} fill={t.color} />
          <path d={rules([110, 118], 10, 88)} stroke={t.soft} strokeWidth={hair} />
        </>
      ) : (
        <path d={rules([62, 84, 106], 14, 84)} stroke={t.color} strokeWidth="9" />
      )}
      {line("M24 26V8a5 5 0 0 1 10 0V32a8.5 8.5 0 0 1-17 0V12", t.color, full ? 3.2 : 5)}
    </>
  ),
};

const stapled: PaperArt = {
  id: "stapled",
  w: 104,
  h: 128,
  slot: { x: 10, y: 26, w: 72, h: 54, fill: "ink", on: "pale" },
  draw: (t, full, hair) => (
    <>
      <path d={box(3, 8, 88, 114)} fill={t.color} transform="rotate(5.5 8 12)" />
      <path d={box(3, 8, 88, 114)} fill={t.soft} transform="rotate(2.7 8 12)" />
      <path d={box(0, 6, 90, 120)} fill={t.pale} />
      {full ? <path d={rules([90, 102, 114], 10, 80)} stroke={t.soft} strokeWidth={hair} /> : <path d={rules([52, 76, 100], 14, 76)} stroke={t.color} strokeWidth="9" />}
      {line("M8 17L20 11", t.ink, full ? 2.2 : 5)}
    </>
  ),
};

const redTag: PaperArt = {
  id: "redtag",
  w: 132,
  h: 84,
  slot: { x: 34, y: 24, w: 88, h: 48, fill: "pale", on: "edge" },
  draw: (t, full, hair) => (
    <>
      <path d={`M24 14H128Q132 14 132 18V80Q132 84 128 84H24L0 62V36Z${dot(17, 49, full ? 5 : 8)}`} fill={t.edge} />
      {full ? <path d="M30 20H126V78H30" fill="none" stroke={t.soft} strokeWidth={hair} strokeDasharray="5 4" /> : <path d={rules([38, 60], 38, 118)} stroke={t.pale} strokeWidth="10" />}
      {line("M17 44C8 22 18 3 36 3C50 3 52 13 44 16", t.color, full ? hair * 1.5 : 5)}
    </>
  ),
};

/* ── 표: 주황 ── */
const ledger: PaperArt = {
  id: "ledger",
  w: 124,
  h: 100,
  slot: { x: 9, y: 8, w: 98, h: 24, fill: "ink", on: "soft" },
  draw: (t, full, hair) => (
    <>
      <path d="M0 0H106L124 18V100H0Z" fill={t.pale} />
      <path d="M0 0H106L124 18V32H0Z" fill={t.soft} />
      {full ? (
        <>
          <path d={box(40, 46, 26, 13) + box(92, 73, 32, 14)} fill={t.soft} />
          <path d={`${rules([46, 59, 73, 87], 0, 124)}M40 32V100M66 32V100M92 32V100`} stroke={t.color} strokeWidth={hair} />
        </>
      ) : (
        <path d={`${rules([54, 76], 0, 124)}M42 32V100M84 32V100`} stroke={t.color} strokeWidth="7" />
      )}
    </>
  ),
};

const receipt: PaperArt = {
  id: "receipt",
  w: 86,
  h: 132,
  slot: { x: 8, y: 22, w: 70, h: 40, fill: "ink", on: "soft", mono: true, center: true },
  draw: (t, full, hair) => {
    const teeth = Array.from({ length: 6 }, () => "l-7.17 8l-7.17 -8").join("");
    return (
      <>
        <path d={`M0 0H86V124${teeth}V0Z${dot(43, 11, full ? 4.5 : 7)}`} fill={t.soft} />
        {full ? (
          <>
            <path d="M8 66H78" stroke={t.edge} strokeWidth={hair} strokeDasharray="3 3" />
            <path d={rules([76, 86, 96], 8, 40) + rules([76, 86, 96], 62, 78)} stroke={t.edge} strokeWidth={hair * 1.3} />
            <path d={box(46, 105, 32, 6)} fill={t.edge} />
          </>
        ) : (
          <path d={rules([38, 62, 86], 14, 72) + rules([108], 40, 72)} stroke={t.color} strokeWidth="9" />
        )}
      </>
    );
  },
};

const tally: PaperArt = {
  id: "tally",
  w: 112,
  h: 104,
  slot: { x: 10, y: 8, w: 92, h: 44, fill: "ink", on: "color" },
  draw: (t, full) => {
    const group = (x: number, y: number, s: number) => `M${x} ${y}l1 ${s}M${x + 9} ${y - 1}l-1 ${s + 1}M${x + 18} ${y}l1 ${s}M${x + 27} ${y + 1}l-1 ${s - 1}M${x - 4} ${y + s - 5}L${x + 31} ${y + 4}`;
    return (
      <>
        <path d="M4 0H108Q112 0 112 4V88L96 104H4Q0 104 0 100V4Q0 0 4 0Z" fill={t.color} />
        {full ? (
          line(`${group(14, 62, 28)}M62 62l1 28M71 61l-1 29M80 62l1 28`, t.ink, 2.8)
        ) : (
          line(`M22 26V78M42 24V80M62 26V78M82 24V80M12 66L92 36`, t.pale, 8)
        )}
      </>
    );
  },
};

/* ── 소리: 보라 ── */
const record: PaperArt = {
  id: "record",
  w: 112,
  h: 112,
  slot: { x: 0, y: 0, w: 108, h: 24, fill: "pale", on: "edge", arc: "M21 56A35 35 0 0 1 91 56" },
  draw: (t, full, hair) => (
    <>
      <path d={dot(56, 56, 56) + dot(56, 56, full ? 3.5 : 6)} fill={t.edge} />
      {full ? <path d={dot(56, 56, 51) + dot(56, 56, 23)} fill="none" stroke={t.color} strokeWidth={hair} /> : <path d="M56 8A48 48 0 0 1 104 56L82 56A26 26 0 0 0 56 30Z" fill={t.soft} />}
      <path d={dot(56, 56, full ? 19 : 22) + dot(56, 56, full ? 3.5 : 6)} fill={t.soft} />
    </>
  ),
};

const cassette: PaperArt = {
  id: "cassette",
  w: 132,
  h: 86,
  slot: { x: 14, y: 8, w: 104, h: 24, fill: "ink", on: "pale", center: true },
  draw: (t, full) => (
    <>
      <path d="M5 0H127Q132 0 132 5V81Q132 86 127 86H5Q0 86 0 81V5Q0 0 5 0Z" fill={t.color} />
      <path d={box(9, 7, 114, 26)} fill={t.pale} />
      <path d={box(36, 39, 60, 22)} fill={t.edge} />
      <path d={dot(49, 50, 7) + dot(83, 50, 7)} fill={t.pale} />
      {full && <path d={dot(49, 50, 2.2) + dot(83, 50, 2.2)} fill={t.edge} />}
      <path d="M26 86L32 68H100L106 86Z" fill={t.edge} />
      {full && <path d={dot(52, 77, 2) + dot(80, 77, 2)} fill={t.pale} />}
    </>
  ),
};

const soundSticker: PaperArt = {
  id: "sound",
  w: 112,
  h: 112,
  slot: { x: 14, y: 64, w: 84, h: 26, fill: "ink", on: "soft", center: true },
  draw: (t, full) => (
    <>
      <path d="M56 0A56 56 0 0 1 104 85L85 104A56 56 0 1 1 56 0Z" fill={t.soft} />
      <path d="M104 85Q88 86 85 104Z" fill={t.pale} />
      {full ? line("M26 38V48M36 30V56M46 24V62M56 32V54M66 20V66M76 28V58M86 38V48", t.edge, 4.5) : line("M26 46V66M42 30V82M58 20V92M74 34V78M88 48V64", t.color, 9)}
    </>
  ),
};

/* ── 디자인: 분홍 ── */
const paletteBlob: PaperArt = {
  id: "palette",
  w: 124,
  h: 106,
  slot: { x: 14, y: 44, w: 72, h: 50, fill: "ink", on: "soft" },
  draw: (t, full) => (
    <>
      <path d={`M58 1C96 -2 124 20 124 50C124 72 108 84 94 82C82 80 73 85 73 94C73 102 64 106 54 106C22 106 0 84 0 54C0 24 24 3 58 1Z${dot(100, 58, full ? 7 : 9)}`} fill={t.soft} />
      <path d={dot(30, 28, full ? 8 : 10)} fill={t.edge} />
      <path d={dot(56, 17, full ? 8 : 10)} fill={t.color} />
      <path d={dot(84, 20, full ? 8 : 10)} fill={t.pale} />
      {!full && <path d={dot(32, 68, 12) + dot(60, 80, 9)} fill={t.edge} />}
    </>
  ),
};

const swatchFan: PaperArt = {
  id: "fan",
  w: 124,
  h: 120,
  slot: { x: 30, y: 93, w: 88, h: 24, fill: "ink", on: "pale", center: true },
  draw: (t, full) => {
    // 왼쪽 끝을 둥글게 해서 돌려도 축 둘레가 매끈합니다.
    const blade = `M15 90H121Q124 90 124 93V117Q124 120 121 120H15A15 15 0 0 1 15 90Z${dot(15, 105, 3.6)}`;
    return (
      <>
        <path d={blade} fill={t.edge} transform="rotate(-66 15 105)" />
        <path d={blade} fill={full ? t.color : t.soft} transform="rotate(-44 15 105)" />
        <path d={blade} fill={full ? t.soft : t.pale} transform="rotate(-22 15 105)" />
        <path d={blade} fill={full ? t.pale : t.soft} />
      </>
    );
  },
};

const starSticker: PaperArt = {
  id: "star",
  w: 112,
  h: 112,
  slot: { x: 12, y: 76, w: 88, h: 26, fill: "pale", on: "edge", center: true },
  draw: (t, full, hair) => (
    <>
      <path d="M8 0H104Q112 0 112 8V94L94 112H8Q0 112 0 104V8Q0 0 8 0Z" fill={t.edge} />
      <path d="M112 94H100Q94 94 94 100V112Z" fill={t.soft} />
      <path d="M56 10L64.2 30.7L86.4 32.1L69.3 46.3L74.8 67.9L56 56L37.2 67.9L42.7 46.3L25.6 32.1L47.8 30.7Z" fill={t.soft} />
      {full && <path d={dot(49, 37, 2.2) + dot(63, 37, 2.2)} fill={t.edge} />}
      {full && line("M50 44C53 48 59 48 62 44", t.edge, hair * 1.4)}
    </>
  ),
};

/* ── 압축: 갈색 ── */
const cardboardBox: PaperArt = {
  id: "box",
  w: 124,
  h: 106,
  slot: { x: 22, y: 50, w: 80, h: 47, fill: "ink", on: "pale" },
  draw: (t, full, hair) => (
    <>
      <path d={box(0, 18, 124, 88)} fill={t.soft} />
      <path d="M0 0H124V24H0Z" fill={t.color} />
      <path d="M50 0H74V38L70 34L66 38L62 34L58 38L54 34L50 38Z" fill={t.pale} />
      {full && (
        <>
          <path d={box(16, 46, 92, 50)} fill={t.pale} />
          {line("M94 18V7M90 11L94 7L98 11M106 18V7M102 11L106 7L110 11", t.pale, hair * 1.3)}
        </>
      )}
    </>
  ),
};

const luggageTag: PaperArt = {
  id: "luggage",
  w: 92,
  h: 134,
  slot: { x: 12, y: 58, w: 68, h: 46, fill: "ink", on: "pale" },
  draw: (t, full, hair) => (
    <>
      <path d={`M18 20H74L92 40V130Q92 134 88 134H4Q0 134 0 130V40Z${dot(46, 36, full ? 5 : 7)}`} fill={t.color} />
      {full && <circle cx="46" cy="36" r="6.4" fill="none" stroke={t.pale} strokeWidth="2.4" />}
      {line("M46 33C30 26 26 9 39 4C51 0 61 8 56 18C53 24 50 28 47 33", t.edge, full ? hair * 1.5 : 5)}
      <path d={box(7, 52, 78, 74)} fill={t.pale} />
      {full ? <path d={rules([109, 118], 12, 80)} stroke={t.soft} strokeWidth={hair} /> : <path d={rules([70, 92, 112], 16, 76)} stroke={t.color} strokeWidth="9" />}
    </>
  ),
};

const kraftFolder: PaperArt = {
  id: "folder",
  w: 132,
  h: 96,
  slot: { x: 10, y: 34, w: 112, h: 56, fill: "ink", on: "soft" },
  draw: (t) => (
    <>
      <path d="M0 96V6H44L54 18H132V96Z" fill={t.color} />
      <path d={box(0, 26, 132, 70)} fill={t.soft} />
    </>
  ),
};

/* ── 기타: 회색 ── */
const plainTag: PaperArt = {
  id: "tag",
  w: 124,
  h: 66,
  slot: { x: 32, y: 9, w: 84, h: 48, fill: "ink", on: "soft" },
  draw: (t, full) => (
    <>
      <path d={`M18 0H124V66H18L0 48V18Z${dot(17, 33, full ? 4.5 : 7)}`} fill={t.soft} />
      {full ? <circle cx="17" cy="33" r="5.8" fill="none" stroke={t.pale} strokeWidth="2.4" /> : <path d={rules([24, 44], 36, 112)} stroke={t.color} strokeWidth="9" />}
    </>
  ),
};

const punchedCard: PaperArt = {
  id: "punched",
  w: 132,
  h: 78,
  slot: { x: 16, y: 6, w: 108, h: 26, fill: "ink", on: "soft", mono: true },
  draw: (t, full) => {
    const rows: [number, number[]][] = [[38, [10, 22, 46, 58, 82, 106, 118]], [50, [16, 34, 52, 76, 94, 112]], [62, [10, 28, 40, 64, 88, 100, 118]]];
    return (
      <path
        d={`M14 0H132V78H0V14Z${(full ? rows : ([[34, [14, 44, 74, 104]], [56, [29, 59, 89]]] as [number, number[]][])).flatMap(([y, xs]) => xs.map((x) => box(x, y, full ? 4.5 : 12, full ? 8 : 14))).join("")}`}
        fill={t.soft}
      />
    );
  },
};

const blankLabel: PaperArt = {
  id: "label",
  w: 116,
  h: 72,
  slot: { x: 14, y: 12, w: 88, h: 48, fill: "ink", on: "soft", center: true },
  draw: (t, full, hair) => (
    <>
      <path d="M10 0H106A10 10 0 0 0 116 10V62A10 10 0 0 0 106 72H10A10 10 0 0 0 0 62V10A10 10 0 0 0 10 0Z" fill={t.soft} />
      {full ? <path d="M14 5H102A10 10 0 0 0 111 14V58A10 10 0 0 0 102 67H14A10 10 0 0 0 5 58V14A10 10 0 0 0 14 5Z" fill="none" stroke={t.edge} strokeWidth={hair} /> : <path d={rules([26, 46], 24, 92)} stroke={t.color} strokeWidth="9" />}
    </>
  ),
};

// 첫 장이 seed 없을 때(범례 같은 곳)의 모양입니다. pdf와 문서는 첫 장을 달리해 색 없이도 구분돼요.
export const paperArts: Record<Kind, PaperArt[]> = {
  image: [photoPrint, slideMount, snapshot],
  text: [memo, sticky, notebookStrip],
  video: [ticket, filmStrip, slate],
  pdf: [clipDoc, stapled, redTag],
  office: [stapled, clipDoc, redTag],
  table: [ledger, receipt, tally],
  audio: [record, cassette, soundSticker],
  design: [paletteBlob, swatchFan, starSticker],
  archive: [cardboardBox, luggageTag, kraftFolder],
  unknown: [plainTag, punchedCard, blankLabel],
};

function hashOf(seed: string) {
  let hash = 2166136261;
  for (let at = 0; at < seed.length; at += 1) hash = Math.imul(hash ^ seed.charCodeAt(at), 16777619);
  return hash >>> 0;
}

export const pickArt = (kind: Kind, seed?: string) => paperArts[kind][seed ? hashOf(seed) % paperArts[kind].length : 0];

// 글자 폭 어림값(em). DOM을 재지 않아 움직이는 동안 레이아웃이 일어나지 않고, 테스트에서도 그대로 돕니다.
function charWidth(char: string, mono?: boolean) {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) || char.length > 1) return 1;
  // Pretendard에서 잰 값(한글 0.86, 밑줄 0.44)에 조금 여유를 뒀어요.
  if (/\p{Script=Hangul}/u.test(char)) return 0.88;
  if (mono) return 0.62;
  if (/[_-]/.test(char)) return 0.45;
  if (/[.,:;'|!ijlI ]/.test(char)) return 0.32;
  if (/[WM@%]/.test(char)) return 1;
  if (/[A-Zmw#&]/.test(char)) return 0.76;
  return 0.58;
}

const widthOf = (chars: string[], mono?: boolean) => chars.reduce((sum, char) => sum + charWidth(char, mono), 0);

const ellipsisWidth = 0.8;

function middleCut(chars: string[], em: number, mono?: boolean) {
  // 어림값이 실제보다 조금 넉넉하고 슬롯 옆에 종이 여백이 있어서, 5%쯤 넘치는 것까지는 들어간다고 봅니다.
  const fits = em * 1.05;
  if (widthOf(chars, mono) <= fits) return chars.join("");
  const room = fits - ellipsisWidth;
  const dot = chars.lastIndexOf(".");
  const ending = dot > 0 ? chars.slice(dot + 1) : [];
  // 확장자는 앞 두 글자와 함께 들어갈 때만 통째로 남겨요. 못 들어가면 앞만 남깁니다. '표…psd'보다 '표지후…'가 읽히고, 형식은 색과 모양이 말해요.
  const headOnly = ending.length > 0 && widthOf(ending, mono) + widthOf(chars.slice(0, 2), mono) > room;
  const extension = headOnly ? [] : ending;
  const head: string[] = [];
  const extra: string[] = [];
  let [from, to, used] = [0, ending.length ? dot - 1 : chars.length - 1, widthOf(extension, mono)];
  while (from <= to) {
    // 첫 글자를 담은 뒤로는 앞쪽을 뒤쪽의 세 배쯤 담습니다. 이름은 앞이 더 잘 읽혀요.
    const takeTail = !headOnly && head.length > 0 && widthOf(extra, mono) + charWidth(chars[to], mono) <= widthOf(head, mono) / 3;
    const char = takeTail ? chars[to] : chars[from];
    // 점은 확장자 앞에 글자가 붙을 때만 찍히니 폭도 그때 셉니다.
    used += charWidth(char, mono) + (takeTail && !extra.length && extension.length ? charWidth(".", mono) : 0);
    if (used > room) break;
    if (takeTail) { extra.unshift(char); to -= 1; } else { head.push(char); from += 1; }
  }
  return `${head.join("")}…${extra.join("")}${extra.length && extension.length ? "." : ""}${extension.join("")}`;
}

// 이름을 슬롯 폭(em)에 맞춰 줄로 나눕니다. 넘치는 마지막 줄은 가운데를 줄여 확장자가 남아요. macOS 파일 이름의 풀어쓴 한글(NFD)은 먼저 모읍니다.
export function fitName(name: string, em: number, lines = 1, mono?: boolean): string[] {
  // 글자 단위로 끊어야 이모지 묶음이나 국기가 반쪽 나지 않아요.
  let rest = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.normalize("NFC").trim()), (part) => part.segment);
  const out: string[] = [];
  while (out.length < lines - 1 && widthOf(rest, mono) > em) {
    let count = 0;
    let used = 0;
    while (count < rest.length && used + charWidth(rest[count], mono) <= em) {
      used += charWidth(rest[count], mono);
      count += 1;
    }
    let cut = count;
    const extension = rest.lastIndexOf(".");
    // 확장자는 쪼개지 않고 통째로 다음 줄로 넘깁니다. 그 밖에는 공백·구분자에서 끊어요.
    if (extension > 0 && extension < count) cut = extension;
    else for (let at = count; at > count / 2; at -= 1) {
      if (/[\s_-]/.test(rest[at - 1])) { cut = at; break; }
    }
    if (cut === 0) cut = 1;
    out.push(rest.slice(0, cut).join("").trim());
    rest = rest.slice(cut);
  }
  out.push(middleCut(rest, em, mono));
  return out;
}

function PrintedName({ slot, name, tones, unit, id }: { slot: Slot; name: string; tones: PaperTones; unit: number; id: string }) {
  const style = { fontFamily: slot.mono ? "var(--font-mono)" : "var(--font-sans)", fontWeight: 500 };
  const fill = tones[slot.fill];
  if (slot.arc) {
    return (
      <>
        <path id={id} d={slot.arc} fill="none" />
        <text fontSize={unit} fill={fill} style={style} textAnchor="middle">
          <textPath href={`#${id}`} startOffset="50%">{fitName(name, slot.w / unit, 1, slot.mono)[0]}</textPath>
        </text>
      </>
    );
  }
  const leading = unit * 1.24;
  const printed = fitName(name, slot.w / unit, Math.max(1, Math.floor(slot.h / leading)), slot.mono);
  const top = slot.center ? slot.y + (slot.h - printed.length * leading) / 2 + unit * 1.02 : slot.y + unit * 0.92;
  return (
    <text fontSize={unit} fill={fill} style={style} textAnchor={slot.center ? "middle" : "start"}>
      {printed.map((text, at) => <tspan key={at} x={slot.center ? slot.x + slot.w / 2 : slot.x} y={top + at * leading}>{text}</tspan>)}
    </text>
  );
}

export function ObjectShape({ kind, color, size, name, seed, nameFrom = 56 }: { kind: Kind; color?: string; size: number; name?: string; seed?: string; nameFrom?: number }) {
  const id = useId();
  const art = pickArt(kind, seed);
  const tones = color && color !== kindColors[kind] ? tonesFrom(color) : kindTones[kind];
  const full = Boolean(name) && size >= 40;
  // 작은 모양은 판 위에서 잘 보이도록 한 단 진하게 칠하고, 늘 정사각형 칸에 넣어 부르는 쪽 자리 계산을 그대로 둡니다.
  const side = Math.max(art.w, art.h);
  const paint = full ? tones : { pale: tones.soft, soft: tones.color, color: tones.edge, edge: tones.edge, ink: tones.ink };
  const perPixel = (full ? art.w : side) / size;
  return (
    <svg
      className="object"
      viewBox={full ? `0 0 ${art.w} ${art.h}` : `${(art.w - side) / 2} ${(art.h - side) / 2} ${side} ${side}`}
      width={size}
      height={full ? size * (art.h / art.w) : size}
      aria-hidden="true"
    >
      <g fillRule="evenodd">{art.draw(paint, full, Math.max(0.9, perPixel))}</g>
      {/* 가장 작아도 8.5px, 56 위로는 종이보다 천천히 커져 글자가 서류처럼 작게 남습니다. */}
      {full && name && size >= nameFrom && <PrintedName slot={art.slot} name={name} tones={tones} unit={Math.max(8.5, 5.7 + size * 0.05) * perPixel} id={id} />}
    </svg>
  );
}
