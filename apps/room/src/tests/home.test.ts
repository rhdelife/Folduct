import { describe, expect, it } from "vitest";
import { dayMs, defaultCare, localDay } from "../domain/care";
import type { Room, Thing } from "../domain/model";
import { pickStarThings, roomMess, stepRoom } from "../domain/sky";

const start = new Date(2026, 9, 5, 12).getTime();

function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 10, lastModified: 0, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, pinned: false, box: null, ...patch };
}

function room(things: Thing[], patch: Partial<Room> = {}): Room {
  return { id: "r", name: "방", createdAt: start, source: "handle", rootName: "방", scan: { complete: true, failed: 0, at: start, freedBytes: 0 }, things, workDays: [], care: defaultCare, budgetBytes: null, budgetNoticeAt: null, ...patch };
}

describe("지도 방 사이 이동", () => {
  const ids = ["a", "b", "c"];

  it("화살표는 양 끝에서 반대쪽으로 넘어간다", () => {
    expect(stepRoom(ids, "a", "ArrowRight")).toBe("b");
    expect(stepRoom(ids, "c", "ArrowDown")).toBe("a");
    expect(stepRoom(ids, "a", "ArrowLeft")).toBe("c");
    expect(stepRoom(ids, "b", "ArrowUp")).toBe("a");
  });

  it("Home과 End는 처음과 끝으로 간다", () => {
    expect(stepRoom(ids, "b", "Home")).toBe("a");
    expect(stepRoom(ids, "b", "End")).toBe("c");
  });

  it("모르는 방에서는 첫 방부터, 다른 키와 빈 지도는 움직이지 않는다", () => {
    expect(stepRoom(ids, "없음", "ArrowRight")).toBe("a");
    expect(stepRoom(ids, null, "ArrowLeft")).toBe("a");
    expect(stepRoom(ids, "a", "Tab")).toBeNull();
    expect(stepRoom([], "a", "ArrowRight")).toBeNull();
  });
});

describe("지도에 띄울 파일", () => {
  it("바닥 물건부터, 그다음 선반의 큰 파일 순이고, 사라진 파일과 상자 속 파일은 뺀다", () => {
    const placed = thing("placed", { size: 1 });
    const big = thing("big", { spot: null, size: 300 });
    const small = thing("small", { spot: null, size: 20 });
    const missing = thing("missing", { missing: true, size: 999 });
    const boxed = thing("boxed", { box: { state: "virtual", fromPath: "a", boxPath: "b", at: start }, size: 999 });
    const r = room([small, missing, placed, boxed, big]);
    expect(pickStarThings(r, 40).map((item) => item.id)).toEqual(["placed", "big", "small"]);
    expect(pickStarThings(r, 2).map((item) => item.id)).toEqual(["placed", "big"]);
  });
});

describe("방 정리 상태", () => {
  it("바닥에 놓인, 상자 밖 물건만 기울어짐·쓰러짐으로 센다", () => {
    const workDays = [localDay(start + dayMs)];
    const now = start + 8 * dayMs;
    const r = room(
      [
        thing("fallen"),
        thing("tilted", { touchedAt: start + 4 * dayMs }),
        thing("shelf", { spot: null }),
        thing("boxed", { box: { state: "virtual", fromPath: "a", boxPath: "b", at: start } }),
      ],
      { workDays: [...workDays, localDay(start + 5 * dayMs)] },
    );
    expect(roomMess(r, now)).toEqual({ tilted: 1, fallen: 1 });
  });
});
