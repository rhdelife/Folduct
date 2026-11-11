import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KindShelf } from "../components/home/KindShelf";
import type { Room, Thing } from "../domain/model";

const thing = (path: string, over: Partial<Thing> = {}): Thing => ({ id: path, path, name: path.split("/").pop()!, kind: "image", size: 10, lastModified: 1, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...over });
const rooms = [{ id: "a", name: "a", things: [thing("a/1.png"), thing("a/2.png"), thing("a/r.pdf", { kind: "pdf" })], care: { done: false, staleAfterDays: 14 } }] as unknown as Room[];

describe("형식별 서랍장", () => {
  it("형식마다 서랍 하나, 처음엔 모두 닫혀 있고 목록 종이는 비어 있어 탭으로 들어갈 수 없어요", () => {
    const html = renderToStaticMarkup(<KindShelf rooms={rooms} onOpenFile={() => {}} />);
    const fronts = [...html.matchAll(/class="kind-drawer-front" aria-expanded="(\w+)" aria-controls="([^"]+)"/g)];
    expect(fronts.map((front) => front[1])).toEqual(["false", "false"]);
    expect(html).toContain(`id="${fronts[0][2]}" class="kind-slip" role="region"`);
    expect(html).toMatch(/class="kind-slip"[^>]*inert=""/);
    expect(html).not.toContain("shelf-paper");
    // 서랍 속에는 그 형식 종이가 몇 장 들어 있어요(이미지 2장, PDF 1장).
    expect(html.match(/class="kind-drawer-sheet"/g)).toHaveLength(3);
  });
});
