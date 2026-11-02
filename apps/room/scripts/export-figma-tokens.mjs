#!/usr/bin/env node
// styles.css의 :root 토큰과 palette.ts의 파일 형식 색을 읽어 Figma로 옮길 파일을 만듭니다.
// 코드가 기준입니다. 토큰을 바꾼 뒤 다시 돌리면 됩니다: node apps/room/scripts/export-figma-tokens.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(join(root, "src/styles.css"), "utf8");
const palette = await readFile(join(root, "src/art/palette.ts"), "utf8");

const block = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1].replace(/\/\*[\s\S]*?\*\//g, "");
const vars = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/\s+/g, " ")]));

// rgb(27 26 24 / 0.22) → #1b1a1838
const hex = (value) => {
  const m = value.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
  if (!m) return value;
  const h = (n) => Number(n).toString(16).padStart(2, "0");
  return `#${h(m[1])}${h(m[2])}${h(m[3])}${h(Math.round(Number(m[4]) * 255))}`;
};
const alias = (value) => value.replace(/^var\(--([\w-]+)\)$/, (_, name) => `{${path(name)}}`);
const px = (value) => Number(value.replace("px", ""));

// CSS 이름을 Figma 변수 이름(그룹/이름)으로 옮깁니다.
function path(name) {
  if (/^(bg|ground|surface|ink|line|on-ink|stitch|halo|brand)/.test(name)) return `color.neutral.${name}`;
  if (name.startsWith("lightbox")) return `color.lightbox.${name.replace("lightbox-", "") || "gradient"}`;
  if (name.startsWith("status-")) return `color.status.${name.replace("status-", "")}`;
  return name;
}

const tokens = { color: { neutral: {}, lightbox: {}, status: {}, kind: {}, box: {} }, size: { text: {}, lineHeight: {}, space: {}, radius: {}, layout: {}, control: {} }, font: {}, fontWeight: {}, typography: {}, shadow: {}, motion: {}, scene: {} };
const notes = [];

for (const [name, raw] of Object.entries(vars)) {
  const value = raw.trim();
  if (/^(bg|ground|surface|ink|line|on-ink|stitch|halo|brand)/.test(name)) tokens.color.neutral[name] = { $type: "color", $value: alias(hex(value)) };
  else if (name === "lightbox") tokens.color.lightbox.gradient = { $type: "gradient", $value: value.replace(/var\(--lightbox-(\d)\)/g, (_, n) => vars[`lightbox-${n}`]), $description: "Figma 변수로는 못 넣어요. Paint style(원형 그라데이션)로 만드세요." };
  else if (name.startsWith("lightbox-")) tokens.color.lightbox[name.replace("lightbox-", "")] = { $type: "color", $value: value };
  else if (name.startsWith("status-")) tokens.color.status[name.replace("status-", "")] = { $type: "color", $value: value };
  else if (name.startsWith("text-")) tokens.size.text[name.replace("text-", "")] = { $type: "dimension", $value: value };
  else if (name.startsWith("lh-")) tokens.size.lineHeight[name.replace("lh-", "")] = { $type: "number", $value: Number(value), $description: "글자 크기의 배수. Figma에서는 % (×100)로 넣으세요." };
  else if (name.startsWith("space-")) tokens.size.space[name.replace("space-", "")] = { $type: "dimension", $value: value };
  else if (name.startsWith("radius-")) tokens.size.radius[name.replace("radius-", "")] = { $type: "dimension", $value: value };
  else if (name.startsWith("control-")) tokens.size.control[name.replace("control-", "")] = { $type: "dimension", $value: value };
  else if (["content-max", "gutter", "topbar-h", "menu-w", "thing-image-h", "gap-hair", "chrome-x", "chrome-y", "chrome-reserve", "chrome-reserve-sm"].includes(name)) tokens.size.layout[name] = { $type: "dimension", $value: value };
  else if (name === "rail-w") {
    const [min, , max] = value.match(/clamp\(([^,]+),([^,]+),([^)]+)\)/).slice(1).map((s) => s.trim());
    tokens.size.layout["rail-min"] = { $type: "dimension", $value: min };
    tokens.size.layout["rail-max"] = { $type: "dimension", $value: max };
    notes.push(`오른쪽 레일 너비는 ${min}~${max}(창 너비의 26%)예요.`);
  } else if (name.startsWith("font-")) tokens.font[name.replace("font-", "")] = { $type: "fontFamily", $value: value.split(",").map((s) => s.trim().replace(/"/g, "")) };
  else if (name.startsWith("shadow-")) {
    const layers = value.split(/,(?![^(]*\))/).map((layer) => {
      const parts = layer.trim().split(" ");
      const at = parts.findIndex((part) => part.startsWith("rgb") || part.startsWith("#"));
      const [x, y, blur = "0", spread = "0"] = parts.slice(0, at);
      return { offsetX: x, offsetY: y, blur, spread, color: alias(hex(parts.slice(at).join(" "))) };
    });
    tokens.shadow[name.replace("shadow-", "")] = { $type: "shadow", $value: layers, $description: "Figma에서는 Effect style(그림자 2겹)로 만드세요." };
  } else if (name.startsWith("dur-")) tokens.motion[name] = { $type: "duration", $value: value };
  else if (name.startsWith("ease-")) tokens.motion[name] = { $type: "cubicBezier", $value: value.match(/cubic-bezier\(([^)]+)\)/)[1].split(",").map(Number) };
  else if (name === "z-toast") continue;
  else tokens.scene[name] = { $type: /^#[0-9a-f]{6}$/.test(value) ? "color" : "other", $value: value };
}

for (const m of palette.matchAll(/\{ label: "([^"]+)", color: "(#[0-9a-f]{6})", edge: "(#[0-9a-f]{6})",[^}]*?kinds: \[([^\]]*)\] \}/g)) {
  tokens.color.kind[m[1]] = {
    fill: { $type: "color", $value: m[2], $description: "화병 띠와 색 막대, 종이의 진한 면" },
    edge: { $type: "color", $value: m[3], $description: "판 위에서 3:1이 필요한 진한 색" },
    $description: `파일 형식: ${m[4].replace(/"/g, "")}`,
  };
}
tokens.color.box.fill = { $type: "color", $value: palette.match(/boxColor = "(#[0-9a-f]{6})"/)[1], $description: "정리 상자" };

const weights = { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 };
for (const [k, v] of Object.entries(weights)) tokens.fontWeight[k] = { $type: "fontWeight", $value: v };

// 디자인 시스템 문서의 쓰임새대로 묶은 Text style 목록입니다.
const textStyles = [
  ["Heading/2XL", "2xl", "2xl", "bold", "방 이름, 페이지 제목"],
  ["Heading/XL", "xl", "xl", "bold", "패널 제목"],
  ["Heading/LG", "lg", "lg", "bold", "섹션 제목, 대화창 제목"],
  ["Body/MD", "md", "md", "regular", "큰 본문"],
  ["Body/Base", "base", "base", "regular", "기본 본문"],
  ["Label/SM", "sm", "sm", "semibold", "버튼, 탭, 목록 제목"],
  ["Meta/XS", "xs", "xs", "medium", "보조 정보, 경로, 날짜"],
  ["Tag/2XS", "2xs", "2xs", "bold", "방 안 물건 이름표"],
];
for (const [name, size, lh, weight, use] of textStyles) {
  tokens.typography[name] = {
    $type: "typography",
    $value: { fontFamily: "{font.sans}", fontSize: `{size.text.${size}}`, lineHeight: `{size.lineHeight.${lh}}`, fontWeight: `{fontWeight.${weight}}` },
    $description: use,
  };
}

const out = join(root, "design");
await mkdir(out, { recursive: true });
await writeFile(join(out, "figma-tokens.json"), `${JSON.stringify(tokens, null, 2)}\n`);

// 사람이 보는 표
const rows = (obj, prefix) => Object.entries(obj).filter(([k]) => !k.startsWith("$")).map(([k, t]) => `| \`${prefix}${k}\` | \`${Array.isArray(t.$value) ? t.$value.join(", ") : typeof t.$value === "object" ? JSON.stringify(t.$value) : t.$value}\` | ${t.$description ?? ""} |`).join("\n");
const kindRows = Object.entries(tokens.color.kind).map(([label, t]) => `| ${label} | \`${t.fill.$value}\` | \`${t.edge.$value}\` | ${t.$description.replace("파일 형식: ", "")} |`).join("\n");
const md = `# Folduct 디자인 토큰 → Figma

\`src/styles.css\`와 \`src/art/palette.ts\`에서 자동으로 뽑은 값이에요(코드가 기준). 토큰을 바꾸면 \`node apps/room/scripts/export-figma-tokens.mjs\`로 다시 만드세요.

## 가져오는 방법
1. **Tokens Studio 플러그인**(무료): \`figma-tokens.json\`을 불러온 뒤 *Create variables*와 *Create styles*를 누르면 색·숫자는 Variables로, 글자·그림자는 Styles로 만들어져요.
2. 플러그인 없이 손으로: 아래 표대로 Variables 컬렉션 3개(Color, Size, Type)와 Text·Effect·Paint style을 만드세요.

| 종류 | Figma에서 | 컬렉션/스타일 |
| --- | --- | --- |
| 색(중립·라이트박스·상태·파일 형식) | Variables (color) | **Color** |
| 간격·모서리·글자 크기·줄 높이·레이아웃·컨트롤 높이 | Variables (number) | **Size** |
| 글꼴 | Variables (string) | **Type** |
| 글자 묶음 | Text styles | Heading/*, Body/*, Label/SM, Meta/XS, Tag/2XS |
| 그림자 | Effect styles | Shadow/1~3 |
| 라이트박스 그라데이션 | Paint style | Lightbox |
| 움직임(시간·곡선) | 변수로 못 넣어요 | Prototype 설정에 참고 |

## 규칙 (디자인 시스템 요약)
- 색은 **파일 형식**에만 써요. 상태(기울어짐·쓰러짐·용량 한도)는 판과 지도 위에서 잉크 + 굵은 글자로만, 패널·배너에서만 상태 색을 써요.
- 파일 오브제는 불투명한 종이예요. 비치거나 겹쳐 곱하지 않아요.
- \`ink-faint\`는 선·눈금 전용이고 글자에는 쓰지 않아요.
- 화면 크기 기준: 데스크톱 기본 창 1280×840, 최소 창 720×520, 휴대폰 375. 720보다 좁으면 한 줄로 쌓여요.
- 그레인은 코드(SVG 노이즈 4%)라 Figma에서는 비슷한 노이즈 레이어로만 흉내 내세요.

## 색 · 중립
| 토큰 | 값 | 설명 |
| --- | --- | --- |
${rows(tokens.color.neutral, "color/neutral/")}

## 색 · 라이트박스
| 토큰 | 값 | 설명 |
| --- | --- | --- |
${rows(tokens.color.lightbox, "color/lightbox/")}

## 색 · 상태 (패널·배너·글자 전용)
| 토큰 | 값 | 설명 |
| --- | --- | --- |
${rows(tokens.color.status, "color/status/")}

## 색 · 파일 형식
| 묶음 | 채움 (fill) | 테두리 (edge) | 형식 |
| --- | --- | --- | --- |
${kindRows}
| 정리 상자 | \`${tokens.color.box.fill.$value}\` | \`${tokens.color.box.fill.$value}\` | 상자 |

## 글자
| 토큰 | 값 | 설명 |
| --- | --- | --- |
${rows(tokens.font, "font/")}
${rows(tokens.fontWeight, "fontWeight/")}
${rows(tokens.size.text, "size/text/")}
${rows(tokens.size.lineHeight, "size/lineHeight/")}

### Text styles
| 이름 | 크기 | 줄 높이 | 굵기 | 쓰는 곳 |
| --- | --- | --- | --- | --- |
${textStyles.map(([name, size, lh, weight, use]) => `| ${name} | ${tokens.size.text[size].$value} | ${tokens.size.lineHeight[lh].$value} | ${weights[weight]} | ${use} |`).join("\n")}

## 간격 · 모서리 · 레이아웃
| 토큰 | 값 | 설명 |
| --- | --- | --- |
${rows(tokens.size.space, "size/space/")}
${rows(tokens.size.radius, "size/radius/")}
${rows(tokens.size.layout, "size/layout/")}
${rows(tokens.size.control, "size/control/")}

## 그림자
| 토큰 | 값 | 설명 |
| --- | --- | --- |
${rows(tokens.shadow, "shadow/")}

## 움직임
| 토큰 | 값 | 설명 |
| --- | --- | --- |
${rows(tokens.motion, "motion/")}

## 장면
집 화면 장면들이 쓰는 값이에요. 색은 \`color\`, 나머지는 \`other\`로 넣었어요.

| 토큰 | 값 | 설명 |
| --- | --- | --- |
${rows(tokens.scene, "scene/")}

${notes.length ? `## 참고\n${notes.map((n) => `- ${n}`).join("\n")}\n` : ""}`;
await writeFile(join(out, "figma-tokens.md"), md);
console.log(`색 ${Object.keys(tokens.color.neutral).length + Object.keys(tokens.color.lightbox).length + Object.keys(tokens.color.status).length}개 · 파일 형식 ${Object.keys(tokens.color.kind).length}묶음 · 글자 스타일 ${textStyles.length}개 → ${out}`);
