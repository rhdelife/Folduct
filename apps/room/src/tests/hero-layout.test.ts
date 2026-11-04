import { describe, expect, it } from "vitest";
import { dayMs, defaultCare, localDay } from "../domain/care";
import { columnsFor, rowCap, rowMetrics, rowOnlyCards, rowTilt, cardCap, flightsFor, heroLayout, keepOut, namedPaper, paperWidth, type Card } from "../domain/heroLayout";
import type { Room, Thing } from "../domain/model";
import { baseView, calendarSpot, homeLimit, layoutRooms, roomRadius, stageUnit, toPx, vaseHalf, vaseUnit, type Box, type View } from "../domain/sky";
import { rowRest } from "../components/home/engine";
import { rowOnlyPose, arrivalFrames, spillFrames, cardPose } from "../components/home/heroMotion";

const start = Date.UTC(2026, 0, 5, 12);
// 종이가 다 내려앉았고 아직 사라지기 전인 자리.
const MB = 1024 * 1024;

function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 5 * MB, lastModified: 0, lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, pinned: false, box: null, ...patch };
}
function room(id: string, things: Thing[], patch: Partial<Room> = {}): Room {
  return { id, name: id, createdAt: start, source: "handle", rootName: id, scan: { complete: true, failed: 0, at: start, freedBytes: 0 }, things, workDays: [], care: defaultCare, doneOfferAt: null, face: { shape: 0, color: 0 }, ...patch };
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

  it("쪽 이동 자리를 비운다: 넓으면 머리 줄 가운데, 좁으면 머리 띠 전체", () => {
    const covers = (view: typeof baseView, x: number, y: number) => keepOut([], view).some((box) => Math.abs(box.x - x) <= box.hw && Math.abs(box.y - y) <= box.hh);
    expect(covers({ ...baseView, w: 1280, h: 800 }, 640, 42)).toBe(true);
    expect(covers({ ...baseView, w: 720, h: 800 }, 360, 96)).toBe(true);
    expect(covers({ ...baseView, w: 375, h: 812 }, 187, 110)).toBe(true);
  });

  it("종이끼리, 머리글·주름관·이름표·머리 버튼과 겹치지 않는다", () => {
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

  it("오래된 파일은 방에서 더 멀지만, 크게 기울지는 않는다", () => {
    const now = start + 40 * dayMs;
    const workDays = [localDay(start + dayMs)];
    const files = Array.from({ length: 16 }, (_, i) => thing(`f${i}`, i % 2 ? { touchedAt: now } : {}));
    const { nodes, cards } = heroLayout([room("a", files, { workDays })], now, baseView, aspect);
    const center = toPx(nodes[0].at, baseView);
    const far = (stale: boolean) => {
      const list = cards.filter((c) => c.stale === stale).map((c) => {
        const at = toPx(c, baseView);
        return Math.hypot(at.x - center.x, at.y - center.y);
      });
      return list.reduce((sum, d) => sum + d, 0) / list.length;
    };
    expect(cards.some((c) => c.stale)).toBe(true);
    expect(far(true)).toBeGreaterThan(far(false));
    for (const c of cards) expect(Math.abs(c.rot)).toBeLessThanOrEqual(7);
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

describe("첫 스크롤: 프로젝트별로 모으기", () => {
  const { nodes, cards } = heroLayout(many(3, 14), start, baseView, aspect);
  const flights = flightsFor(cards, nodes, baseView);

  it("맨 위에서는 움직이지 않고, pos만의 함수라 되감으면 그대로 돌아온다", () => {
    for (const flight of flights.values()) {
      const top = cardPose(0, flight);
      expect([top.x + 0, top.y + 0, top.rot + 0, top.scale, top.opacity]).toEqual([0, 0, 0, 1, 1]);
      expect(cardPose(300, flight)).toEqual(cardPose(300, flight));
      // 모이는 내내 보여요. 흩어지거나 사라지지 않습니다.
      expect(cardPose(300, flight).opacity).toBe(1);
    }
  });

  it("쉼터에서는 모든 종이가 조금만 기울어 자기 자리에 닿는다", () => {
    for (const card of cards) {
      const flight = flights.get(card.thing.id)!;
      const pose = cardPose(rowRest, flight);
      expect(flight.rest.x + pose.x).toBeCloseTo(flight.to.x, 5);
      expect(flight.rest.y + pose.y).toBeCloseTo(flight.to.y, 5);
      expect(Math.abs(card.rot + pose.rot)).toBeLessThanOrEqual(rowTilt);
      expect(pose.opacity).toBe(1);
    }
  });

  it("파일은 자기 프로젝트의 칸 안, 그 주름관 아래에 모이고 다른 프로젝트와 섞이지 않는다", () => {
    const columns = columnsFor(nodes, baseView);
    expect(columns.size).toBe(nodes.length);
    for (const card of cards) {
      const column = columns.get(card.room.id)!;
      const { to, half, tall } = flights.get(card.thing.id)!;
      expect(to.x - half).toBeGreaterThanOrEqual(column.x - column.width / 2);
      expect(to.x + half).toBeLessThanOrEqual(column.x + column.width / 2);
      expect(to.y - tall).toBeGreaterThanOrEqual(column.papersTop);
    }
  });

  it("주름관은 받침을 맞춰 나란히 서고, 원래 왼쪽에 있던 방이 왼쪽 칸에 온다", () => {
    const columns = columnsFor(nodes, baseView);
    const unit = stageUnit(baseView) * vaseUnit;
    const bases = nodes.map((node) => columns.get(node.room.id)!.y + vaseHalf(node.r) * unit);
    for (const base of bases) expect(base).toBeCloseTo(bases[0], 5);
    const byRest = [...nodes].sort((a, b) => a.at.x - b.at.x).map((node) => columns.get(node.room.id)!.x);
    expect(byRest).toEqual([...byRest].sort((a, b) => a - b));
  });

  it("어느 창에서든 머리와 현관 줄과 창 아래를 넘지 않고, 칸이 창보다 넓으면 넘친 만큼을 알려 준다", () => {
    const cases: [View, number, number, number][] = [
      [{ w: 375, h: 812 }, 8, 14, 112],
      [{ w: 375, h: 667 }, 3, 14, 112],
      [{ w: 720, h: 900 }, 5, 14, 100],
      [{ w: 1280, h: 800 }, 3, 14, 74],
      [{ w: 1280, h: 800 }, 1, 2, 74],
    ];
    for (const [view, roomCount, files, header] of cases) {
      const laid = heroLayout(many(roomCount, files), start, view, aspect);
      const door = header + 90;
      const row = flightsFor(laid.cards, laid.nodes, view, door);
      const { overflow } = rowMetrics(row, view);
      expect(row.size).toBe(laid.cards.length);
      for (const card of laid.cards) {
        const flight = row.get(card.thing.id)!;
        expect(flight.to.x - flight.half, `${view.w} 왼쪽`).toBeGreaterThanOrEqual(0);
        expect(flight.to.x + flight.half - overflow, `${view.w} 오른쪽`).toBeLessThanOrEqual(view.w);
        expect(flight.to.y - flight.tall, `${view.w} 위`).toBeGreaterThanOrEqual(door);
        expect(flight.to.y + flight.tall, `${view.w} 아래`).toBeLessThanOrEqual(view.h + 0.001);
        expect(flight.to.scale, `${view.w} 배율`).toBeLessThanOrEqual(1);
        expect(flight.to.scale, `${view.w} 배율`).toBeGreaterThan(0.3);
      }
    }
  });

  it("지도에 못 나온 파일도 칸에 들어오고, 많아도 창 아래를 넘지 않는다", () => {
    const view = { w: 1280, h: 800 };
    const laid = heroLayout(many(2, 40), start, view, aspect);
    const only = rowOnlyCards(laid.cards, laid.nodes, start, view, aspect);
    expect(only.length).toBeGreaterThan(0);
    expect(laid.cards.length + only.length).toBeLessThanOrEqual(rowCap);
    expect(only.every((card) => card.rowOnly && !laid.cards.some((shown) => shown.thing.id === card.thing.id))).toBe(true);
    const row = flightsFor([...laid.cards, ...only], laid.nodes, view);
    expect(row.size).toBe(laid.cards.length + only.length);
    expect([...row.values()].filter((flight) => flight.rowOnly).length).toBe(only.length);
    for (const flight of row.values()) {
      expect(flight.to.x - flight.half).toBeGreaterThanOrEqual(0);
      expect(flight.to.y + flight.tall).toBeLessThanOrEqual(view.h + 0.001);
    }
  });

  it("칸에만 있는 종이는 쉼터에서 보인다", () => {
    const view = { w: 1280, h: 800 };
    const laid = heroLayout(many(2, 40), start, view, aspect);
    const only = rowOnlyCards(laid.cards, laid.nodes, start, view, aspect);
    const flight = flightsFor([...laid.cards, ...only], laid.nodes, view).get(only[0].thing.id)!;
    expect(rowOnlyPose(0, flight).opacity).toBe(0);
    expect(rowOnlyPose(rowRest, flight).opacity).toBe(1);
  });

  it("칸 안에서는 최근에 작업한 파일이 먼저 놓인다", () => {
    const days = [9, 1, 5, 3];
    const files = days.map((day, f) => thing(`f${f}`, { lastModified: start - day * 86400000, touchedAt: null, lastUsedAt: null }));
    const laid = heroLayout([room("a", files)], start, baseView, aspect);
    const row = flightsFor(laid.cards, laid.nodes, baseView);
    expect(laid.cards.map((card) => card.thing.id).sort((a, b) => row.get(a)!.slot - row.get(b)!.slot)).toEqual(["f1", "f3", "f2", "f0"]);
  });

  it("같은 줄의 이웃과는 살짝 겹쳐 더미처럼 놓인다", () => {
    const laid = heroLayout(many(1, 2), start, baseView, aspect);
    const [a, b] = [...flightsFor(laid.cards, laid.nodes, baseView).values()].sort((x, y) => x.slot - y.slot);
    expect(a.to.y === b.to.y || Math.abs(a.to.y - b.to.y) < Math.max(a.tall, b.tall)).toBe(true);
    const lap = a.to.x + a.half - (b.to.x - b.half);
    expect(lap).toBeGreaterThan(0);
    expect(lap).toBeLessThan(Math.min(a.half, b.half) * 2);
  });
});

describe("현관 줄 자리", () => {
  it("현관 줄이 있으면 주름관과 종이가 그 아래에 놓인다", () => {
    for (const view of [{ w: 375, h: 812 }, { w: 720, h: 900 }, { w: 1280, h: 800 }]) {
      const line = (view.w < 720 ? 112 : view.w < 1200 ? 100 : 74) + 118;
      const { nodes, cards } = heroLayout(many(3, 4), start, view, aspect, null, true);
      for (const { at, r } of nodes) expect(toPx(at, view).y - vaseHalf(r) * stageUnit(view) * vaseUnit).toBeGreaterThanOrEqual(line);
      for (const card of cards) expect(toPx(card, view).y + card.height / 2).toBeGreaterThan(line);
      expect(cards.filter((card) => toPx(card, view).y - card.height / 2 < line - 2)).toEqual([]);
    }
  });

  it("폰 폭에 현관 줄이 있어도 종이는 이름이 찍히는 크기다", () => {
    const { cards } = heroLayout(many(4, 12), start, { w: 375, h: 700 }, aspect, null, true);
    expect(cards.length).toBeGreaterThan(0);
    expect(Math.min(...cards.map((card) => card.size))).toBeGreaterThanOrEqual(namedPaper);
  });

  it("현관 줄이 없으면 그 자리를 비우지 않는다", () => {
    const view = { w: 1280, h: 800 };
    expect(keepOut([], view).length).toBe(keepOut([], view, 192).length - 1);
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
