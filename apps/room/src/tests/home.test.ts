import { describe, expect, it } from "vitest";
import { dayMs, defaultCare, localDay } from "../domain/care";
import type { Room, Thing } from "../domain/model";
import { pickStarThings, staleCount, stepRoom } from "../domain/sky";
import { clampMenu, isMenuKey, menuStep, swallowNextClick } from "../components/ContextMenu";

const start = new Date(2026, 9, 5, 12).getTime();

function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 10, lastModified: 0, lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, seenAt: start, pinned: false, box: null, ...patch };
}

function room(things: Thing[], patch: Partial<Room> = {}): Room {
  return { id: "r", name: "방", createdAt: start, source: "handle", rootName: "방", scan: { complete: true, failed: 0, at: start, freedBytes: 0 }, things, workDays: [], care: defaultCare, doneOfferAt: null, face: { shape: 0, color: 0 }, ...patch };
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

describe("오른쪽 클릭 메뉴", () => {
  it("화면 밖으로 나가지 않게 안쪽으로 당긴다", () => {
    expect(clampMenu(100, 100, 200, 40, 375, 600, 8)).toEqual({ left: 100, top: 100 });
    expect(clampMenu(370, 595, 200, 40, 375, 600, 8)).toEqual({ left: 167, top: 552 });
    expect(clampMenu(-5, -5, 500, 40, 375, 600, 8)).toEqual({ left: 8, top: 8 });
  });

  it("메뉴를 닫은 클릭 하나만 삼키고, click 없이 다른 입력이 오면 풀어 준다", () => {
    const click = (target: EventTarget) => {
      const event = new Event("click", { cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const window = new EventTarget();
    swallowNextClick(window);
    expect(click(window)).toBe(true);
    expect(click(window)).toBe(false);

    for (const next of ["pointerdown", "keydown"]) {
      swallowNextClick(window);
      window.dispatchEvent(new Event(next));
      expect(click(window)).toBe(false);
    }
  });

  it("위아래 화살표는 돌아가고, Home과 End는 끝으로 가고, 다른 키는 움직이지 않는다", () => {
    expect(menuStep("ArrowDown", 2, 3)).toBe(0);
    expect(menuStep("ArrowUp", 0, 3)).toBe(2);
    expect(menuStep("ArrowDown", 0, 1)).toBe(0);
    expect(menuStep("ArrowUp", 0, 1)).toBe(0);
    expect(menuStep("Home", 2, 3)).toBe(0);
    expect(menuStep("End", 0, 3)).toBe(2);
    expect(menuStep("Enter", 0, 3)).toBeNull();
  });

  it("메뉴 키와 Shift+F10으로 열고, F10만으로는 열지 않는다", () => {
    expect(isMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(true);
    expect(isMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isMenuKey({ key: "F10", shiftKey: false })).toBe(false);
  });
});

describe("지도에 띄울 파일", () => {
  it("큰 파일 순이고(바닥에 놓였던 것도 따로 앞세우지 않아요), 사라진 파일과 상자 속 파일은 뺀다", () => {
    const placed = thing("placed", { size: 1 });
    const big = thing("big", { spot: null, size: 300 });
    const small = thing("small", { spot: null, size: 20 });
    const missing = thing("missing", { missing: true, size: 999 });
    const boxed = thing("boxed", { box: { state: "virtual", fromPath: "a", boxPath: "b", at: start }, size: 999 });
    const r = room([small, missing, placed, boxed, big]);
    expect(pickStarThings(r, 40).map((item) => item.id)).toEqual(["big", "small", "placed"]);
    expect(pickStarThings(r, 2).map((item) => item.id)).toEqual(["big", "small"]);
  });
});

describe("방 정리 상태", () => {
  it("상자 밖 물건만 오래됨으로 센다(바닥에 놓지 않았던 것도)", () => {
    const workDays = [localDay(start + dayMs)];
    const now = start + 31 * dayMs;
    const r = room(
      [
        thing("old"),
        thing("recent", { touchedAt: start + 4 * dayMs }),
        thing("shelf", { spot: null }),
        thing("boxed", { box: { state: "virtual", fromPath: "a", boxPath: "b", at: start } }),
      ],
      { workDays: [...workDays, localDay(start + 5 * dayMs)] },
    );
    expect(staleCount(r, now)).toBe(2);
  });
});
