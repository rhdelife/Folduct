import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableSummary } from "../components/home/TableSummary";
import { dayMs, defaultCare, localDay } from "../domain/care";
import type { Room, Thing } from "../domain/model";
import { roomActivity } from "../domain/sky";
import { counterAt, decodeAt, decodeEnd, folderOf, kindCounts, roomOrder, scramble } from "../domain/table";

const now = new Date(2026, 9, 20, 12).getTime();
function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 10, lastModified: now - 30 * dayMs, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, pinned: false, box: null, ...patch };
}
function room(id: string, things: Thing[], patch: Partial<Room> = {}): Room {
  return { id, name: id, createdAt: now - 40 * dayMs, source: "handle", rootName: id, scan: { complete: true, failed: 0, at: now, freedBytes: 0 }, things, workDays: [localDay(now)], care: defaultCare, budgetBytes: null, budgetNoticeAt: null, ...patch };
}

describe("방 순서", () => {
  it("최근에 쓴 방부터, 완료한 방은 뒤로 가요", () => {
    const old = room("old", [thing("o", { lastModified: now - 9 * dayMs })]);
    const fresh = room("fresh", [thing("f", { lastModified: now - dayMs })]);
    const done = room("done", [thing("d", { lastModified: now })], { care: { ...defaultCare, done: true } });
    const empty = room("empty", [], { createdAt: now - 2 * dayMs });
    expect(roomOrder([done, old, empty, fresh], now).map((item) => item.id)).toEqual(["fresh", "empty", "old", "done"]);
  });
});

describe("글자 풀림", () => {
  it("한글은 한글로, 라틴은 같은 대소문자로, 숫자는 숫자로 바뀌고 길이와 부호는 그대로예요", () => {
    const source = Array.from("여름 촬영_Final-02.mov");
    for (const seed of [1, 7, 40, 999]) {
      const out = Array.from(scramble(source, seed));
      expect(out).toHaveLength(source.length);
      out.forEach((char, index) => {
        const from = source[index];
        if (/[가-힣]/.test(from)) expect(char).toMatch(/[가-힣]/);
        else if (/[a-z]/.test(from)) expect(char).toMatch(/[a-z]/);
        else if (/[A-Z]/.test(from)) expect(char).toMatch(/[A-Z]/);
        else if (/[0-9]/.test(from)) expect(char).toMatch(/[0-9]/);
        else expect(char).toBe(from);
      });
    }
  });
  it("모음과 받침 있고 없음은 지켜 비슷한 글자로 보여요", () => {
    const vowel = (char: string) => Math.floor(((char.charCodeAt(0) - 0xac00) % 588) / 28);
    const hasTail = (char: string) => (char.charCodeAt(0) - 0xac00) % 28 > 0;
    const out = scramble(["사", "진"], 5);
    expect(vowel(out[0])).toBe(vowel("사"));
    expect(hasTail(out[0])).toBe(false);
    expect(hasTail(out[1])).toBe(true);
  });
  it("같은 pos는 언제나 같은 글자이고, 위 줄부터 왼쪽부터 풀려요", () => {
    const text = "프로젝트 기획안.pdf";
    expect(decodeAt(text, 2600, 1, 2)).toBe(decodeAt(text, 2600, 1, 2));
    expect(decodeAt(text, 2500, 0, 0)).not.toBe(text);
    expect(decodeAt(text, 2630, 0, 0).startsWith("프로젝트")).toBe(true);
    expect(decodeAt(text, 2750, 0, 0)).toBe(text);
    expect(decodeAt(text, 2750, 7, 0)).not.toBe(text);
    expect(decodeAt(text, decodeEnd, 7, 0)).toBe(text);
  });
  it("줄 수는 카드가 다 올라오기 전에 차요", () => {
    expect(counterAt(1700, 8)).toBe(0);
    expect(counterAt(1757, 8)).toBe(1);
    expect(counterAt(2225, 8)).toBe(8);
    expect(counterAt(3350, 3)).toBe(3);
  });
});

describe("요약", () => {
  it("형식별 수는 많은 순이고 사라진 파일은 세지 않아요", () => {
    const counts = kindCounts(room("r", [thing("a"), thing("b"), thing("c", { kind: "pdf" }), thing("d", { kind: "office" }), thing("e", { kind: "pdf" }), thing("g", { kind: "video", missing: true })]));
    expect(counts.map(({ label, count }) => [label, count])).toEqual([["PDF·문서·발표", 3], ["이미지", 2]]);
  });
  it("위치는 폴더만 적어요", () => {
    expect(folderOf("design/hero/a.png")).toBe("design/hero");
    expect(folderOf("a.png")).toBe("맨 위");
  });

  const summary = (r: Room) => renderToStaticMarkup(createElement(TableSummary, { room: r, now }));
  const eleven = (patch: Partial<Thing>) => Array.from({ length: 11 }, (_, index) => thing(`t${index}`, { lastModified: now - dayMs, ...patch }));

  it("0바이트 파일만 있어도 빈 방이라고 하지 않아요", () => {
    const html = summary(room("r", eleven({ size: 0 })));
    expect(html).not.toContain("아직 파일이 없어요");
    expect(html).toContain("모두 제자리에 있어요");
  });
  it("파일을 다 잃은 방은 '아직'이라 하지 않고, 쓴 것으로 세지도 않아요", () => {
    const lost = room("r", eleven({ missing: true }));
    expect(roomActivity(lost, now).every((day) => day.value === 0)).toBe(true);
    const html = summary(lost);
    expect(html).toContain("폴더에서 파일을 찾지 못했어요");
    expect(html).not.toContain("아직");
    expect(html).not.toContain("모두 제자리에");
  });
  it("정말 빈 방은 아직 없다고 해요", () => {
    expect(summary(room("r", []))).toContain("이 방에는 아직 파일이 없어요");
  });
  it("부분 스캔이 한도에 닿으면 %로 말하지 않아요", () => {
    const partial = { complete: false, failed: 0, at: now, freedBytes: 0 };
    expect(summary(room("r", [thing("a", { size: 140 })], { scan: partial, budgetBytes: 100 }))).toContain("한도를 넘었어요");
    const under = summary(room("r", [thing("a", { size: 50 })], { scan: partial, budgetBytes: 100 }));
    expect(under).toContain("50% 찼어요");
    expect(under).not.toContain("attention");
  });
});
