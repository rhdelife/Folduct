import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayMs } from "../domain/care";
import { addFolder, doorTargets, doorTitle, dropItem, emptyDoorstep, isPartialFile, newestFirst, normalizeDoorstep, removeFolder, restoreItem, settleFolder, type DoorItem, type DoorRead, type Doorstep } from "../domain/doorstep";
import type { Room, ScannedFile } from "../domain/model";
import { readDoorFolder, type DirectorySource } from "../gateways/folder";
import { moveDoorFile, type MoveDirectory } from "../gateways/mover";
import { addDoorFolder, assignDoorItem, bringIntoRoom, refreshDoorstep, undoBring, undoDoorMove } from "../storage/doorstep";
import { seed, view, type MemoryDir } from "./fakeFolder";

// 저장소와 Tauri 폴더 손만 메모리로 바꿉니다. 등록하지 않은 폴더는 읽기에 실패합니다.
const disk = vi.hoisted(() => ({ state: null as unknown as Doorstep, folders: new Map<string, DirectorySource>(), dirs: new Map<string, MoveDirectory>(), rooms: [] as { origin?: string }[], patched: null as Room | null, scanned: null as MemoryDir | null, scanFails: false }));

vi.mock("../storage/db", () => ({
  getDoorstep: async () => disk.state,
  patchDoorstep: async (mutate: (state: Doorstep) => Doorstep) => (disk.state = mutate(disk.state)),
  listRooms: async () => disk.rooms,
  patchRoom: async (_id: string, mutate: (room: Room) => Room) => (disk.patched = mutate(disk.patched!)),
}));

vi.mock("../gateways/native", () => ({
  sameFolder: (a: string | undefined, b: string) => a === b,
  scanRoomFolder: async () => {
    if (disk.scanFails) throw new Error("읽기 실패");
    return { files: [...disk.scanned!.files.keys()].map((name) => ({ path: name, name, kind: "pdf", size: 10, lastModified: 1 })), complete: true, failed: 0 };
  },
  folderMover: (folder: string) => disk.dirs.get(folder),
  pathSource: (folder: string) =>
    disk.folders.get(folder) ?? {
      list: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("없음")) }) }),
    },
}));

const now =Date.parse("2026-11-02T12:00:00");
const dl = "/Users/me/Downloads";

// 폴더 하나짜리 메모리 소스. stats에 없는 파일은 크기를 물으면 실패합니다.
function source(entries: { name: string; kind?: "file" | "directory" }[], stats: Record<string, number> = {}): DirectorySource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async *list() {
      for (const entry of entries) yield { name: entry.name, kind: entry.kind ?? "file" };
    },
    async file(name) {
      asked.push(name);
      if (!(name in stats)) throw new Error("읽기 실패");
      return { size: 10, lastModified: stats[name] };
    },
    async directory() {
      throw new Error("하위 폴더는 읽지 않아요");
    },
  };
}

const file = (name: string, lastModified = now): ScannedFile => ({ path: name, name, kind: "pdf", size: 10, lastModified });
const read = (present: string[], found: ScannedFile[] = []): DoorRead => ({ present, found });
const opened = (seen: string[], extra: Partial<Doorstep> = {}): Doorstep => ({ ...emptyDoorstep, folders: [dl], seen: { [dl]: seen }, readAt: now - dayMs, ...extra });

describe("현관 폴더 읽기", () => {
  it("처음 읽는 폴더는 기준만 잡고, 파일 크기도 묻지 않습니다", async () => {
    const dir = source([{ name: "옛날.pdf" }, { name: "또.zip" }]);
    expect(await readDoorFolder(dir, undefined)).toEqual({ present: ["옛날.pdf", "또.zip"], found: [] });
    expect(dir.asked).toEqual([]);
  });

  it("지난 목록에 없는 이름만 새 문서입니다. 날짜가 옛날이어도요", async () => {
    const dir = source([{ name: "있던.pdf" }, { name: "복사본.pdf" }], { "복사본.pdf": now - 400 * dayMs });
    const result = await readDoorFolder(dir, ["있던.pdf"]);
    expect(result.present).toEqual(["있던.pdf", "복사본.pdf"]);
    expect(result.found.map((item) => [item.name, item.lastModified])).toEqual([["복사본.pdf", now - 400 * dayMs]]);
    // 전부터 있던 파일은 오늘 고쳤어도 묻지 않으니 새 문서가 될 수 없습니다.
    expect(dir.asked).toEqual(["복사본.pdf"]);
  });

  it("받는 중인 파일, 숨김 파일, 하위 폴더는 보지 않습니다", async () => {
    const dir = source([{ name: "a.pdf.crdownload" }, { name: "b.download" }, { name: "c.part" }, { name: "d.TMP" }, { name: "~$e.docx" }, { name: ".DS_Store" }, { name: "압축 푼 폴더", kind: "directory" }]);
    expect(await readDoorFolder(dir, [])).toEqual({ present: [], found: [] });
  });

  it("받기가 끝나 진짜 이름이 되면 새 문서가 됩니다", async () => {
    expect(isPartialFile("보고서.pdf.crdownload")).toBe(true);
    expect(isPartialFile("보고서.pdf")).toBe(false);
    const result = await readDoorFolder(source([{ name: "보고서.pdf" }], { "보고서.pdf": now }), []);
    expect(result.found.map((item) => item.name)).toEqual(["보고서.pdf"]);
  });

  it("크기를 못 읽은 파일은 목록에 넣지 않아 다음에 다시 봅니다", async () => {
    const result = await readDoorFolder(source([{ name: "잠긴.pdf" }, { name: "됨.pdf" }], { "됨.pdf": now }), []);
    expect(result.present).toEqual(["됨.pdf"]);
    expect(result.found.map((item) => item.name)).toEqual(["됨.pdf"]);
  });

  it("폴더 자체를 못 읽으면 실패로 돌려줍니다. 빈 폴더로 치면 줄이 비어 버려요", async () => {
    const broken: DirectorySource = { ...source([]), list: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("없음")) }) }) };
    await expect(readDoorFolder(broken, [])).rejects.toThrow("없음");
  });

  it("디스크 이름은 그대로 두고, 보이는 이름만 NFC로 맞춥니다", async () => {
    const nfd = "보고서.pdf".normalize("NFD");
    const { found, present } = await readDoorFolder(source([{ name: nfd }], { [nfd]: now }), []);
    expect(present).toEqual([nfd]);
    expect(found[0].path).toBe(nfd);
    expect(found[0].name).toBe("보고서.pdf");
    expect(found[0].kind).toBe("pdf");
  });
});

describe("현관 합치기", () => {
  it("새 문서를 올리고 목록을 새로 저장합니다", () => {
    const next = settleFolder(opened(["있던.pdf"]), dl, read(["있던.pdf", "새.pdf"], [file("새.pdf")]), now);
    expect(next.items.map((item) => [item.folder, item.path, item.since])).toEqual([[dl, "새.pdf", now - dayMs]]);
    expect(next.seen[dl]).toEqual(["있던.pdf", "새.pdf"]);
  });

  it("배정하지 않은 문서는 다음에 켜도 줄에 남습니다", () => {
    const first = settleFolder(opened([]), dl, read(["새.pdf"], [file("새.pdf")]), now);
    const second = settleFolder({ ...first, readAt: now }, dl, read(["새.pdf"]), now + dayMs);
    expect(second.items).toEqual(first.items);
  });

  it("같은 문서를 두 번 올리지 않습니다", () => {
    const first = settleFolder(opened([]), dl, read(["새.pdf"], [file("새.pdf")]), now);
    expect(settleFolder(first, dl, read(["새.pdf"], [file("새.pdf")]), now).items).toHaveLength(1);
  });

  it("폴더에서 사라진 문서는 줄에서도 뺍니다. 다른 폴더 문서는 그대로예요", () => {
    const desk = "/Users/me/Desktop";
    let state: Doorstep = { ...opened([]), folders: [dl, desk] };
    state = settleFolder(state, dl, read(["a.pdf"], [file("a.pdf")]), now);
    state = settleFolder(state, desk, read(["b.pdf"], [file("b.pdf")]), now);
    expect(settleFolder(state, dl, read([]), now).items.map((item) => item.path)).toEqual(["b.pdf"]);
  });

  it("읽는 사이 빠진 폴더는 다시 넣지 않습니다", () => {
    const state: Doorstep = { ...emptyDoorstep, folders: [] };
    expect(settleFolder(state, dl, read(["a.pdf"], [file("a.pdf")]), now)).toBe(state);
  });
});

describe("현관 폴더와 문서 다루기", () => {
  it("폴더를 더하면 기준을 잡고, 같은 폴더는 다시 더하지 않습니다", () => {
    const added = addFolder(emptyDoorstep, dl, read(["옛날.pdf"]));
    expect(added.folders).toEqual([dl]);
    expect(added.seen[dl]).toEqual(["옛날.pdf"]);
    expect(added.items).toEqual([]);
    expect(addFolder(added, dl, read([]))).toBe(added);
  });

  it("폴더를 빼면 그 폴더의 기록과 문서가 함께 빠집니다", () => {
    const state = settleFolder(opened([]), dl, read(["a.pdf"], [file("a.pdf")]), now);
    expect(removeFolder(state, dl)).toEqual({ ...emptyDoorstep, readAt: state.readAt });
  });

  it("그대로 두면 줄에서만 빠지고 다시 올라오지 않습니다", () => {
    const state = settleFolder(opened([]), dl, read(["a.pdf"], [file("a.pdf")]), now);
    const dropped = dropItem(state, state.items[0].id);
    expect(dropped.items).toEqual([]);
    expect(settleFolder(dropped, dl, read(["a.pdf"]), now).items).toEqual([]);
  });

  it("되돌리면 줄로 돌아옵니다. 폴더를 뺐으면 돌아오지 않아요", () => {
    const state = settleFolder(opened([]), dl, read(["a.pdf"], [file("a.pdf")]), now);
    const item = state.items[0];
    const dropped = dropItem(state, item.id);
    expect(restoreItem(dropped, item).items).toEqual([item]);
    expect(restoreItem(state, item)).toBe(state);
    expect(restoreItem(removeFolder(dropped, dl), item).items).toEqual([]);
  });
});

describe("현관 보여 주기", () => {
  const items = settleFolder(opened([]), dl, read(["옛.pdf", "새.pdf"], [file("옛.pdf", now - dayMs), file("새.pdf", now)]), now).items;

  it("최근 문서가 앞에 옵니다", () => {
    expect(newestFirst(items).map((item) => item.path)).toEqual(["새.pdf", "옛.pdf"]);
  });

  it("줄 제목은 가장 오래 기다린 문서 기준입니다", () => {
    expect(doorTitle(items, now)).toBe("어제부터 새 문서 2개");
    expect(doorTitle(items, now - dayMs)).toBe("오늘 새 문서 2개");
    expect(doorTitle(items, now + dayMs)).toBe("2일 전부터 새 문서 2개");
  });
});

describe("현관 새로 읽기", () => {
  beforeEach(() => {
    disk.state = emptyDoorstep;
    disk.folders.clear();
    disk.rooms.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("폴더가 없으면 아무것도 읽지 않습니다", async () => {
    expect(await refreshDoorstep(now)).toEqual({ state: emptyDoorstep, failed: 0 });
  });

  it("읽은 뒤 새 문서를 올리고 읽은 시각을 남깁니다", async () => {
    disk.state = opened(["있던.pdf"]);
    disk.folders.set(dl, source([{ name: "있던.pdf" }, { name: "새.pdf" }], { "새.pdf": now }));
    const { state, failed } = await refreshDoorstep(now);
    expect(failed).toBe(0);
    expect(state.items.map((item) => item.path)).toEqual(["새.pdf"]);
    expect(state.readAt).toBe(now);
    expect(disk.state).toEqual(state);
  });

  it("못 읽은 폴더는 줄과 목록을 그대로 두고, 다음에 켜면 다시 잡습니다", async () => {
    const waiting = settleFolder(opened([]), dl, read(["기다림.pdf"], [file("기다림.pdf")]), now);
    disk.state = waiting;
    const { state, failed } = await refreshDoorstep(now + dayMs);
    expect(failed).toBe(1);
    expect(state.items).toEqual(waiting.items);
    expect(state.seen).toEqual(waiting.seen);
    expect(state.readAt).toBe(waiting.readAt);
  });

  it("폴더를 더할 때 기준을 잡아, 있던 파일은 새 문서가 아닙니다", async () => {
    disk.folders.set(dl, source([{ name: "옛날.pdf" }]));
    const { state, error } = await addDoorFolder(dl);
    expect(error).toBeNull();
    expect(state.folders).toEqual([dl]);
    expect(state.items).toEqual([]);
    disk.folders.set(dl, source([{ name: "옛날.pdf" }, { name: "새.pdf" }], { "새.pdf": now }));
    expect((await refreshDoorstep(now)).state.items.map((item) => item.path)).toEqual(["새.pdf"]);
  });

  it("이미 방으로 연결한 폴더는 받지 않습니다", async () => {
    disk.rooms.push({ origin: dl });
    const { state, error } = await addDoorFolder(dl);
    expect(error).toBe("이미 방으로 연결한 폴더예요.");
    expect(state.folders).toEqual([]);
  });
});

describe("방으로 옮기기", () => {
  const roomPath = "/Users/me/Projects/졸업";
  let downloads: MemoryDir;
  let room: MemoryDir;
  let item: DoorItem;

  beforeEach(() => {
    downloads = seed({ "보고서.pdf": "내 문서" });
    room = seed({ "기존.txt": "그대로" });
    disk.dirs.clear();
    disk.dirs.set(dl, view(downloads));
    disk.dirs.set(roomPath, view(room));
    disk.state = settleFolder(opened([]), dl, read(["보고서.pdf"], [file("보고서.pdf")]), now);
    item = disk.state.items[0];
  });

  it("파일을 방 폴더로 옮기고 줄과 목록에서 뺍니다", async () => {
    const { state, moved, error } = await assignDoorItem(item, roomPath);
    expect(error).toBeNull();
    expect(moved).toEqual({ folder: roomPath, name: "보고서.pdf" });
    expect(downloads.files.has("보고서.pdf")).toBe(false);
    expect(room.files.get("보고서.pdf")).toBe("내 문서");
    expect(state.items).toEqual([]);
    expect(state.seen[dl]).toEqual([]);
  });

  it("같은 이름이 있으면 덮어쓰지 않고 번호를 붙입니다", async () => {
    room.files.set("보고서.pdf", "먼저 있던 문서");
    const { moved } = await assignDoorItem(item, roomPath);
    expect(moved?.name).toBe("보고서 (2).pdf");
    expect(room.files.get("보고서.pdf")).toBe("먼저 있던 문서");
    expect(room.files.get("보고서 (2).pdf")).toBe("내 문서");
  });

  it("옮기지 못하면 파일과 줄을 그대로 둡니다", async () => {
    disk.dirs.set(dl, view(downloads, false));
    const { state, moved, error } = await assignDoorItem(item, roomPath);
    expect(moved).toBeNull();
    expect(error).toBe("이 브라우저는 파일 이동을 지원하지 않아요.");
    expect(downloads.files.get("보고서.pdf")).toBe("내 문서");
    expect(state.items).toEqual([item]);
  });

  it("다른 디스크면 이유를 알리고, 복사해서 우회하지 않습니다", async () => {
    const stuck = view(downloads);
    disk.dirs.set(dl, {
      ...stuck,
      getFileHandle: async () => ({
        move: async () => {
          throw "Cross-device link (os error 18)";
        },
      }),
    });
    const { moved, error } = await assignDoorItem(item, roomPath);
    expect(moved).toBeNull();
    expect(error).toContain("다른 디스크");
    expect(downloads.files.get("보고서.pdf")).toBe("내 문서");
    expect(room.files.has("보고서.pdf")).toBe(false);
  });

  it("파일이 이미 없으면 줄에서 뺍니다", async () => {
    downloads.files.delete("보고서.pdf");
    const { state, moved, error } = await assignDoorItem(item, roomPath);
    expect(moved).toBeNull();
    expect(error).toBe("원래 파일을 찾지 못했어요.");
    expect(state.items).toEqual([]);
  });

  it("되돌리면 원래 이름으로 현관에 돌아오고, 다음에 읽어도 새 문서가 되지 않습니다", async () => {
    room.files.set("보고서.pdf", "먼저 있던 문서");
    const { moved } = await assignDoorItem(item, roomPath);
    const { state, error } = await undoDoorMove(item, moved!);
    expect(error).toBeNull();
    expect(downloads.files.get("보고서.pdf")).toBe("내 문서");
    expect(room.files.has("보고서 (2).pdf")).toBe(false);
    expect(room.files.get("보고서.pdf")).toBe("먼저 있던 문서");
    expect(state.items).toEqual([item]);
    expect(state.seen[dl]).toEqual(["보고서.pdf"]);
  });

  it("되돌릴 자리에 새 파일이 있으면 덮어쓰지 않습니다", async () => {
    const { moved } = await assignDoorItem(item, roomPath);
    downloads.files.set("보고서.pdf", "새로 받은 문서");
    const { state, error } = await undoDoorMove(item, moved!);
    expect(error).toBe("옮길 자리에 같은 이름의 파일이 있어요.");
    expect(downloads.files.get("보고서.pdf")).toBe("새로 받은 문서");
    expect(room.files.get("보고서.pdf")).toBe("내 문서");
    expect(state.items).toEqual([]);
  });

  it("옮긴 뒤 저장 전에 꺼져도, 다음에 읽으면 줄에서 빠집니다", () => {
    expect(settleFolder(disk.state, dl, read([]), now).items).toEqual([]);
  });

  it("옮긴 뒤 같은 이름을 다시 받으면 새 문서입니다", async () => {
    await assignDoorItem(item, roomPath);
    const again = await readDoorFolder(source([{ name: "보고서.pdf" }], { "보고서.pdf": now }), disk.state.seen[dl]);
    expect(again.found.map((found) => found.name)).toEqual(["보고서.pdf"]);
  });

  it("폴더 바로 아래 파일만 옮깁니다", async () => {
    const from = view(downloads);
    const to = view(room);
    expect(await moveDoorFile(from, "../보고서.pdf", to, "보고서.pdf")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await moveDoorFile(from, "보고서.pdf", to, "하위/보고서.pdf")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await moveDoorFile(from, "보고서.pdf", to, "_Folduct 정리상자/보고서.pdf")).toMatchObject({ ok: false, reason: "invalid" });
    expect(downloads.files.has("보고서.pdf")).toBe(true);
  });
});

describe("작업 중인 방으로 가져오기", () => {
  const roomPath = "/Users/me/Projects/졸업";
  const target = { id: "r", name: "졸업", source: "handle", origin: roomPath, things: [], workDays: [], scan: { complete: true, failed: 0, at: 0, freedBytes: 0 }, care: { done: false, staleAfterDays: 30 } } as unknown as Room;
  let downloads: MemoryDir;
  let room: MemoryDir;
  let item: DoorItem;

  beforeEach(() => {
    downloads = seed({ "보고서.pdf": "내 문서" });
    room = seed({});
    disk.dirs.set(dl, view(downloads));
    disk.dirs.set(roomPath, view(room));
    disk.scanned = room;
    disk.scanFails = false;
    disk.patched = target;
    disk.state = settleFolder(opened([]), dl, read(["보고서.pdf"], [file("보고서.pdf")]), now);
    item = disk.state.items[0];
  });

  it("파일을 방 폴더로 옮기고 방 목록에도 바로 올려요", async () => {
    const { moved, error } = await bringIntoRoom(item, target);
    expect(error).toBeNull();
    expect(moved).toEqual({ folder: roomPath, name: "보고서.pdf" });
    expect(room.files.get("보고서.pdf")).toBe("내 문서");
    expect(downloads.files.has("보고서.pdf")).toBe(false);
    expect(disk.patched!.things.map((thing) => thing.path)).toEqual(["보고서.pdf"]);
  });

  it("방 목록을 못 맞춰도 옮긴 결과는 그대로예요", async () => {
    disk.scanFails = true;
    const { moved, error } = await bringIntoRoom(item, target);
    expect(error).toBeNull();
    expect(moved).not.toBeNull();
    expect(room.files.has("보고서.pdf")).toBe(true);
  });

  it("되돌리면 원래 폴더로 돌아가고 방 목록에서도 빠져요", async () => {
    const { moved } = await bringIntoRoom(item, target);
    const { state, error } = await undoBring(item, moved!, target);
    expect(error).toBeNull();
    expect(downloads.files.get("보고서.pdf")).toBe("내 문서");
    expect(room.files.has("보고서.pdf")).toBe(false);
    expect(state.items.map((entry) => entry.id)).toEqual([item.id]);
    expect(disk.patched!.things).toEqual([]);
  });

  it("넣을 때 밖에서 이름을 바꾼 옛 물건과 이어졌다면, 되돌려도 그 물건의 메모와 자리는 남아요", async () => {
    const old = { id: "old", path: "옛보고서.pdf", name: "옛보고서.pdf", kind: "pdf", size: 10, lastModified: 1, lastUsedAt: null, missing: false, spot: { x: 2, y: 2 }, note: "제출본", touchedAt: null, pinned: true, box: null } as Room["things"][number];
    const before = { ...target, things: [old] };
    disk.patched = before;
    const { moved } = await bringIntoRoom(item, before);
    expect(disk.patched!.things).toMatchObject([{ id: "old", path: "보고서.pdf" }]);
    await undoBring(item, moved!, before);
    expect(disk.patched!.things).toEqual([{ ...old, missing: true }]);
  });
});

describe("문서를 받을 수 있는 방", () => {
  const base = { things: [], care: { done: false, staleAfterDays: 30 }, workDays: [] as string[], createdAt: 1, source: "handle" };
  const room = (id: string, extra: Record<string, unknown> = {}) => ({ ...base, id, name: id, origin: `/p/${id}`, ...extra }) as unknown as Room;
  const item = { folder: dl } as DoorItem;

  it("실제 폴더가 있는 진행 중인 방만, 최근 쓴 방부터 보여 줍니다", () => {
    const rooms = [
      room("옛방", { workDays: ["2026-01-01"] }),
      room("최근방", { workDays: ["2026-10-30", "2026-11-01"] }),
      room("샘플", { source: "sample" }),
      room("가져온방", { source: "input" }),
      room("경로없음", { origin: undefined }),
      room("완료방", { care: { ...base.care, done: true } }),
      room("현관과같은방", { origin: dl.normalize("NFD") }),
    ];
    expect(doorTargets(rooms, item).map((target) => target.id)).toEqual(["최근방", "옛방"]);
  });
});

describe("현관 저장값", () => {
  it("저장한 적이 없으면 기본값입니다", () => {
    expect(normalizeDoorstep(undefined)).toEqual(emptyDoorstep);
  });

  it("모양이 어긋난 칸은 기본값으로 채우고 멀쩡한 칸은 지킵니다", () => {
    expect(normalizeDoorstep({ folders: "x", seen: 3, items: null, readAt: "어제" })).toEqual(emptyDoorstep);
    expect(normalizeDoorstep({ folders: [dl], readAt: now })).toEqual({ ...emptyDoorstep, folders: [dl], readAt: now });
  });
});
