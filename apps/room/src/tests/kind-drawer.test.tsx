import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Drawer, KindShelf } from "../components/home/KindShelf";
import type { Room, Thing } from "../domain/model";
import { kindShelves } from "../domain/shelves";

const thing = (path: string, over: Partial<Thing> = {}): Thing => ({ id: path, path, name: path.split("/").pop()!, kind: "image", size: 10, lastModified: 1, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...over });
const rooms = [{ id: "a", name: "a", things: [thing("a/1.png"), thing("a/r.pdf", { kind: "pdf" })], care: { done: false, staleAfterDays: 14 } }] as unknown as Room[];
const noop = () => {};

describe("형식별 서랍", () => {
  it("처음엔 모든 서랍이 닫혀 있고, 앞판이 자기 몸을 가리켜요. 닫힌 서랍엔 종이를 그리지 않아요", () => {
    const html = renderToStaticMarkup(<KindShelf rooms={rooms} onOpenFile={noop} />);
    const fronts = [...html.matchAll(/aria-expanded="(\w+)" aria-controls="([^"]+)"/g)];
    expect(fronts.map((front) => front[1])).toEqual(["false", "false"]);
    for (const front of fronts) expect(html).toContain(`id="${front[2]}"`);
    expect(html).not.toContain("shelf-paper");
    expect(html.match(/inert=""/g)).toHaveLength(2);
  });

  it("열린 서랍은 aria-expanded 가 true 이고 그 형식의 종이를 보여요", () => {
    const [shelf] = kindShelves(rooms, [{ label: "이미지", kinds: ["image"] }]);
    const html = renderToStaticMarkup(<Drawer shelf={shelf} open onToggle={noop} onClose={noop} folders={new Map()} onOpenFile={noop} />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("inert");
    expect(html.match(/class="shelf-paper"/g)).toHaveLength(1);
  });
});
