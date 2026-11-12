import { describe, expect, it } from "vitest";
import { dayMs, defaultCare, lastActivity } from "../domain/care";
import { heroLayout, moreHeight, namedPaper, paperWidth, tagWidth, type Card } from "../domain/heroLayout";
import type { Room, Thing } from "../domain/model";
import { baseView, calendarSpot, homeLimit, toPx, type Box, type View } from "../domain/sky";
import { spillFrames } from "../components/home/heroMotion";

const start = Date.UTC(2026, 0, 5, 12);
const MB = 1024 * 1024;

function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 5 * MB, lastModified: 0, lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, seenAt: start, pinned: false, box: null, ...patch };
}
function room(id: string, things: Thing[], patch: Partial<Room> = {}): Room {
  return { id, name: id, createdAt: start, source: "handle", rootName: id, scan: { complete: true, failed: 0, at: start, freedBytes: 0 }, things, workDays: [], care: defaultCare, doneOfferAt: null, face: { shape: 0, color: 0 }, ...patch };
}
const many = (rooms: number, files: number) =>
  Array.from({ length: rooms }, (_, r) => room(`room-${r}`, Array.from({ length: files }, (_, f) => thing(`r${r}-f${f}`, { size: 1024 * 2 ** ((f * 7 + r * 3) % 20), touchedAt: start - ((f * 5 + r) % 17) * dayMs }))));
const aspect = () => 1.2;
const views: View[] = [{ w: 1280, h: 840 }, { w: 375, h: 812 }, { w: 720, h: 520 }, { w: 720, h: 900 }, { w: 1920, h: 1080 }, { w: 1280, h: 600 }, { w: 320, h: 568 }];

const boxOf = (card: Card, view: View): Box => {
  const at = toPx(card, view);
  return { x: at.x, y: at.y, hw: card.size / 2, hh: card.height / 2 };
};
const overlap = (a: Box, b: Box) => Math.abs(a.x - b.x) < a.hw + b.hw - 0.5 && Math.abs(a.y - b.y) < a.hh + b.hh - 0.5;
const big = (id: string, bytes: number) => room(id, [thing(`${id}-f`, { size: bytes })]);

describe("첫 화면: 프로도 한 명과 방 마디", () => {
  it("같은 입력이면 늘 같은 자리다", () => {
    const rooms = many(3, 14);
    expect(heroLayout(rooms, start, baseView, aspect, false, "room-1")).toEqual(heroLayout(rooms, start, baseView, aspect, false, "room-1"));
  });

  it("방 하나가 마디 하나이고, 첫 방이 머리 바로 아래에서 받침 쪽으로 차례로 쌓인다", () => {
    const rooms = many(homeLimit, 3);
    const { frodo } = heroLayout(rooms, start, baseView, aspect);
    expect(frodo!.segs.map((seg) => seg.room.id)).toEqual(rooms.map((r) => r.id));
    frodo!.segs.forEach((seg, i) => {
      expect(seg.bottom).toBeGreaterThan(seg.top);
      if (i > 0) expect(seg.top).toBeGreaterThanOrEqual(frodo!.segs[i - 1].bottom - 1);
    });
    expect(frodo!.mouth.y).toBeLessThan(frodo!.segs[0].top);
  });

  it("용량이 큰 방은 마디가 길고, 아무리 작은 방도 누를 만큼은 길다", () => {
    const { frodo } = heroLayout([big("small", 16), big("huge", 64 * 1024 * MB)], start, baseView, aspect);
    const [small, huge] = frodo!.segs.map((seg) => seg.bottom - seg.top);
    expect(huge).toBeGreaterThan(small * 1.5);
    // 320x568처럼 아주 작은 창은 빼요. 지켜야 할 폭은 375·720·1280이에요.
    for (const view of views.filter((v) => v.w >= 375)) {
      const seg = heroLayout(many(homeLimit, 2), start, view, aspect, true).frodo!.segs;
      for (const s of seg) expect(s.bottom - s.top, `${view.w}x${view.h}`).toBeGreaterThanOrEqual(24);
    }
  });

  it("프로도와 이름표는 창 안에 있고, 일력 위에 서지 않는다", () => {
    for (const view of views) {
      for (const count of [1, 3, homeLimit]) {
        for (const doorOpen of [false, true]) {
          const label = `${view.w}x${view.h} 방${count} 현관${doorOpen}`;
          const { frodo } = heroLayout(many(count, 2), start, view, aspect, doorOpen);
          expect(frodo!.left, label).toBeGreaterThanOrEqual(0);
          expect(frodo!.tagX + tagWidth(view), label).toBeLessThanOrEqual(view.w + 0.5);
          expect(frodo!.top, label).toBeGreaterThan(0);
          expect(frodo!.top + frodo!.height, label).toBeLessThanOrEqual(view.h);
          const [calendar] = calendarSpot(view);
          if (calendar) expect(frodo!.left, label).toBeGreaterThanOrEqual(calendar.x + calendar.hw);
        }
      }
    }
  });

  it("고른 방 파일만 놓이고, 기울지 않으며 서로·창 밖과 겹치지 않고, 프로도와도 겹치지 않는다", () => {
    for (const view of views) {
      for (const count of [1, 3, homeLimit]) {
        for (const doorOpen of [false, true]) {
          const rooms = many(count, 30);
          const picked = rooms[count - 1].id;
          const { frodo, cards } = heroLayout(rooms, start, view, aspect, doorOpen, picked);
          const body = { x: frodo!.left + frodo!.width / 2, y: frodo!.top + frodo!.height / 2, hw: frodo!.width / 2, hh: frodo!.height / 2 };
          const boxes = cards.map((card) => boxOf(card, view));
          cards.forEach((card, i) => {
            const label = `${view.w}x${view.h} 방${count} 현관${doorOpen}`;
            const box = boxes[i];
            expect(card.room.id, label).toBe(picked);
            expect(card.rot, label).toBe(0);
            expect(box.x - box.hw, label).toBeGreaterThanOrEqual(0);
            expect(box.y + box.hh, label).toBeLessThanOrEqual(view.h);
            expect(overlap(box, body), label).toBe(false);
            boxes.slice(i + 1).forEach((other) => expect(overlap(box, other), label).toBe(false));
          });
        }
      }
    }
    expect(heroLayout(many(3, 4), start, baseView, aspect).cards).toEqual([]);
  });

  it("칸 안에서는 최근에 작업한 파일이 먼저 놓이고, 다 못 놓은 수는 방 열기 단추에 남는다", () => {
    for (const view of views) {
      const rooms = many(3, 40);
      for (const r of rooms) {
        const { cards, more } = heroLayout(rooms, start, view, aspect, false, r.id);
        const times = cards.map((card) => lastActivity(card.thing));
        expect(times, `${view.w}x${view.h}`).toEqual([...times].sort((a, b) => b - a));
        expect(more).toHaveLength(1);
        expect(cards.length + more[0].count).toBe(r.things.length);
        expect(toPx(more[0], view).y + moreHeight / 2).toBeLessThanOrEqual(view.h);
      }
    }
  });

  it("몇 장 없는 방은 다 놓이고, 칸 아래에 남은 수 0인 방 열기 자리가 있다", () => {
    const { cards, more } = heroLayout(many(3, 4), start, baseView, aspect, false, "room-0");
    expect(cards.length).toBe(4);
    expect(more.map((spot) => spot.count)).toEqual([0]);
    expect(Math.max(...cards.map((card) => toPx(card, baseView).y))).toBeLessThan(toPx(more[0], baseView).y);
  });

  it("상자 속·없어진 파일은 놓지 않고, 홈에서 뺀 방과 자리를 넘은 방은 마디가 되지 않는다", () => {
    const rooms = [
      room("a", [thing("ok"), thing("boxed", { box: { state: "boxed", fromPath: "x", boxPath: "y", at: start } as unknown as Thing["box"] }), thing("gone", { missing: true })]),
      room("done", [thing("d1")], { care: { ...defaultCare, done: true } }),
      ...many(homeLimit, 1),
    ];
    const { frodo, cards } = heroLayout(rooms, start, baseView, aspect, false, "a");
    expect(frodo!.segs.map((seg) => seg.room.id)).not.toContain("done");
    expect(frodo!.segs.length).toBe(homeLimit);
    expect(cards.map((card) => card.thing.id)).toEqual(["ok"]);
    expect(heroLayout([], start, baseView, aspect)).toEqual({ frodo: null, cards: [], more: [] });
  });

  it("큰 파일일수록 큰 종이이고, 넓은 창에서는 이름이 찍히는 크기다", () => {
    const { cards } = heroLayout([room("a", Array.from({ length: 6 }, (_, f) => thing(`f${f}`, { size: 1024 * 8 ** f })))], start, baseView, aspect, false, "a");
    const bySize = [...cards].sort((a, b) => a.thing.size - b.thing.size);
    for (let i = 1; i < bySize.length; i += 1) expect(bySize[i].size).toBeGreaterThanOrEqual(bySize[i - 1].size);
    for (const card of cards) {
      expect(card.size).toBeGreaterThanOrEqual(namedPaper);
      expect(card.size).toBeLessThanOrEqual(paperWidth(card.thing.size, 1) + 0.5);
    }
  });
});

describe("일력 자리", () => {
  it("일력을 숨기는 창에서는 자리를 비우지 않는다", () => {
    expect(calendarSpot({ w: 375, h: 812 })).toEqual([]);
    expect(calendarSpot({ w: 720, h: 520 })).toEqual([]);
  });
});

describe("등장 경로", () => {
  it("프로도 입에서 나와 제자리에 앉는다", () => {
    const frames = spillFrames(100, 50, 10);
    expect(frames[0]).toMatchObject({ opacity: 0, translate: "100px 50px" });
    expect(frames[frames.length - 1]).toMatchObject({ opacity: 1, translate: "0px 0px", scale: "1", rotate: "0deg" });
  });
});
