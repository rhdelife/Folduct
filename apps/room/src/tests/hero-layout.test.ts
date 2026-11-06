import { describe, expect, it } from "vitest";
import { dayMs, defaultCare, lastActivity } from "../domain/care";
import { heroLayout, moreHeight, namedPaper, paperWidth, type Card } from "../domain/heroLayout";
import type { Room, Thing } from "../domain/model";
import { baseView, calendarSpot, homeLimit, layoutRooms, roomRadius, stageUnit, toPx, vaseHalf, vaseUnit, type Box, type View } from "../domain/sky";
import { arrivalFrames, spillFrames } from "../components/home/heroMotion";

const start = Date.UTC(2026, 0, 5, 12);
const MB = 1024 * 1024;

function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 5 * MB, lastModified: 0, lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, pinned: false, box: null, ...patch };
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
const feetOf = (node: { at: { x: number; y: number }; r: number }, view: View) => toPx(node.at, view).y + vaseHalf(node.r) * stageUnit(view) * vaseUnit;

describe("첫 화면: 주름관 한 줄과 파일 칸", () => {
  it("같은 입력이면 늘 같은 자리다", () => {
    const rooms = many(3, 14);
    expect(heroLayout(rooms, start, baseView, aspect)).toEqual(heroLayout(rooms, start, baseView, aspect));
  });

  it("주름관은 받침 높이를 맞춰 왼쪽부터 한 줄로 서고, 폭이 모자라면 다음 줄로 내려간다", () => {
    const wide = heroLayout(many(homeLimit, 3), start, { w: 1920, h: 1080 }, aspect).nodes;
    const feet = wide.map((node) => feetOf(node, { w: 1920, h: 1080 }));
    for (const y of feet) expect(y).toBeCloseTo(feet[0], 3);
    for (let i = 1; i < wide.length; i += 1) expect(wide[i].at.x).toBeGreaterThan(wide[i - 1].at.x);
    const phone = heroLayout(many(3, 3), start, { w: 375, h: 812 }, aspect).nodes;
    expect(feetOf(phone[2], { w: 375, h: 812 })).toBeGreaterThan(feetOf(phone[0], { w: 375, h: 812 }));
  });

  it("종이는 기울지 않고, 서로·창 밖·일력과 겹치지 않으며, 자기 주름관 이름표 아래 칸 안에 있다", () => {
    for (const view of views) {
      for (const count of [1, 3, homeLimit]) {
        for (const doorOpen of [false, true]) {
          const { nodes, cards } = heroLayout(many(count, 30), start, view, aspect, doorOpen);
          const [calendar] = calendarSpot(view);
          const boxes = cards.map((card) => boxOf(card, view));
          cards.forEach((card, i) => {
            const label = `${view.w}x${view.h} 방${count} 현관${doorOpen}`;
            const box = boxes[i];
            expect(card.rot, label).toBe(0);
            expect(box.x - box.hw, label).toBeGreaterThanOrEqual(0);
            expect(box.x + box.hw, label).toBeLessThanOrEqual(view.w);
            expect(box.y + box.hh, label).toBeLessThanOrEqual(view.h);
            if (calendar) expect(overlap(box, calendar), label).toBe(false);
            const own = nodes.find((node) => node.room.id === card.room.id)!;
            expect(box.y - box.hh, label).toBeGreaterThan(feetOf(own, view));
            // 가장 가까운 주름관이 자기 방이에요.
            const nearest = [...nodes].sort((a, b) => Math.abs(toPx(a.at, view).x - box.x) - Math.abs(toPx(b.at, view).x - box.x) || Math.abs(feetOf(a, view) - box.y) - Math.abs(feetOf(b, view) - box.y))[0];
            if (nodes.every((node) => feetOf(node, view) === feetOf(nodes[0], view))) expect(nearest.room.id, label).toBe(card.room.id);
            boxes.slice(i + 1).forEach((other) => expect(overlap(box, other), label).toBe(false));
          });
        }
      }
    }
  });

  it("칸 안에서는 최근에 작업한 파일이 먼저 놓이고, 다 못 놓은 수는 \"+N개 더\"로 남는다", () => {
    for (const view of views) {
      const rooms = many(3, 40);
      const { cards, more } = heroLayout(rooms, start, view, aspect);
      for (const r of rooms) {
        const own = cards.filter((card) => card.room.id === r.id);
        const times = own.map((card) => lastActivity(card.thing));
        expect(times, `${view.w}x${view.h}`).toEqual([...times].sort((a, b) => b - a));
        const left = more.find((spot) => spot.room.id === r.id)?.count ?? 0;
        expect(own.length + left).toBe(r.things.length);
      }
      for (const spot of more) {
        const at = toPx(spot, view);
        expect(at.y + moreHeight / 2).toBeLessThanOrEqual(view.h);
      }
    }
  });

  it("몇 장 없는 방은 다 놓이고 \"+N개 더\"가 없다", () => {
    const { cards, more } = heroLayout(many(3, 4), start, baseView, aspect);
    expect(cards.length).toBe(12);
    expect(more).toEqual([]);
  });

  it("상자 속·없어진 파일은 놓지 않고, 홈에서 뺀 방과 자리를 넘은 방도 놓지 않는다", () => {
    const rooms = [
      room("a", [thing("ok"), thing("boxed", { box: { state: "boxed", fromPath: "x", boxPath: "y", at: start } as unknown as Thing["box"] }), thing("gone", { missing: true })]),
      room("done", [thing("d1")], { care: { ...defaultCare, done: true } }),
      ...many(homeLimit, 1),
    ];
    const { nodes, cards } = heroLayout(rooms, start, baseView, aspect);
    expect(nodes.map((node) => node.room.id)).not.toContain("done");
    expect(nodes.length).toBe(homeLimit);
    expect(cards.filter((card) => card.room.id === "a").map((card) => card.thing.id)).toEqual(["ok"]);
    expect(heroLayout([], start, baseView, aspect)).toEqual({ nodes: [], cards: [], more: [] });
  });

  it("큰 파일일수록 큰 종이이고, 넓은 창에서는 이름이 찍히는 크기다", () => {
    const { cards } = heroLayout([room("a", Array.from({ length: 6 }, (_, f) => thing(`f${f}`, { size: 1024 * 8 ** f })))], start, baseView, aspect);
    const bySize = [...cards].sort((a, b) => a.thing.size - b.thing.size);
    for (let i = 1; i < bySize.length; i += 1) expect(bySize[i].size).toBeGreaterThanOrEqual(bySize[i - 1].size);
    for (const card of cards) {
      expect(card.size).toBeGreaterThanOrEqual(namedPaper);
      expect(card.size).toBeLessThanOrEqual(paperWidth(card.thing.size, 1) + 0.5);
    }
  });
});

describe("일력 자리", () => {
  it("주름관은 일력 자리에 앉지 않는다", () => {
    for (const view of [{ w: 720, h: 640 }, { w: 720, h: 900 }, { w: 1280, h: 800 }]) {
      for (const count of [1, 3, 5, 7, 12]) {
        const [box] = calendarSpot(view);
        for (const { at, r } of heroLayout(many(count, 2), start, view, aspect).nodes) {
          const center = toPx(at, view);
          const half = vaseHalf(r) * stageUnit(view) * vaseUnit;
          expect(center.x - half >= box.x + box.hw || center.y + half <= box.y - box.hh).toBe(true);
        }
      }
    }
  });

  it("일력을 숨기는 창에서는 자리를 비우지 않는다", () => {
    expect(calendarSpot({ w: 375, h: 812 })).toEqual([]);
    expect(calendarSpot({ w: 720, h: 520 })).toEqual([]);
  });
});

describe("방 자리", () => {
  const spots = (count: number, view: View) => layoutRooms(many(count, 1), view).map((p) => ({ p, at: toPx(p.at, view) }));

  it("하나면 가운데, 둘이면 양옆이다", () => {
    for (const view of views) {
      expect(spots(1, view)[0].at.x).toBeCloseTo(view.w / 2, 0);
      const [a, b] = spots(2, view);
      expect(a.at.x).toBeLessThan(view.w / 2);
      expect(b.at.x).toBeGreaterThan(view.w / 2);
    }
  });

  it("방이 자리만큼 차도 주름관끼리 겹치지 않는다", () => {
    for (const view of views) {
      for (const count of [3, 4, homeLimit]) {
        const unit = stageUnit(view) * vaseUnit;
        const list = spots(count, view).map(({ p, at }) => ({ ...at, half: vaseHalf(roomRadius(p.room, p.scale)) * unit }));
        list.forEach((a, i) => {
          list.slice(i + 1).forEach((b) => expect(Math.abs(a.x - b.x) < a.half + b.half && Math.abs(a.y - b.y) < a.half + b.half, `${view.w} 방${count}`).toBe(false));
        });
      }
    }
  });
});

describe("등장 경로", () => {
  it("주름관은 왼쪽 아래 화면 밖에서 시작해 제자리에 똑바로 내려앉는다", () => {
    const rest = { x: 480, y: 440 };
    const frames = arrivalFrames(rest, 80, baseView, 1600);
    const [x, y] = String(frames[0].translate).split(" ").map(parseFloat);
    expect(rest.x + x).toBeLessThan(0);
    expect(rest.y + y).toBeGreaterThan(baseView.h);
    expect(frames[frames.length - 1].translate).toBe("0px 0px");
    expect(parseFloat(String(frames[frames.length - 1].rotate))).toBeCloseTo(0, 5);
  });

  it("자기 주름관 자리에서 나와 제자리에 앉는다", () => {
    const frames = spillFrames(100, 50, 10);
    expect(frames[0]).toMatchObject({ opacity: 0, translate: "100px 50px" });
    expect(frames[frames.length - 1]).toMatchObject({ opacity: 1, translate: "0px 0px", scale: "1", rotate: "0deg" });
  });
});
