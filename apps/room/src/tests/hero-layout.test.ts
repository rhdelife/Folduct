import { describe, expect, it } from "vitest";
import { dayMs, defaultCare, localDay } from "../domain/care";
import { cardCap, flightsFor, heroLayout, keepOut, namedPaper, notebookGuide, paperWidth, type Card } from "../domain/heroLayout";
import type { Room, Thing } from "../domain/model";
import { baseView, layoutRooms, roomRadius, stageUnit, toPx, vaseHalf, vaseUnit, type Box, type View } from "../domain/sky";
import { arrivalFrames, spillFrames, cardPose, cardsGone, exitFrames } from "../components/home/heroMotion";

const start = Date.UTC(2026, 0, 5, 12);
const MB = 1024 * 1024;

function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 5 * MB, lastModified: 0, lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, pinned: false, box: null, ...patch };
}
function room(id: string, things: Thing[], patch: Partial<Room> = {}): Room {
  return { id, name: id, createdAt: start, source: "handle", rootName: id, scan: { complete: true, failed: 0, at: start, freedBytes: 0 }, things, workDays: [], care: defaultCare, budgetBytes: null, budgetNoticeAt: null, ...patch };
}
const many = (rooms: number, files: number) =>
  Array.from({ length: rooms }, (_, r) => room(`room-${r}`, Array.from({ length: files }, (_, f) => thing(`r${r}-f${f}`, { size: 1024 * 2 ** ((f * 7 + r * 3) % 20) }))));
const aspect = () => 1.2;
const views: View[] = [{ w: 1280, h: 840 }, { w: 375, h: 812 }, { w: 720, h: 520 }, { w: 1920, h: 1080 }, { w: 1280, h: 600 }, { w: 320, h: 568 }];

const boxOf = (card: Card, view: View): Box => {
  const at = toPx(card, view);
  const angle = (card.rot * Math.PI) / 180;
  return { x: at.x, y: at.y, hw: (Math.abs(Math.cos(angle)) * card.size + Math.abs(Math.sin(angle)) * card.height) / 2, hh: (Math.abs(Math.sin(angle)) * card.size + Math.abs(Math.cos(angle)) * card.height) / 2 };
};
const overlap = (a: Box, b: Box) => Math.abs(a.x - b.x) < a.hw + b.hw - 0.5 && Math.abs(a.y - b.y) < a.hh + b.hh - 0.5;

describe("첫 화면 종이 배치", () => {
  it("같은 입력이면 늘 같은 자리다", () => {
    const rooms = many(3, 14);
    expect(heroLayout(rooms, start, baseView, aspect).cards.map((c) => [c.x, c.y])).toEqual(heroLayout(rooms, start, baseView, aspect).cards.map((c) => [c.x, c.y]));
  });

  it("종이끼리, 머리글·화병·이름표·머리 버튼과 겹치지 않는다", () => {
    for (const view of views) {
      for (const [roomCount, files] of [[1, 30], [2, 20], [3, 14], [12, 6], [30, 3]]) {
        const { nodes, cards } = heroLayout(many(roomCount, files), start, view, aspect);
        const boxes = cards.map((card) => boxOf(card, view));
        const fixed = keepOut(nodes, view);
        boxes.forEach((a, i) => {
          for (const box of fixed) expect(overlap(a, box), `${view.w}x${view.h} 방${roomCount} 종이${i}와 고정`).toBe(false);
          boxes.slice(i + 1).forEach((b, j) => expect(overlap(a, b), `${view.w}x${view.h} 방${roomCount} 종이${i},${i + j + 1}`).toBe(false));
        });
      }
    }
  });

  it("판 전체에 퍼진다: 네 귀퉁이 칸마다 종이가 있다", () => {
    const { cards } = heroLayout(many(3, 14), start, baseView, aspect);
    const corners = [0, 1, 2, 3].map((q) => cards.filter((c) => (c.x < 500 ? 0 : 1) + (c.y < 340 ? 0 : 2) === q).length);
    for (const count of corners) expect(count).toBeGreaterThan(1);
  });

  it("판에 뜨는 종이는 약 24장이고, 고른 방만 제 파일을 한도까지 더 보인다", () => {
    const rooms = many(4, 40);
    const base = heroLayout(rooms, start, baseView, aspect);
    expect(base.cards.length).toBe(cardCap);
    // 방마다 고르게 뽑습니다.
    for (const r of rooms) expect(base.cards.filter((c) => c.room.id === r.id).length).toBeGreaterThanOrEqual(6);
    const picked = heroLayout(rooms, start, baseView, aspect, "room-2");
    expect(picked.cards.filter((c) => c.room.id === "room-2").length).toBe(40);
    // 고른다고 원래 종이가 움직이지 않습니다.
    const before = new Map(base.cards.map((c) => [c.thing.id, [c.x, c.y]]));
    for (const c of picked.cards.filter((card) => !card.extra)) expect([c.x, c.y]).toEqual(before.get(c.thing.id));
  });

  it("방이 판의 장수보다 많아도 방마다 종이가 뜬다", () => {
    const { cards } = heroLayout(many(cardCap + 6, 3), start, baseView, aspect);
    expect(new Set(cards.map((c) => c.room.id)).size).toBe(cardCap + 6);
  });

  it("몇 장 없는 방은 큰 종이도 판 안에 다 들어온다", () => {
    const { cards } = heroLayout([room("a", Array.from({ length: 10 }, (_, f) => thing(`f${f}`, { size: 1024 * 4 ** f })))], start, baseView, aspect);
    for (const card of cards) {
      const b = boxOf(card, baseView);
      expect(b.x - b.hw).toBeGreaterThanOrEqual(0);
      expect(b.x + b.hw).toBeLessThanOrEqual(baseView.w);
      expect(b.y - b.hh).toBeGreaterThanOrEqual(0);
      expect(b.y + b.hh).toBeLessThanOrEqual(baseView.h);
    }
  });

  it("작은 창에서도 대부분의 종이가 이름이 찍히는 크기다", () => {
    for (const view of [{ w: 720, h: 520 }, { w: 720, h: 840 }]) {
      const { cards } = heroLayout(many(3, 14), start, view, aspect);
      expect(cards.length).toBe(cardCap);
      expect(cards.filter((card) => card.size >= namedPaper).length, `${view.w}x${view.h}`).toBeGreaterThan(cards.length * 0.7);
    }
    const { cards } = heroLayout(many(3, 14), start, { w: 375, h: 812 }, aspect);
    expect(cards.some((card) => card.size >= namedPaper)).toBe(true);
  });

  it("큰 파일일수록 큰 종이이고, 1280에서 56에서 96px 사이다", () => {
    expect(paperWidth(1024, 1)).toBe(56);
    expect(paperWidth(1024 * 1024 * 1024, 1)).toBe(96);
    expect(paperWidth(10 * MB, 1)).toBeGreaterThan(paperWidth(MB, 1));
    const { cards } = heroLayout(many(1, 20), start, baseView, aspect);
    const sorted = [...cards].sort((a, b) => a.thing.size - b.thing.size);
    sorted.slice(1).forEach((card, i) => expect(card.size).toBeGreaterThanOrEqual(sorted[i].size));
  });

  it("오래 손대지 않은 파일은 방에서 더 멀고, 쓰러진 파일은 눕는다", () => {
    const now = start + 8 * dayMs;
    const workDays = [localDay(start + dayMs)];
    const files = Array.from({ length: 16 }, (_, i) => thing(`f${i}`, i % 2 ? { touchedAt: now } : {}));
    const { nodes, cards } = heroLayout([room("a", files, { workDays })], now, baseView, aspect);
    const center = toPx(nodes[0].at, baseView);
    const far = (stage: string) => {
      const list = cards.filter((c) => c.stage === stage).map((c) => {
        const at = toPx(c, baseView);
        return Math.hypot(at.x - center.x, at.y - center.y);
      });
      return list.reduce((sum, d) => sum + d, 0) / list.length;
    };
    expect(cards.some((c) => c.stage === "fallen")).toBe(true);
    expect(far("fallen")).toBeGreaterThan(far("normal"));
    for (const c of cards) if (c.stage === "fallen") expect(Math.abs(c.rot)).toBeGreaterThan(29);
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

  it("방이 많아도 화병끼리 겹치지 않는다", () => {
    for (const view of views) {
      for (const count of [3, 8, 12, 30]) {
        const unit = stageUnit(view) * vaseUnit;
        const list = spots(count, view).map(({ p, at }) => ({ ...at, half: vaseHalf(roomRadius(p.room, p.scale)) * unit }));
        list.forEach((a, i) => {
          list.slice(i + 1).forEach((b) => expect(Math.abs(a.x - b.x) < a.half + b.half && Math.abs(a.y - b.y) < a.half + b.half, `${view.w} 방${count}`).toBe(false));
        });
      }
    }
  });
});

describe("첫 스크롤", () => {
  const { cards } = heroLayout(many(3, 14), start, baseView, aspect);
  const flights = flightsFor(cards, baseView);

  it("띠의 자리는 쉬는 자리의 x 순서라 길이 엇갈리지 않는다", () => {
    const list = [...flights.values()].sort((a, b) => a.slot - b.slot);
    list.slice(1).forEach((flight, i) => {
      expect(flight.rest.x).toBeGreaterThanOrEqual(list[i].rest.x);
      expect(flight.belt.x).toBeGreaterThan(list[i].belt.x);
    });
    for (const { belt } of list) expect(belt.y).toBeCloseTo(70, 0);
    expect(list[list.length - 1].belt.x - list[0].belt.x).toBeLessThanOrEqual(0.693 * baseView.w + 0.01);
  });

  it("pos만의 함수라 되감으면 그대로 돌아오고, 맨 위에서는 움직이지 않는다", () => {
    const [id, flight] = [...flights.entries()][0];
    const rest = cards.find((c) => c.thing.id === id)!.rot;
    expect(cardPose(0, flight, cards.length, rest, id)).toEqual({ x: 0, y: 0, rot: 0, scale: 1, opacity: 1 });
    expect(cardPose(500, flight, cards.length, rest, id)).toEqual(cardPose(500, flight, cards.length, rest, id));
    // 400 근처면 띠에 앉아 있습니다.
    const onBelt = cardPose(450, flight, cards.length, rest, id);
    expect(flight.rest.x + onBelt.x).toBeCloseTo(flight.belt.x, 3);
    expect(flight.rest.y + onBelt.y).toBeCloseTo(flight.belt.y, 3);
    expect(onBelt.scale).toBeCloseTo(flight.belt.scale, 3);
    // 떨어져 사라집니다.
    const landed = cardPose(1000, flight, cards.length, rest, id);
    expect(flight.rest.x + landed.x).toBeCloseTo(flight.land.x, 3);
    expect(cardPose(cardsGone, flight, cards.length, rest, id).opacity).toBe(0);
  });

  it("공책 칸 글자 아래로 떨어진다", () => {
    const { anchors } = notebookGuide(baseView);
    expect(anchors[0].x).toBeCloseTo(344.3, 0);
    expect(anchors[0].y).toBeCloseTo(225.5, 0);
    expect(anchors[1].y).toBeCloseTo(547.2, 0);
    for (const { land, section } of flights.values()) {
      expect(land.x).toBeGreaterThanOrEqual(anchors[section].x);
      expect(Math.abs(land.y - anchors[section].y - 18.5)).toBeLessThanOrEqual(10.01);
    }
  });
});

describe("등장 경로", () => {
  it("화병은 왼쪽 아래 화면 밖에서 시작해 제자리에 똑바로 내려앉는다", () => {
    const rest = { x: 480, y: 440 };
    const frames = arrivalFrames(rest, 80, baseView, 1600);
    const [x, y] = String(frames[0].translate).split(" ").map(parseFloat);
    expect(rest.x + x).toBeLessThan(0);
    expect(rest.y + y).toBeGreaterThan(baseView.h);
    expect(frames[frames.length - 1].translate).toBe("0px 0px");
    expect(parseFloat(String(frames[frames.length - 1].rotate))).toBeCloseTo(0, 5);
  });

  it("떠날 때는 오른쪽 위 화면 밖으로 간다", () => {
    const rest = { x: 300, y: 500 };
    const frames = exitFrames(rest, 80, baseView);
    const [x, y] = String(frames[frames.length - 1].translate).split(" ").map(parseFloat);
    expect(rest.x + x).toBeGreaterThan(baseView.w);
    expect(rest.y + y).toBeLessThan(0);
  });

  it("자기 화병 자리에서 나와 제자리에 앉는다", () => {
    const frames = spillFrames(100, 50, 10);
    expect(frames[0]).toMatchObject({ opacity: 0, translate: "100px 50px" });
    expect(frames[frames.length - 1]).toMatchObject({ opacity: 1, translate: "0px 0px", scale: "1", rotate: "0deg" });
  });
});
