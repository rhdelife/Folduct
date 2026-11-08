import { afterEach, describe, expect, it, vi } from "vitest";
import { isRoomRecord, listRooms, normalizeRoom } from "../storage/db";

const room = { id: "r", name: "방", createdAt: 5, source: "handle", rootName: "방", things: [], workDays: [] };

// 저장소를 흉내 내는 최소 indexedDB입니다. 응답을 고른 대로만 돌려줘요.
function fakeIndexedDb(records: unknown[] | "hang") {
  const open = () => {
    const request: Record<string, unknown> = {};
    if (records === "hang") return request;
    const store = {
      getAll: () => ({ result: records }),
    };
    const tx: Record<string, unknown> = { objectStore: () => store };
    request.result = {
      transaction: () => {
        setTimeout(() => (tx.oncomplete as () => void)());
        return tx;
      },
    };
    setTimeout(() => (request.onsuccess as () => void)());
    return request;
  };
  vi.stubGlobal("indexedDB", { open });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("망가진 기록", () => {
  it("방이 아닌 기록은 건너뛴다", () => {
    for (const value of [null, undefined, 3, "방", {}, { id: 3 }]) expect(isRoomRecord(value), String(value)).toBe(false);
    expect(isRoomRecord(room)).toBe(true);
  });

  it("그릴 수 없는 물건은 빼고, 고칠 수 있는 물건은 살린다", () => {
    const good = { id: "t", path: "a/그림.png", name: "그림.png" };
    const fixed = normalizeRoom({ ...room, things: [null, 3, { id: "경로 없음" }, good, { ...good, id: "t2", kind: "없는 종류", size: "큼", lastModified: NaN, lastUsedAt: -1 }] });
    expect(fixed.things.map((thing) => thing.id)).toEqual(["t", "t2"]);
    expect(fixed.things[1]).toMatchObject({ kind: "image", size: 0, lastModified: 0, lastUsedAt: null });
  });

  it("처음 본 시각이 없는 옛 물건은 방을 만든 시각에 본 것으로 채운다(새 파일로 보이지 않게)", () => {
    const old = { id: "t", path: "a.png", name: "a.png" };
    const fixed = normalizeRoom({ ...room, things: [old, { ...old, id: "t2", seenAt: 9 }, { ...old, id: "t3", seenAt: "망가짐" }] });
    expect(fixed.things.map((thing) => thing.seenAt)).toEqual([5, 9, 5]);
  });

  it("이름·시각·칸이 없어도 방을 그릴 수 있다", () => {
    const fixed = normalizeRoom({ id: "r", rootName: "폴더", workDays: ["2026-11-01", 3], things: "망가짐", care: null, scan: null, face: "망가짐" });
    expect(fixed).toMatchObject({ name: "폴더", createdAt: 0, things: [], workDays: ["2026-11-01"], care: { done: false }, scan: { complete: false } });
    expect(normalizeRoom({ id: "r" }).name).toBe("이름 없는 방");
  });

  it("예전 한도 값이 남은 방도 그대로 열리고, 값은 지우지 않는다", () => {
    const fixed = normalizeRoom({ ...room, budgetBytes: 100, budgetNoticeAt: 5 });
    expect(fixed).toMatchObject({ id: room.id, budgetBytes: 100, budgetNoticeAt: 5 });
  });

  it("망가진 기록이 끼어도 나머지 방은 그대로 나온다", async () => {
    fakeIndexedDb([null, "망가짐", { name: "id 없음" }, { ...room, id: "b", createdAt: 9 }, room]);
    const { listRooms: list } = await import("../storage/db");
    expect((await list()).map((item) => item.id)).toEqual(["r", "b"]);
  });
});

describe("저장소가 답하지 않을 때", () => {
  it("빈 화면에 갇히지 않게 실패로 돌려주고, 다음 호출은 새로 연다", async () => {
    vi.useFakeTimers();
    fakeIndexedDb("hang");
    vi.stubGlobal("navigator", {});
    const failed = expect(listRooms()).rejects.toThrow("저장소가 응답하지 않아요.");
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    vi.useRealTimers();
    fakeIndexedDb([room]);
    expect((await listRooms()).map((item) => item.id)).toEqual(["r"]);
  });
});
