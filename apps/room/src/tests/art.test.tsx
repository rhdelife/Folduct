/// <reference types="vite/client" />
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fitName, ObjectShape, paperArts, pickArt } from "../art/ObjectShape";
import { colorGroups, kindColors, kindEdges, kindTones, tonesFrom } from "../art/palette";
import paletteSource from "../art/palette.ts?raw";
import { kindLabels, type Kind } from "../domain/model";

const kinds = Object.keys(kindLabels) as Kind[];
const render = (props: Parameters<typeof ObjectShape>[0]) => renderToStaticMarkup(<ObjectShape {...props} />);

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const value = parseInt(hex.slice(at, at + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("종이 오브제", () => {
  it("글자는 어느 형식 바탕에서도 4.5:1 이상이에요", () => {
    for (const tone of Object.values(kindTones)) for (const field of [tone.soft, tone.pale]) expect(contrast(tone.ink, field)).toBeGreaterThanOrEqual(4.5);
  });

  it("형식마다 그림이 셋 이상이고, 찍힌 이름은 종이 위에서 4.5:1 이상이에요", () => {
    for (const kind of kinds) {
      expect(new Set(paperArts[kind].map((art) => art.id)).size, kind).toBeGreaterThanOrEqual(3);
      for (const art of paperArts[kind]) {
        const tones = kindTones[kind];
        expect(contrast(tones[art.slot.fill], tones[art.slot.on]), `${kind}/${art.id}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("seed가 같으면 늘 같은 그림이고, seed가 달라지면 그림도 고루 나뉘어요", () => {
    expect(render({ kind: "image", size: 96, name: "a.png", seed: "thing-1" })).toBe(render({ kind: "image", size: 96, name: "a.png", seed: "thing-1" }));
    expect(pickArt("image")).toBe(paperArts.image[0]);
    const seen = new Set(Array.from({ length: 60 }, (_, at) => pickArt("video", `thing-${at}`).id));
    expect(seen.size).toBe(paperArts.video.length);
  });

  it("이름은 기본 56 이상에서만 찍히고, 이름이 없거나 40보다 작으면 정사각형 칸에 그려요", () => {
    expect(render({ kind: "text", size: 96, name: "회의록.txt" })).toContain("회의록.txt");
    expect(render({ kind: "text", size: 48, name: "회의록.txt" })).not.toContain("<text");
    expect(render({ kind: "text", size: 48, name: "회의록.txt", nameFrom: 46 })).toContain("<text");
    for (const props of [{ size: 18 }, { size: 28, name: "a.txt" }, { size: 84 }]) {
      const svg = render({ kind: "archive", ...props });
      expect(svg).toContain(`width="${props.size}"`);
      expect(svg).toContain(`height="${props.size}"`);
      expect(svg).not.toContain("<text");
    }
  });

  it("어떤 그림이든 불투명 종이로만 그리고 className을 지켜요", () => {
    for (const kind of kinds) {
      for (const art of paperArts[kind]) {
        const seed = Array.from({ length: 200 }, (_, at) => `s${at}`).find((value) => pickArt(kind, value) === art);
        expect(seed, `${kind}/${art.id}`).toBeTruthy();
        const svg = render({ kind, seed, size: 96, name: "이름.png" });
        expect(svg).toContain('class="object"');
        expect(svg).toContain('aria-hidden="true"');
        expect(svg).not.toMatch(/opacity|mix-blend|NaN|undefined/i);
      }
    }
  });

  it("손그림 길은 펜이 읽는 절대 좌표 M·L·C·Z만 쓰고, 선이 잘리지 않게 종이 안쪽에 있어요", () => {
    for (const kind of kinds) {
      for (const art of paperArts[kind]) {
        const label = `${kind}/${art.id}`;
        expect(art.parts.some((part) => "pen" in part && !part.detail), `${label} 윤곽`).toBe(true);
        for (const part of art.parts) {
          expect(part.d, label).toMatch(/^M[MLCZ0-9.\s-]+$/);
          const numbers = part.d.match(/-?\d*\.?\d+/g)!.map(Number);
          for (let at = 0; at < numbers.length; at += 2) {
            expect(numbers[at], `${label} x`).toBeGreaterThanOrEqual(3);
            expect(numbers[at], `${label} x`).toBeLessThanOrEqual(art.w - 3);
            expect(numbers[at + 1], `${label} y`).toBeGreaterThanOrEqual(3);
            expect(numbers[at + 1], `${label} y`).toBeLessThanOrEqual(art.h - 3);
          }
          if ("pen" in part) expect(part.pen, label).toBeGreaterThan(0);
          if ("pen" in part) expect(part.pen, label).toBeLessThanOrEqual(2);
        }
        const { x, y, w, h } = art.slot;
        expect(x >= 0 && y >= 0 && x + w <= art.w && y + h <= art.h, `${label} 이름 칸`).toBe(true);
      }
    }
  });

  it("작게 그리면 잔선(detail)을 빼요", () => {
    const art = paperArts.text.find((item) => item.parts.some((part) => "pen" in part && part.detail))!;
    const seed = Array.from({ length: 200 }, (_, at) => `s${at}`).find((value) => pickArt("text", value) === art)!;
    const count = (svg: string) => (svg.match(/<path/g) ?? []).length;
    expect(count(render({ kind: "text", seed, size: 24 }))).toBeLessThan(count(render({ kind: "text", seed, size: 96, name: "a.md" })));
  });

  it("따로 준 색은 그 색으로 다섯 단을 만들어요", () => {
    const tones = tonesFrom("#5f6670");
    expect(tones.color).toBe("#5f6670");
    for (const key of ["pale", "soft", "edge", "ink"] as const) expect(tones[key]).toMatch(/^#[0-9a-f]{6}$/);
    expect(render({ kind: "archive", color: "#5f6670", size: 84 })).toContain("#5f6670");
    expect(render({ kind: "archive", color: "var(--ink)", size: 84 })).toContain("var(--ink)");
  });
});

describe("이름 맞추기", () => {
  it("넘치면 가운데를 줄이고 확장자를 남겨요", () => {
    const [line] = fitName("2026_봄_캠페인_기획서_최종.pdf", 7);
    expect(line).toContain("…");
    expect(line.endsWith("pdf")).toBe(true);
    expect(line.startsWith("20")).toBe(true);
    expect(fitName("짧은.txt", 20)).toEqual(["짧은.txt"]);
  });

  it("좁으면 확장자를 통째로 남기고 앞쪽을 더 담아요", () => {
    expect(fitName("여행_014.jpg", 4.2)).toEqual(["여행…jpg"]);
    // 확장자가 앞 두 글자와 함께 못 들어가면 앞만 남기고, 끝에 한 글자만 걸치지 않아요.
    expect(fitName("표지후보.psd", 3.6)).toEqual(["표지후…"]);
    expect(fitName("배경음악.mp3", 3)).toEqual(["배경…"]);
    expect(fitName("기획서.pdf", 3.6)).toEqual(["기획서…"]);
    expect(fitName("배경음악.mp3", 4.5)).toEqual(["배경…mp3"]);
    expect(fitName("2026_봄_캠페인_기획서_최종.pdf", 10)[0]).toMatch(/^2026_봄_캠페.*….*\.?pdf$/);
    // 말줄임표가 지운 글자만큼 폭을 먹는 경우는 자르지 않아요.
    expect(fitName("여행_014.jpg", 5.8)).toEqual(["여행_014.jpg"]);
  });

  it("여러 줄이면 구분자에서 끊고 확장자는 쪼개지 않아요", () => {
    expect(fitName("제주도 여행 사진 모음.jpg", 5.5, 3)).toEqual(["제주도 여행", "사진 모음", ".jpg"]);
    expect(fitName("봄_캠페인_기획서.pdf", 7, 2)).toEqual(["봄_캠페인_", "기획서.pdf"]);
  });

  it("풀어쓴 한글(NFD)을 모아서 자르고, 아주 좁아도 깨지지 않아요", () => {
    const nfd = "회의록 정리본 마지막.txt".normalize("NFD");
    const [line] = fitName(nfd, 6);
    expect(line).toBe(line.normalize("NFC"));
    expect(fitName("가나다라마바사", 0.5)[0]).toBe("…");
    expect(fitName("", 5)).toEqual([""]);
  });
});

describe("색 묶음", () => {
  it("토큰 내보내기 스크립트가 읽는 줄 모양을 지켜요", () => {
    const rows = [...paletteSource.matchAll(/\{ label: "([^"]+)", color: "(#[0-9a-f]{6})", edge: "(#[0-9a-f]{6})", kinds: \[([^\]]*)\] \}/g)];
    expect(rows.map((row) => row[1])).toEqual(colorGroups.map((group) => group.label));
  });


  it("형식 색·선 색·종이 단이 묶음에서 그대로 나와요", () => {
    for (const group of colorGroups) {
      for (const kind of group.kinds) {
        expect(kindColors[kind]).toBe(group.color);
        expect(kindEdges[kind]).toBe(group.edge);
        for (const tone of Object.values(kindTones[kind])) expect(tone).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
