import { describe, expect, it } from "vitest";
import { dayMs, defaultCare, lastActivity } from "../domain/care";
import { fedThings, findHeight, heroLayout, namedPaper, paperWidth, type Card } from "../domain/heroLayout";
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

describe("첫 화면: 위 방 카드 줄과 먹이면 늘어나는 프로도", () => {
  it("같은 입력이면 늘 같은 자리다", () => {
    const rooms = many(3, 14);
    expect(heroLayout(rooms, start, baseView, aspect, false, "room-1")).toEqual(heroLayout(rooms, start, baseView, aspect, false, "room-1"));
  });

  it("방은 위 카드 줄에 차례로 놓이고, 프로도는 그 아래 받침 위에 선다", () => {
    for (const view of views) {
      for (const doorOpen of [false, true]) {
        const rooms = many(homeLimit, 3);
        const { shelf, rooms: shelfRooms, frodo } = heroLayout(rooms, start, view, aspect, doorOpen);
        const label = `${view.w}x${view.h} 현관${doorOpen}`;
        expect(shelfRooms.map((r) => r.id), label).toEqual(rooms.map((r) => r.id));
        expect(frodo!.top, label).toBeGreaterThan(shelf!.top + shelf!.height);
        expect(frodo!.top + frodo!.height, label).toBeCloseTo(frodo!.floor, 5);
      }
    }
  });

  it("먹이면 그 방 용량만큼 늘어나고, 큰 방일수록 길다. 크기·좌우 자리는 그대로고, 넓은 창에서는 프로도가 늘 빈자리 가운데에 있다", () => {
    const rooms = [big("small", 16), big("mid", 512 * MB), big("huge", 64 * 1024 * MB)];
    for (const view of views.filter((v) => v.w >= 375)) {
      const label = `${view.w}x${view.h}`;
      const hungry = heroLayout(rooms, start, view, aspect).frodo!;
      const [small, mid, huge] = rooms.map((r) => heroLayout(rooms, start, view, aspect, false, r.id).frodo!);
      expect(small.height, label).toBeGreaterThan(hungry.height);
      expect(mid.height, label).toBeGreaterThan(small.height);
      expect(huge.height, label).toBeGreaterThan(mid.height);
      for (const fed of [small, mid, huge]) {
        expect(fed.scale, label).toBe(hungry.scale);
        expect(fed.left, label).toBe(hungry.left);
        if (view.w >= 1000) expect(fed.top + fed.floor, label).toBeCloseTo(hungry.top + hungry.floor, 5);
        expect(fed.mouth.y, label).toBeLessThan(fed.floor);
      }
    }
  });

  it("가장 크게 자란 프로도도 창 안에 있고, 일력 위에 서지 않는다", () => {
    for (const view of views) {
      for (const count of [1, 3, homeLimit]) {
        for (const doorOpen of [false, true]) {
          const label = `${view.w}x${view.h} 방${count} 현관${doorOpen}`;
          const rooms = [big("huge", 512 * 1024 * MB), ...many(count - 1, 2)];
          const { frodo } = heroLayout(rooms, start, view, aspect, doorOpen, "huge");
          expect(frodo!.left, label).toBeGreaterThanOrEqual(0);
          expect(frodo!.left + frodo!.width, label).toBeLessThanOrEqual(view.w + 0.5);
          expect(frodo!.top, label).toBeGreaterThan(0);
          expect(frodo!.floor, label).toBeLessThanOrEqual(view.h);
          const [calendar] = calendarSpot(view);
          const body = { x: frodo!.left + frodo!.width / 2, y: (frodo!.top + frodo!.floor) / 2, hw: frodo!.width / 2, hh: (frodo!.floor - frodo!.top) / 2 };
          if (calendar) expect(overlap(body, calendar), label).toBe(false);
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
            expect(box.x + box.hw, label).toBeLessThanOrEqual(view.w + 0.5);
            expect(box.y + box.hh, label).toBeLessThanOrEqual(view.h);
            expect(overlap(box, body), label).toBe(false);
            boxes.slice(i + 1).forEach((other) => expect(overlap(box, other), label).toBe(false));
          });
        }
      }
    }
    expect(heroLayout(many(3, 4), start, baseView, aspect).cards).toEqual([]);
  });

  it("칸 안에서는 최근에 작업한 파일이 먼저 놓이고, 맨 위 찾기 줄에 맞는 파일 수가 있으며 칸을 넘지 않는다", () => {
    for (const view of views) {
      const rooms = many(3, 40);
      for (const r of rooms) {
        const { cards, find } = heroLayout(rooms, start, view, aspect, false, r.id);
        const times = cards.map((card) => lastActivity(card.thing));
        expect(times, `${view.w}x${view.h}`).toEqual([...times].sort((a, b) => b - a));
        expect(find!.found).toBe(r.things.length);
        expect(cards.length).toBeLessThanOrEqual(find!.found);
        for (const card of cards) {
          expect(toPx(card, view).y - card.height / 2, `${view.w}x${view.h}`).toBeGreaterThanOrEqual(find!.top + findHeight);
          expect(toPx(card, view).y + card.height / 2).toBeLessThanOrEqual(view.h);
        }
      }
    }
  });

  it("몇 장 없는 방은 다 놓이고, 아무것도 안 먹었으면 찾기 줄이 없다", () => {
    const { cards, find } = heroLayout(many(3, 4), start, baseView, aspect, false, "room-0");
    expect(cards.length).toBe(4);
    expect(find!.found).toBe(4);
    expect(heroLayout(many(3, 4), start, baseView, aspect).find).toBeNull();
  });

  it("찾는 말·형식에 맞는 파일만 놓고, 이름에 맞은 파일이 폴더로만 맞은 파일보다 먼저다", () => {
    const r = room("a", [
      thing("a1", { name: "cover.png", path: "report/cover.png" }),
      thing("a2", { name: "report-final.pdf", path: "report-final.pdf", kind: "pdf" }),
      thing("a3", { name: "notes.md", path: "notes.md", kind: "text" }),
    ]);
    expect(fedThings(r, { query: "report", kinds: null }).map((t) => t.id)).toEqual(["a2", "a1"]);
    expect(fedThings(r, { query: "", kinds: ["text"] }).map((t) => t.id)).toEqual(["a3"]);
    const { cards, find } = heroLayout([r], start, baseView, aspect, false, "a", { query: "report", kinds: ["image"] });
    expect(cards.map((card) => card.thing.id)).toEqual(["a1"]);
    expect(find!.found).toBe(1);
    expect(heroLayout([r], start, baseView, aspect, false, "a", { query: "zzz", kinds: null }).find!.found).toBe(0);
  });

  it("찾지 않을 때는 자동 생성 폴더 더미와 옛 버전이 사람이 찾는 파일 뒤로 간다", () => {
    const r = room("a", [
      thing("tmp", { name: "page-001.png", path: "tmp/pdfs/rt/page-001.png", touchedAt: start }),
      thing("old", { name: "plan.pdf", path: "plan.pdf", kind: "pdf", lastModified: start - 3 * dayMs, touchedAt: start - dayMs }),
      thing("new", { name: "plan_최종.pdf", path: "plan_최종.pdf", kind: "pdf", lastModified: start - dayMs, touchedAt: start - 2 * dayMs }),
      thing("doc", { name: "brief.md", path: "brief.md", kind: "text", touchedAt: start - 5 * dayMs }),
    ]);
    const order = fedThings(r, { query: "", kinds: null }).map((t) => t.id);
    expect(order.slice(0, 2).sort()).toEqual(["doc", "new"]);
    expect(order.slice(2).sort()).toEqual(["old", "tmp"]);
  });

  it("상자 속·없어진 파일은 놓지 않고, 홈에서 뺀 방과 자리를 넘은 방은 카드 줄에 놓지 않는다", () => {
    const rooms = [
      room("a", [thing("ok"), thing("boxed", { box: { state: "boxed", fromPath: "x", boxPath: "y", at: start } as unknown as Thing["box"] }), thing("gone", { missing: true })]),
      room("done", [thing("d1")], { care: { ...defaultCare, done: true } }),
      ...many(homeLimit, 1),
    ];
    const { rooms: shelfRooms, cards } = heroLayout(rooms, start, baseView, aspect, false, "a");
    expect(shelfRooms.map((r) => r.id)).not.toContain("done");
    expect(shelfRooms.length).toBe(homeLimit);
    expect(cards.map((card) => card.thing.id)).toEqual(["ok"]);
    expect(heroLayout([], start, baseView, aspect)).toEqual({ shelf: null, rooms: [], frodo: null, cards: [], find: null });
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
