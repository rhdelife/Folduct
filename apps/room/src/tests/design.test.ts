/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { boxColor, kindEdges } from "../art/palette";
import { kindLabels, type Kind } from "../domain/model";

// :root 블록 하나에 모든 토큰이 있습니다. 첫 번째 :root { … } 를 잘라 --이름: 값 을 읽습니다.
// vitest는 CSS import를 빈 문자열로 바꿔서(css.include 기본값) 파일을 직접 읽습니다. @types/node가 없어 쓰는 함수 타입만 적습니다.
const { readFileSync } = (await import(/* @vite-ignore */ `node:${"fs"}`)) as { readFileSync: (path: URL, encoding: "utf8") => string };
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const rootStart = css.indexOf(":root {");
const rootEnd = css.indexOf("\n}", rootStart);
const rootBlock = css.slice(rootStart, rootEnd);
const tokens = Object.fromEntries([...rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 화면 코드가 style로 넣는 변수들. 소스에서 찾아 모읍니다.
const sources = Object.values(import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })) as string[];
const inlineVars = new Set(sources.flatMap((source) => [...source.matchAll(/["'`]--([\w-]+)["'`]/g)].map((match) => match[1])));

const hex = (name: string) => {
  const value = tokens[name];
  expect(value, `--${name}`).toMatch(/^#[0-9a-f]{6}$/i);
  return value;
};

// 물건이 놓이는 판의 가운데(-2)와 가장자리(-3), 그리고 페이지 바탕
const grounds = ["lightbox-2", "lightbox-3", "bg"];

describe("디자인 토큰", () => {
  it("본문·상태 글자는 패널, 라이트박스, 바탕, 자기 배경 위에서 4.5:1 이상이에요", () => {
    for (const name of ["ink", "ink-soft", "status-danger", "status-caution", "status-ok"]) {
      const own = tokens[`${name}-bg`] ? [`${name}-bg`] : [];
      for (const ground of ["surface", ...grounds, ...own]) {
        expect(contrast(hex(name), hex(ground)), `--${name} on --${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("모든 형식에 테두리 색이 있고, 상자와 함께 판 위에서 3:1 이상이에요", () => {
    for (const kind of Object.keys(kindLabels) as Kind[]) expect(kindEdges[kind], kind).toMatch(/^#[0-9a-f]{6}$/i);
    for (const [kind, edge] of [...Object.entries(kindEdges), ["box", boxColor]]) {
      for (const ground of grounds) expect(contrast(edge, hex(ground)), `${kind} edge on --${ground}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("상태 글자색은 파일 형식 색을 빌려 쓰지 않아요", () => {
    const status = ["status-danger", "status-caution", "status-ok"].map((name) => tokens[name].toLowerCase());
    for (const edge of Object.values(kindEdges)) expect(status).not.toContain(edge.toLowerCase());
  });

  it("styles.css는 :root 밖에서 #색을 쓰지 않고, 지운 토큰도 남아 있지 않아요", () => {
    const outside = (css.slice(0, rootStart) + css.slice(rootEnd)).replace(/url\("data:[^"]*"\)/g, "");
    expect(outside.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    for (const gone of ["tint", "ok", "near", "warn", "radius"]) expect(tokens[gone], `--${gone}`).toBeUndefined();
  });

  it("쓰는 변수는 모두 어딘가에서 정해요(:root나 규칙 안, 또는 화면이 style로 넣어요)", () => {
    const used = new Set([...css.matchAll(/var\(--([\w-]+)/g)].map((match) => match[1]));
    const defined = new Set([...css.matchAll(/(?:^|[\s;{])--([\w-]+)\s*:/g)].map((match) => match[1]));
    const missing = [...used].filter((name) => !(name in tokens) && !defined.has(name) && !inlineVars.has(name));
    expect(missing).toEqual([]);
  });
});
