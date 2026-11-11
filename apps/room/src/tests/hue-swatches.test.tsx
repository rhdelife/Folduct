import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HueSwatches } from "../components/HueSwatches";
import { hues, type Hue } from "../domain/hue";

const render = (value: Hue | "", found: Map<string, Hue | null>, total: number) => renderToStaticMarkup(<HueSwatches value={value} found={found} total={total} onReach={() => {}} onPick={() => {}} />);
const swatch = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

describe("색 네모 줄", () => {
  it("색마다 실제 색을 칠한 네모 단추 하나, 읽기 전에는 이름만 있고 흐린 네모가 없어요", () => {
    const html = render("", new Map(), 3);
    expect(html.match(/class="room-hue-swatch"/g)).toHaveLength(hues.length);
    expect(html).toContain("--swatch:var(--hue-red)");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain("room-hue-read");
  });

  it("읽는 동안은 없는 색을 흐리지 않고 진행 선을 보여요", () => {
    const html = render("", new Map([["a", "빨강"]]), 2);
    expect(swatch(html, "파랑 0개")).toContain('aria-disabled="false"');
    expect(html).toContain("--read:0.5");
  });

  it("다 읽으면 없는 색은 흐리지만 고른 색은 비어 있어도 풀 수 있어요", () => {
    const html = render("파랑", new Map<string, Hue | null>([["a", "빨강"], ["b", null]]), 2);
    expect(swatch(html, "빨강 1개")).toContain('aria-disabled="false"');
    expect(swatch(html, "초록 0개")).toContain('aria-disabled="true"');
    expect(swatch(html, "파랑 0개")).toContain('aria-disabled="false"');
    expect(swatch(html, "파랑 0개")).toContain('aria-pressed="true"');
    expect(html).not.toContain("room-hue-read");
  });
});
