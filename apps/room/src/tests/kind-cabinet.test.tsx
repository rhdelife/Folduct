import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KindShelf } from "../components/home/KindShelf";
import type { Room, Thing } from "../domain/model";

const thing = (path: string, over: Partial<Thing> = {}): Thing => ({ id: path, path, name: path.split("/").pop()!, kind: "image", size: 10, lastModified: 1, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...over });
const rooms = [{ id: "a", name: "a", things: [thing("a/1.png"), thing("a/2.png"), thing("a/r.pdf", { kind: "pdf" })], care: { done: false, staleAfterDays: 14 } }] as unknown as Room[];

describe("형식별 서랍(폴더 탭)", () => {
  it("형식마다 탭 하나, 처음엔 첫 탭만 골라져 탭 키로 들어갈 수 있고 그 폴더만 그려요", () => {
    const html = renderToStaticMarkup(<KindShelf rooms={rooms} onOpenFile={() => {}} />);
    const tabs = [...html.matchAll(/role="tab" id="([^"]+)"[^>]*aria-selected="(\w+)" aria-controls="([^"]+)" tabindex="(-?\d)"/g)];
    expect(tabs.map((tab) => [tab[2], tab[4]])).toEqual([["true", "0"], ["false", "-1"]]);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(html).toContain(`id="${tabs[0][3]}" class="kind-folder" role="tabpanel" aria-labelledby="${tabs[0][1]}"`);
    expect(html.match(/class="shelf-paper"/g)).toHaveLength(2);
  });
});
