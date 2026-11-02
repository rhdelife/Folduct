import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCare, localDay, dayMs, sweepCandidates } from "../domain/care";
import type { Room, ScannedFile, Thing } from "../domain/model";
import { askFolder, folderAccess, scanRoomFolder, type Folder } from "../gateways/native";
import { answerDoneOffer, planSweep, reconcileBox, restoreFromBox, runSweep, type SweepPlan } from "../storage/box";
import { sampleRooms } from "../storage/sample";
import { vaseIndex } from "../art/vases";
import { getHandle, listRooms, patchRoom, saveRoom, setLastSweepAt } from "../storage/db";
import { put, seed, view, type MemoryDir } from "./fakeFolder";

// 저장소는 메모리 Map으로 바꿉니다. patchRoom은 진짜처럼 최신 기록을 읽어 고친 뒤 씁니다.
const db = vi.hoisted(() => {
  const rooms = new Map<string, Room>();
  const patch = async (id: string, mutate: (room: Room) => Room): Promise<Room> => {
    const stored = rooms.get(id);
    if (!stored) throw new Error("방 기록을 찾지 못했어요.");
    const next = mutate(structuredClone(stored));
    rooms.set(id, structuredClone(next));
    return structuredClone(next);
  };
  return { rooms, patch };
});

vi.mock("../storage/db", () => ({
  listRooms: vi.fn(async () => [...db.rooms.values()].map((room) => structuredClone(room))),
  getHandle: vi.fn(async () => null),
  saveRoom: vi.fn(async (room: Room) => void db.rooms.set(room.id, structuredClone(room))),
  patchRoom: vi.fn(db.patch),
  setLastSweepAt: vi.fn(async () => undefined),
}));

// 폴더 갈림길: 핸들 자리에 메모리 폴더를 그대로 넘기고, 권한은 기본으로 허용합니다.
vi.mock("../gateways/native", () => ({
  isNative: () => false,
  folderAccess: vi.fn(async () => "granted"),
  askFolder: vi.fn(async () => true),
  folderMover: (folder: unknown) => folder,
  folderSource: (folder: { raw: MemoryDir & { unreachable?: boolean } }) => ({
    async *list() {
      if (folder.raw.unreachable) throw new DOMException("없음", "NotFoundError");
    },
  }),
  canMoveIn: () => true,
  scanRoomFolder: vi.fn(),
}));

const start = new Date(2026, 9, 5, 12).getTime();
const now = start + 31 * dayMs;
const box = "_Folduct 정리상자";

function thing(path: string, patch: Partial<Thing> = {}): Thing {
  return { id: crypto.randomUUID(), path, name: path.split("/").pop()!, kind: "design", size: 100, lastModified: 0, lastUsedAt: null, missing: false, spot: { x: 3, y: 3 }, note: "", touchedAt: start, pinned: false, box: null, ...patch };
}

function room(things: Thing[], patch: Partial<Room> = {}): Room {
  return { id: "r", name: "방", createdAt: start, source: "handle", rootName: "방", scan: { complete: true, failed: 0, at: start, freedBytes: 0 }, things, workDays: [localDay(start + dayMs)], care: defaultCare, budgetBytes: null, budgetNoticeAt: null, doneOfferAt: null, face: { shape: 0, color: 0 }, ...patch };
}

function store(...rooms: Room[]) {
  for (const item of rooms) db.rooms.set(item.id, structuredClone(item));
}

const folder = (raw: MemoryDir) => view(raw) as unknown as Folder;
const realPlan = (item: Room, raw: MemoryDir): SweepPlan => ({ room: item, mode: "real", handle: folder(raw), candidates: item.things });
const stored = (id = "r") => db.rooms.get(id)!;
const has = (raw: MemoryDir, path: string) => {
  const parts = path.split("/");
  let dir: MemoryDir | undefined = raw;
  for (const part of parts.slice(0, -1)) dir = dir?.dirs.get(part);
  return dir?.files.get(parts[parts.length - 1]);
};

beforeEach(() => {
  db.rooms.clear();
  vi.clearAllMocks();
  vi.mocked(folderAccess).mockResolvedValue("granted");
  vi.mocked(askFolder).mockResolvedValue(true);
});

describe("저장된 방 옮겨 오기", () => {
  it("lastUsedAt이 없는 예전 방은 메모·자리·상자를 그대로 두고 null을 얻는다", async () => {
    const { normalizeRoom } = await vi.importActual<typeof import("../storage/db")>("../storage/db");
    const entry = { state: "boxed" as const, fromPath: "a.psd", boxPath: `${box}/a.psd`, at: start };
    const { lastUsedAt: _gone, ...old } = thing(`${box}/a.psd`, { note: "왜 두었나", spot: { x: 2, y: 5 }, box: entry });
    const migrated = normalizeRoom({ ...room([]), things: [old, { ...old, id: "망가짐", lastUsedAt: "어제" }, { ...old, id: "음수", lastUsedAt: -1 }, { ...old, id: "그대로", lastUsedAt: start }] });
    expect(migrated.things[0]).toEqual({ ...old, lastUsedAt: null });
    expect(migrated.things.map((item) => item.lastUsedAt)).toEqual([null, null, null, start]);
  });
});

describe("돌보기 설정 옮기기", () => {
  it("저장된 옛 방을 읽으면 기준이 하나로 합쳐지고, 제안 기록은 비어 있다", async () => {
    const { normalizeRoom } = await vi.importActual<typeof import("../storage/db")>("../storage/db");
    const { doneOfferAt: _, face: __, ...saved } = room([]);
    const old = { ...saved, care: { enabled: true, resting: false, done: false, tiltAfterDays: 3, fallAfterDays: 7 } };
    expect(normalizeRoom(old)).toMatchObject({ doneOfferAt: null, care: { enabled: true, resting: false, done: false, staleAfterDays: 30 } });
    expect(normalizeRoom(old).care).not.toHaveProperty("fallAfterDays");
    expect(normalizeRoom({ ...old, care: { ...old.care, fallAfterDays: 14 } }).care.staleAfterDays).toBe(14);
    expect(normalizeRoom({ ...old, doneOfferAt: 5 }).doneOfferAt).toBe(5);
    // 얼굴이 없던 방은 예전과 같은 모양을 받고, 저장된 얼굴은 지킵니다.
    expect(normalizeRoom(old).face.shape).toBe(vaseIndex(old.id));
    expect(normalizeRoom({ ...old, face: { shape: 3, color: 5 } }).face).toEqual({ shape: 3, color: 5 });
  });
});

describe("오래 안 쓴 방 제안 답하기", () => {
  it("완료로 옮기면 표시만 바뀌고 물어본 시각이 남는다", async () => {
    const item = room([thing("a.psd")]);
    store(item);
    await answerDoneOffer(item.id, true, now);
    expect(stored().care.done).toBe(true);
    expect(stored().doneOfferAt).toBe(now);
    expect(stored().things).toEqual(item.things);
  });

  it("그대로 두면 물어본 시각만 남고 완료 상태는 그대로다", async () => {
    store(room([thing("a.psd")]));
    await answerDoneOffer("r", false, now);
    expect(stored().care.done).toBe(false);
    expect(stored().doneOfferAt).toBe(now);
  });
});

describe("샘플 방", () => {
  it("구경할 수 있게 방마다 오래된 파일이 있다", () => {
    const at = Date.now();
    for (const sample of sampleRooms(at)) expect(sweepCandidates(sample, at).length).toBeGreaterThan(0);
  });
});

describe("주간 정리 기록", () => {
  it("옮긴 뒤 마지막 기록이 실패해도, 다음 맞추기에서 메모를 지닌 채 상자 안 물건이 된다", async () => {
    const raw = seed();
    const item = thing("참고/시안.psd", { note: "왜 두었나" });
    store(room([item]));
    vi.mocked(patchRoom).mockImplementationOnce(db.patch).mockRejectedValueOnce(new Error("저장 공간이 모자라요"));
    const plans = [realPlan(room([item]), raw)];
    await expect(runSweep(plans, new Set([item.id]), now)).rejects.toThrow();
    expect(has(raw, `${box}/참고/시안.psd`)).toBe("원본");
    expect(stored().things[0].box?.state).toBe("moving-in");
    // 같은 계획으로 다시 눌러도 남은 기록을 (2) 이름이나 '집에 있음'으로 덮지 않습니다.
    await runSweep(plans, new Set([item.id]), now);
    expect(stored().things[0].box).toMatchObject({ state: "moving-in", boxPath: `${box}/참고/시안.psd` });

    const fixed = await reconcileBox(stored(), folder(raw));
    expect(fixed.things[0]).toMatchObject({ path: `${box}/참고/시안.psd`, note: "왜 두었나", missing: false, box: { state: "boxed", fromPath: "참고/시안.psd" } });
    expect(stored().things[0]).toEqual(fixed.things[0]);
  });

  it("꺼내던 기록은 파일이 집에 있으면 집으로, 어디에도 없으면 상자 기록만 푼다", async () => {
    const entry = { fromPath: "참고/시안.psd", boxPath: `${box}/참고/시안.psd`, at: start };
    const out = thing(entry.boxPath, { box: { ...entry, state: "moving-out" } });
    store(room([out]));
    const home = await reconcileBox(stored(), folder(seed()));
    expect(home.things[0]).toMatchObject({ box: null, path: entry.fromPath, missing: false });

    const lost = thing(entry.boxPath, { box: { ...entry, state: "moving-in" } });
    store(room([lost]));
    expect((await reconcileBox(stored(), folder(seed({})))).things[0]).toMatchObject({ box: null, path: entry.fromPath });
  });

  it("방 폴더 자체에 닿지 못하면 옮기던 기록을 그대로 두고, 다시 닿으면 맞춘다", async () => {
    const entry = { fromPath: "참고/시안.psd", boxPath: `${box}/참고/시안.psd`, at: start };
    const inBox = thing(entry.fromPath, { box: { ...entry, state: "moving-in" } });
    const out = thing(entry.boxPath, { box: { ...entry, fromPath: "참고/다른.psd", boxPath: `${box}/참고/다른.psd`, state: "moving-out" } });
    store(room([inBox, out]));
    const before = structuredClone(stored());
    // 빠진 드라이브처럼 어느 경로든 '없음'으로 답하는 폴더입니다.
    const gone = Object.assign(seed({}), { unreachable: true });
    expect(await reconcileBox(stored(), folder(gone))).toEqual(before);
    expect(stored()).toEqual(before);

    const back = seed({ [entry.boxPath]: "원본", "참고/다른.psd": "다른" });
    const fixed = await reconcileBox(stored(), folder(back));
    expect(fixed.things[0]).toMatchObject({ path: entry.boxPath, box: { state: "boxed" } });
    expect(fixed.things[1]).toMatchObject({ path: "참고/다른.psd", box: null });
  });

  it("옮길 자리에 다른 파일이 생기면 기록은 그대로 두고, 실패를 물건 id·경로와 함께 알린다", async () => {
    const raw = seed();
    const item = thing("참고/시안.psd");
    store(room([item]));
    // 이름을 정한 뒤 옮기기 전에 다른 앱이 같은 이름을 만든 경우.
    vi.mocked(patchRoom).mockImplementationOnce(async (id, mutate) => {
      put(raw, `${box}/참고/시안.psd`, "다른 앱");
      return db.patch(id, mutate);
    });
    const [outcome] = await runSweep([realPlan(room([item]), raw)], new Set([item.id]), now);
    expect(outcome).toMatchObject({ roomId: "r", moved: 0, failures: [{ id: item.id, path: item.path, name: "시안.psd" }] });
    expect(stored().things[0]).toEqual(item);
    expect(has(raw, `${box}/참고/시안.psd`)).toBe("다른 앱");
    expect(has(raw, "참고/시안.psd")).toBe("원본");
  });

  it("같은 계획으로 두 번 정리해도 상자 안 물건을 내려앉히거나 (2) 이름을 적지 않는다", async () => {
    const raw = seed();
    const item = thing("참고/시안.psd");
    store(room([item]));
    const plans = [realPlan(room([item]), raw)];
    await runSweep(plans, new Set([item.id]), now);
    const boxed = structuredClone(stored().things[0]);
    expect(boxed).toMatchObject({ path: `${box}/참고/시안.psd`, box: { state: "boxed" } });

    const [again] = await runSweep(plans, new Set([item.id]), now);
    expect(again).toMatchObject({ moved: 0, failures: [] });
    expect(stored().things[0]).toEqual(boxed);
    expect(JSON.stringify(stored())).not.toContain("(2)");
  });

  it("50개를 옮겨도 방마다 기록은 두 번이고, 같은 이름이 될 두 파일은 다른 상자 경로를 받는다", async () => {
    const files: Record<string, string> = { [`${box}/a.txt`]: "예전에 넣은 것" };
    const things = [thing("a (2).txt"), thing("a.txt"), ...Array.from({ length: 48 }, (_, i) => thing(`f${i}.txt`))];
    for (const item of things) files[item.path] = item.path;
    const raw = seed(files);
    store(room(things));
    const [outcome] = await runSweep([realPlan(room(things), raw)], new Set(things.map((item) => item.id)), now);
    expect(outcome).toMatchObject({ moved: 50, failures: [] });
    expect(vi.mocked(patchRoom)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveRoom)).not.toHaveBeenCalled();
    const paths = stored().things.map((item) => item.path);
    expect(new Set(paths).size).toBe(50);
    expect(paths.slice(0, 2)).toEqual([`${box}/a (2).txt`, `${box}/a (3).txt`]);
    expect(has(raw, `${box}/a.txt`)).toBe("예전에 넣은 것");
  });

  it("권한을 못 받아 모든 방을 건너뛰면 정리한 주로 치지 않고, 한 방이라도 정리하면 친다", async () => {
    vi.mocked(folderAccess).mockResolvedValue("prompt");
    vi.mocked(askFolder).mockResolvedValue(false);
    const a = room([thing("a.psd")], { id: "a" });
    const b = room([thing("b.psd")], { id: "b" });
    store(a, b);
    const outcomes = await runSweep([realPlan(a, seed()), realPlan(b, seed())], new Set([...a.things, ...b.things].map((item) => item.id)), now);
    expect(outcomes.every((outcome) => outcome.skipped)).toBe(true);
    expect(setLastSweepAt).not.toHaveBeenCalled();

    const sample = room([thing("c.psd")], { id: "s", source: "sample" });
    store(sample);
    const [plan] = await planSweep([sample], now);
    expect(listRooms).not.toHaveBeenCalled();
    expect(plan.mode).toBe("virtual");
    await runSweep([realPlan(a, seed()), plan], new Set([...a.things, ...sample.things].map((item) => item.id)), now);
    expect(setLastSweepAt).toHaveBeenCalledWith(now);
    expect(stored("s").things[0].box?.state).toBe("virtual");
  });

  describe("정리 후보를 고르기 전에 폴더를 다시 읽는다", () => {
    const scanned = (path: string, patch: Partial<ScannedFile> = {}): ScannedFile => ({ path, name: path, kind: "design", size: 100, lastModified: 0, ...patch });
    const handleRoom = (...things: Thing[]) => {
      const item = room(things);
      store(item);
      vi.mocked(getHandle).mockResolvedValue(folder(seed()) as FileSystemDirectoryHandle);
      return item;
    };

    it("방 밖에서 어제 연 파일은 후보에서 빠지고, 새 활동은 저장된다", async () => {
      const opened = thing("열었음.psd");
      const idle = thing("그대로.psd");
      const item = handleRoom(opened, idle);
      vi.mocked(scanRoomFolder).mockResolvedValue({ files: [scanned(opened.path, { lastUsedAt: now - dayMs }), scanned(idle.path)], failed: 0, complete: true, note: null });
      const [plan] = await planSweep([item], now);
      expect(plan.candidates.map((candidate) => candidate.id)).toEqual([idle.id]);
      expect(stored().things[0].lastUsedAt).toBe(now - dayMs);
    });

    it("이번 스캔에서 못 본 파일은 옛 기록만 보고 제안하지 않는다", async () => {
      const unseen = thing("한도밖.psd");
      const idle = thing("그대로.psd");
      const item = handleRoom(unseen, idle);
      vi.mocked(scanRoomFolder).mockResolvedValue({ files: [scanned(idle.path)], failed: 0, complete: false, note: null });
      const [plan] = await planSweep([item], now);
      expect(plan.candidates.map((candidate) => candidate.id)).toEqual([idle.id]);
    });

    it("폴더를 못 읽거나 권한이 없으면 실제로 옮길 후보를 내지 않고 기록도 그대로 둔다", async () => {
      const item = handleRoom(thing("그대로.psd"));
      const before = structuredClone(stored());
      vi.mocked(scanRoomFolder).mockRejectedValue(new DOMException("없음", "NotFoundError"));
      expect(await planSweep([item], now)).toEqual([]);
      expect(stored()).toEqual(before);

      vi.mocked(scanRoomFolder).mockClear();
      vi.mocked(folderAccess).mockResolvedValue("prompt");
      expect(await planSweep([item], now)).toEqual([]);
      expect(scanRoomFolder).not.toHaveBeenCalled();
    });
  });
});

describe("제자리로", () => {
  it("상자 속 파일을 원래 자리로 옮기고, 바뀐 칸만 patch로 돌려준다", async () => {
    const entry = { state: "boxed" as const, fromPath: "참고/시안.psd", boxPath: `${box}/참고/시안.psd`, at: start };
    const raw = seed({ [entry.boxPath]: "원본" });
    const item = thing(entry.boxPath, { box: entry, note: "메모" });
    store(room([item]));
    const result = await restoreFromBox(stored(), folder(raw), item.id, now);
    expect(result.error).toBeNull();
    expect(result.patch).toEqual({ box: null, path: entry.fromPath, touchedAt: now });
    expect(stored().things[0]).toMatchObject({ ...result.patch, note: "메모" });
    expect(has(raw, entry.fromPath)).toBe("원본");
  });
});
