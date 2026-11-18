// 부스 아이콘 5개: Folduct 종이와 같은 방식(형식 톤 면 + makePen 흔들리는 잉크 선)으로 그린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { makePen } from "/Users/junhyeokkong/Folduct/apps/room/src/art/duct";
import { quad, ring, poly, wavy } from "/Users/junhyeokkong/Folduct/apps/room/src/art/paperArts";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

const INK = "#171717"; // styles.css --ink
const T = {
  yellow: { pale: "#fbefc8", soft: "#f0d78c", color: "#e5bb4d", edge: "#8e6e1a" },
  green: { pale: "#dfefd5", soft: "#abd1a8", color: "#5f9b6d", edge: "#3b5f4d" },
  red: { pale: "#f8e0d8", soft: "#eaab9a", color: "#c9553f", edge: "#8d2d1e" },
  orange: { pale: "#fbe5d0", soft: "#f3c096", color: "#dd8b47", edge: "#a35a22" },
  pink: { pale: "#f9dde8", soft: "#efb7cf", color: "#c95b93", edge: "#863a62" },
};

type Part = { d: string; fill: string } | { d: string; pen: number; ink?: string } | { raw: string };
type Group = { t?: string; parts: Part[] };

const W = 2.8; // 120 칸 기준 펜 굵기. 종이 100칸에 2.4px과 같은 비율.
const half = (x: number, y: number, r: number) => `M${x - r} ${y}C${x - r} ${y - r * 1.32} ${x + r} ${y - r * 1.32} ${x + r} ${y}Z`;
const both = (d: string, fill: string, pen = 1): Part[] => [{ d, fill }, { d, pen }];

function svg(seed: number, groups: Group[]) {
  const pen = makePen(seed, 2.6);
  const body = groups.map(({ t, parts }) => {
    const inner = parts.map((p) => "raw" in p ? p.raw : "fill" in p
      ? `<path d="${p.d}" fill="${p.fill}" fill-rule="evenodd"/>`
      : `<g fill="${p.ink ?? INK}">${pen(p.d, W * p.pen).map((x) => `<path d="${x.d}"${x.even ? ' fill-rule="evenodd"' : ""}/>`).join("")}</g>`).join("");
    return t ? `<g transform="${t}">${inner}</g>` : inner;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">${body}</svg>`;
}

// 포토부스: 카메라 (흰 몸통 + 검은 띠·렌즈)
const y = { white: "#fbfaf7", grey: "#e4e2dc", black: "#262626", dark: "#3a3a3a" };
const photo = svg(11, [{ t: "rotate(-6 60 66)", parts: [
  ...both(poly([[40, 40], [46, 27], [74, 27], [80, 40]], true), y.white),
  ...both(quad(84, 31, 13, 9, 0.4), y.black, 0.8),
  ...both(quad(12, 40, 96, 62), y.white),
  ...both(quad(12, 52, 96, 34, 0.6), y.black, 0.7),
  ...both(quad(19, 45, 14, 6, 0.4), y.grey, 0.7),
  ...both(ring(60, 70, 23), y.white),
  ...both(ring(60, 70, 15), y.black, 0.8),
  { d: ring(60, 70, 9), fill: y.dark },
  { d: "M52 64C53 60 56 58 60 57", pen: 0.9, ink: y.white },
  { d: ring(92, 47, 3), fill: y.black },
] }]);

// 굿즈부스: 열쇠 모양 키링 (은색)
const p = { pale: "#f4f5f7", color: "#b9bfc7" };
const goods = svg(23, [{ t: "rotate(40 60 60)", parts: [
  ...both("M48 55L104 55L104 65L96 65L96 74L89 74L89 69L83 69L83 76L76 76L76 65L48 65Z", p.color),
  { d: `${ring(36, 60, 17)}${ring(29, 60, 5)}`, fill: p.color },
  { d: ring(36, 60, 17), pen: 1 },
  { d: ring(29, 60, 5), pen: 0.8 },
  { d: ring(39, 60, 9), pen: 0.6, ink: p.pale },
  { d: wavy(58, 60, 98, 0.6), pen: 0.6, ink: p.pale },
  { d: ring(17, 60, 13), pen: 1.1 },
] }]);

// 한정선: 과일찹쌀떡 단면 셋 (떡 > 앙금 > 과일)
const MOCHI = "#fffaf2";
const BEAN = { soft: "#cfb189", pale: "#eee2cd" };
const mochi = (x: number, cy: number, deg: number, fruit: Part[]): Group => ({ t: `rotate(${deg} ${x} ${cy})`, parts: [
  ...both(ring(x, cy, 23, 21), MOCHI),
  { d: ring(x, cy + 0.5, 19, 17.5), fill: BEAN.soft },
  ...fruit,
] });
const r = T.red, o = T.orange, g = T.green;
const strawberry = (x: number, cy: number): Part[] => [
  ...both(`M${x} ${cy + 15}C${x - 19} ${cy + 3} ${x - 16} ${cy - 15} ${x} ${cy - 12}C${x + 16} ${cy - 15} ${x + 19} ${cy + 3} ${x} ${cy + 15}Z`, r.color, 0.8),
  { d: `M${x} ${cy + 7}C${x - 6} ${cy + 1} ${x - 5} ${cy - 5} ${x} ${cy - 4}C${x + 5} ${cy - 5} ${x + 6} ${cy + 1} ${x} ${cy + 7}Z`, fill: r.pale },
  ...[[-10, -4], [10, -4], [-7, 6], [7, 6], [0, -9], [-12, 2], [12, 2]].map(([dx, dy]) => ({ d: ring(x + dx, cy + dy, 0.9), fill: r.pale })),
];
const tangerine = (x: number, cy: number): Part[] => [
  ...both(ring(x, cy + 0.5, 15), o.color, 0.8),
  { d: ring(x, cy + 0.5, 11.5), fill: o.soft },
  { d: [0, 60, 120, 180, 240, 300].map((a) => { const t = (a * Math.PI) / 180; return `M${x} ${cy + 1}L${(x + Math.cos(t) * 11.5).toFixed(1)} ${(cy + 1 + Math.sin(t) * 11.5).toFixed(1)}`; }).join(""), pen: 0.45, ink: o.edge },
];
const grape = (x: number, cy: number): Part[] => [
  ...both(ring(x, cy + 0.5, 14, 15), g.soft, 0.8),
  { d: ring(x - 1, cy - 1, 8, 9.5), fill: g.pale },
];
const limited = svg(37, [
  mochi(56, 33, -10, grape(56, 33)),
  mochi(35, 81, 8, tangerine(35, 81)),
  mochi(84, 77, -4, strawberry(84, 77)),
]);

// 게임부스: 장난감 병정
const game = svg(51, [{ parts: [
  ...both(ring(60, 104, 32, 7), g.color),
  ...both("M43 64L53 64L46 98L35 99Z", g.color),
  ...both("M55 63L66 62L82 97L71 99Z", g.color),
  ...both("M42 36C47 32 58 32 63 36L66 65L40 66Z", g.color),
  ...both("M46 26L60 26L58 35L48 35Z", g.soft, 0.8),
  ...both("M39 26C39 12 63 10 65 24L66 27L38 28Z", g.color),
  ...both("M34 47L45 44L47 53L36 56Z", g.edge, 0.9),
  ...both("M44 47L100 38L101 43L45 52Z", g.edge, 0.9),
  ...both("M56 37L76 40L75 47L57 46Z", g.color, 0.9),
  { d: wavy(41, 58, 65, 0.8), pen: 0.7 },
] }]);

// 웰컴부스: 탑이 있는 작은 집
const welcome = svg(67, [{ parts: [
  ...both(quad(14, 64, 58, 40), r.pale),
  ...both(poly([[9, 67], [22, 46], [73, 46], [73, 67]], true), r.color),
  ...both(quad(70, 48, 32, 56), r.pale),
  ...both(poly([[65, 52], [86, 16], [107, 52]], true), r.color),
  { d: "M86 16L86 7M82 10L90 10", pen: 0.9 },
  ...[22, 38, 54].flatMap((wx) => both(quad(wx, 76, 9, 12, 0.4), r.soft, 0.7)),
  ...both(ring(86, 63, 5), r.soft, 0.7),
  ...both("M80 104L80 86C80 78 92 78 92 86L92 104Z", r.edge, 0.8),
  { d: wavy(10, 104, 110, 0.8), pen: 1 },
] }]);

// 곰: 프로도 펜 선만 빌리고, 생김새는 속 빈 흰 몸 + 작은 점 눈 + 길쭉한 비율.
const WH = "#fbfaf7";
const L = 0.75; // 가는 선
// 귀·머리·몸이 한 덩어리. 일부러 좌우가 안 맞고 눈은 한쪽으로 몰려 있다.
const bearParts: Part[] = [
  { d: wavy(18, 110, 102, 0.6), pen: L },
  ...both("M47 94L56 94L56 109L46 109Z", WH, L),
  ...both("M65 94L73 94L74 107L65 108Z", WH, L),
  ...both("M44 96C39 84 38 66 41 46C42 38 41 33 41 30C34 26 34 12 44 13C50 13 52 18 51 22C56 20 63 20 68 22C68 15 77 12 80 18C83 23 80 28 77 31C80 42 81 58 80 72C79 82 78 90 77 96Z", WH, L),
  ...both("M43 60C29 60 27 75 37 76L47 75C51 75 51 70 47 70L40 70C36 70 36 65 43 65Z", WH, L),
  // 앞으로 뻗은 팔 끝에 은색 열쇠 키링
  ...both("M101.5 74L104.5 74L104.5 80L108 80L108 82.5L104.5 82.5L104.5 84L107 84L107 86.5L104.5 86.5L104.5 89L101.5 89Z", p.color, 0.5),
  { d: `${ring(103, 70, 4.6)}${ring(103, 68.6, 1.5)}`, fill: p.color },
  { d: ring(103, 70, 4.6), pen: 0.55 },
  { d: ring(103, 68.6, 1.5), pen: 0.4 },
  ...both("M78 55L99 51C104 50 106 56 101 57L78 61Z", WH, L),
  { d: ring(102.5, 61, 4, 4.4), pen: 0.6 },
  { d: ring(51.5, 36, 1.9, 2.2), fill: INK },
  { d: ring(60, 35.5, 2, 2.3), fill: INK },
  ...both(ring(56, 40.5, 3, 2.1), WH, 0.5),
  { d: "M53 45.5C54.5 48 58 48 59.5 45.2", pen: 0.6 },
];
const bear = svg(83, [{ parts: bearParts }]);


// 곰 아크릴 키링: 곰 모양을 따라 두른 투명판 + 구멍 난 고리 + 쇠고리.
// shortcut: 판 테두리는 굵은 획을 겹쳐 만든 매끈한 선이라 펜처럼 흔들리지 않아요. 흔들리게 하려면 바깥 윤곽 길을 따로 그려 펜에 넘겨요.
const ACRYL = "#eef2f5";
// 투명판: 그림의 면 모양을 굵게 칠해 겹친 판(잉크 테두리 + 연한 판) + 구멍 고리. id는 마스크 이름.
type Hole = { x: number; y: number; r: number };
const plateOf = (id: string, parts: Part[], hole: Hole, opens: string[] = []) => {
  const fills = [...parts.filter((x): x is { d: string; fill: string } => "fill" in x).map((x) => x.d), ring(hole.x, hole.y + 1, hole.r + 5.8)];
  const cut = (color: string, width: number) => fills.map((d) => `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`).join("")
    + opens.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`).join("");
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-20" y="-40" width="160" height="180"><rect x="-20" y="-40" width="160" height="180" fill="#fff"/><circle cx="${hole.x}" cy="${hole.y}" r="${hole.r}" fill="#000"/></mask>`
    + `<g mask="url(#${id})">${cut(INK, 17)}${cut(ACRYL, 13.6)}</g>`;
};
const hole = { x: 59, y: 1, r: 3.2 };
const plate = plateOf("bear-hole", bearParts, hole, [wavy(18, 110, 102, 0.6)]);
const bearKeyring = svg(83, [
  { t: "translate(11.5 32.5) scale(0.72)", parts: [
    { raw: plate },
    { d: ring(hole.x, hole.y, hole.r), pen: 0.7 },
    ...bearParts,
  ] },
  { parts: [{ d: ring(54, 25, 9.5), pen: 1.1 }] },
]);
// 성경책 아크릴 키링: 비스듬히 누운 통통한 책. 둥근 모서리, 왼쪽 등, 아래로 보이는 종이, 표지 위 십자가.
// 모서리를 r만큼 둥글게 깎은 닫힌 길.
const soft = (pts: [number, number][], r: number) => {
  const at = (i: number) => pts[(i + pts.length) % pts.length];
  const toward = (p: [number, number], q: [number, number]) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); const k = Math.min(r, d / 2) / d; return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k].map((n) => Math.round(n * 10) / 10); };
  return pts.map((p, i) => { const a = toward(p, at(i - 1)); const b = toward(p, at(i + 1)); return `${i ? "L" : "M"}${a[0]} ${a[1]}C${p[0]} ${p[1]} ${p[0]} ${p[1]} ${b[0]} ${b[1]}`; }).join("") + "Z";
};
const COVER = "#f6f4ef", SPINE = "#e4e2dc";
// 상자처럼 면 셋: 위 표지 ABCD, 두께 t만큼 내려온 왼쪽 책등과 아래 종이 면. 모서리는 같은 점을 나눠 쓴다.
type P = [number, number];
const A: P = [30, 28], B: P = [88, 12], C: P = [104, 68], Dp: P = [46, 84];
const t = (p: P): P => [p[0] - 8, p[1] + 12];
const mid = (p: P, q: P, k: number): P => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
const BL = 1.15; // 책은 작게 줄여 넣어서 선을 굵게
const bookParts: Part[] = [
  ...both(soft([A, Dp, t(Dp), t(A)], 2), SPINE, BL),
  ...both(soft([Dp, C, t(C), t(Dp)], 2), WH, BL),
  { d: poly([mid(Dp, t(Dp), 0.5), mid(C, t(C), 0.5)]), pen: 0.6 },
  { d: poly([mid(A, t(A), 0.5), mid(Dp, t(Dp), 0.5)]), pen: 0.6, ink: "#a8a59d" },
  ...both(soft([A, B, C, Dp], 5), COVER, BL),
  // 통통하고 끝이 동글동글한 십자가. 표지 기울기만큼 돌리고, 옆에 반짝 두 줄.
  { raw: `<g transform="rotate(-8 67 50)" fill="${INK}"><rect x="62" y="33" width="10" height="34" rx="5"/><rect x="54" y="41.5" width="26" height="10" rx="5"/></g>` },
  { d: "M80.5 33.5L84 29.5M84 38L88.5 37", pen: 1 },
];
const bookHole = { x: 58, y: 12, r: 3.2 };
const bibleKeyring = svg(97, [
  { t: "translate(9 17) scale(0.82)", parts: [{ raw: plateOf("book-hole", bookParts, bookHole) }, { d: ring(bookHole.x, bookHole.y, bookHole.r), pen: 0.95 }, ...bookParts] },
  { parts: [{ d: ring(56.6, 17.8, 10.5), pen: 1.1 }] },
]);

// 메모지 키링 둘: 위에 구멍 줄이 있는 반투명 종이 한 장. 글씨도 펜으로 그은 손글씨.
const BLUE = "#94aecb", STAR = "#e5bb4d", RED = "#c9553f", SHEET = "#f1f4f6";
// 6x8 칸 대문자 획. 필요한 글자만.
const glyph: Record<string, string> = {
  L: "M0 0L0 8L5 8", O: "M3 0C-1 0 -1 8 3 8C7 8 7 0 3 0Z", V: "M0 0L3 8L6 0", E: "M5 0L0 0L0 8L5 8M0 4L4 4",
  A: "M0 8L3 0L6 8M1.2 5L4.8 5", C: "M5.5 1.5C4 -0.5 0 -0.3 0 4C0 8.3 4 8.5 5.5 6.5", H: "M0 0L0 8M5 0L5 8M0 4L5 4",
  T: "M0 0L6 0M3 0L3 8", R: "M0 8L0 0L3.5 0C6 0 6 4.2 3.5 4.2L0 4.2M3 4.2L5.5 8",
};
const word = (text: string, x: number, y: number, k = 1, gap = 7.6) => [...text].map((ch, i) =>
  (glyph[ch] ?? "").replace(/(-?[\d.]+) (-?[\d.]+)/g, (_m, a, b) => `${Math.round((x + i * gap * k + +a * k) * 10) / 10} ${Math.round((y + +b * k) * 10) / 10}`)).join("");
const star = (x: number, y: number, r = 2.8) => poly(Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.45 : r;
  return [Math.round((x + Math.cos(a) * q) * 10) / 10, Math.round((y + Math.sin(a) * q) * 10) / 10] as [number, number];
}), true);
const holes = [34, 48, 62, 76].map((x) => ring(x, 21, 2.6));
const sheetParts = (w: number): Part[] => [
  { d: quad(26, 14, w, 96, 1) + holes.join(""), fill: SHEET },
  { d: quad(26, 14, w, 96, 1), pen: 1 },
  ...holes.map((d) => ({ d, pen: 0.6 })),
];
const hang: Part = { d: ring(34, 12.8, 8.5), pen: 0.8 };
// 손잡은 막대 사람: 머리, 몸, 다리. 팔은 셋을 잇는 한 줄로 따로 긋는다.
const figure = (x: number, y: number): Part[] => [
  { d: ring(x, y, 3.8, 4), fill: SHEET },
  { d: ring(x, y, 3.8, 4), pen: 0.7 },
  { d: `M${x} ${y + 4}L${x} ${y + 15}`, pen: 0.7 },
  { d: `M${x - 4} ${y + 24}L${x} ${y + 15}L${x + 4} ${y + 24}`, pen: 0.7 },
];
const loveNote = svg(101, [{ t: "translate(7 9) scale(0.88) rotate(-6 60 62)", parts: [
  ...sheetParts(64),
  ...[34, 46, 58, 70, 82, 94, 104].map((y): Part => ({ d: wavy(30, y, 86, 0.4), pen: 0.45, ink: BLUE })),
  { d: word("LOVE", 34, 32.5, 1.05), pen: 0.75 },
  { d: word("EACH", 38, 44.5, 1.05), pen: 0.75 },
  { d: word("OTHER", 42, 56.5, 1.05), pen: 0.75 },
  ...[[78, 34], [33, 52], [84, 60], [37, 76], [82, 84]].map(([x, y]): Part => ({ d: star(x, y), fill: STAR })),
  ...figure(44, 72), ...figure(58, 71), ...figure(72, 72),
  { d: "M37 85C42 80 50 81 58 80.5C66 81 74 80 79 85", pen: 0.7 },
  hang,
] }]);

// 체크리스트 메모: 구멍 아래 빨간 줄, 네모 칸과 손글씨처럼 구불한 줄. 몇 칸은 체크.
const checkNote = svg(103, [{ t: "translate(7 9) scale(0.88) rotate(5 60 62)", parts: [
  ...sheetParts(64),
  { d: wavy(29, 30, 87, 0.4), pen: 0.55, ink: RED },
  ...[38, 50, 62, 74, 86, 98].flatMap((y, i): Part[] => [
    { d: quad(32, y - 3.5, 7, 7, 0.3), pen: 0.6 },
    ...(i < 3 ? [{ d: `M33 ${y}L35.5 ${y + 2.5}L40.5 ${y - 5}`, pen: 0.75 }] : []),
    { d: `M44 ${y}C48 ${y - 2.5} 50 ${y + 2.5} 54 ${y}C58 ${y - 2.5} 60 ${y + 2.5} 64 ${y}C67 ${y - 2} ${70 + (i % 3) * 3} ${y + 2} ${74 + (i % 3) * 4} ${y}`, pen: 0.6 },
  ]),
  hang,
] }]);

const icons = { "photo-booth": photo, "goods-booth": goods, "limited": limited, "game-booth": game, "welcome-booth": welcome, "bear": bear, "bear-keyring": bearKeyring, "bible-keyring": bibleKeyring, "love-note-keyring": loveNote, "checklist-keyring": checkNote };
for (const [name, s] of Object.entries(icons)) writeFileSync(`${out}/${name}.svg`, s);
console.log(Object.keys(icons).join(" "));
