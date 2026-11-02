import { defaultCare } from "../domain/care";
import type { Room } from "../domain/model";

// 이 브라우저 안에만 저장합니다. 파일 내용은 저장하지 않고 이름·크기·자리·메모만 둡니다.
const name = "folduct-room";
let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("rooms", { keyPath: "id" });
      db.createObjectStore("handles");
      db.createObjectStore("meta");
    };
    request.onsuccess = () => {
      const db = request.result;
      // 다른 탭이 새 버전으로 열려 하면 비켜 주고, 다음 호출에서 다시 엽니다.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      // WebKit은 연결을 잃기도 합니다. 끊긴 연결을 붙잡고 있지 않습니다.
      db.onclose = () => {
        opening = null;
      };
      // 브라우저가 공간이 모자랄 때 메모·자리를 지우지 않게 부탁합니다. 거절돼도 그대로 씁니다.
      navigator.storage?.persist?.().catch(() => undefined);
      resolve(db);
    };
    request.onerror = () => {
      // 실패를 붙잡아 두지 않아야 '다시 시도'가 새로 열 수 있습니다.
      opening = null;
      reject(request.error ?? new Error("저장소를 열지 못했어요."));
    };
  });
  return opening;
}

// 저장 공간 부족은 commit 때 abort로만 오므로 abort도 실패로 돌려줍니다.
function settle(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("저장하지 못했어요."));
    tx.onabort = () => reject(tx.error ?? new DOMException("저장하지 못했어요.", "AbortError"));
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  const tx = db.transaction(store, mode);
  const request = action(tx.objectStore(store));
  await settle(tx);
  return request.result as T;
}

export async function listRooms(): Promise<Room[]> {
  const rooms = await run<unknown[]>("rooms", "readonly", (store) => store.getAll());
  return rooms.map(normalizeRoom).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getRoom(id: string): Promise<Room | null> {
  const room = await run<unknown>("rooms", "readonly", (store) => store.get(id));
  return room ? normalizeRoom(room) : null;
}

// shortcut: 탭 하나를 가정하고 방 전체를 한 번에 덮어씁니다. 두 탭에서 같은 방을 고치면 나중 저장이 이깁니다.
export function saveRoom(room: Room): Promise<unknown> {
  return run("rooms", "readwrite", (store) => store.put(room));
}

// 상자 기록처럼 일부만 바꾸는 쓰기는 읽기·고치기·쓰기를 한 트랜잭션에서 해서, 다른 쓰기가 들고 있던 옛 방으로 덮지 않습니다.
export async function patchRoom(id: string, mutate: (room: Room) => Room): Promise<Room> {
  const db = await open();
  const tx = db.transaction("rooms", "readwrite");
  const store = tx.objectStore("rooms");
  let saved = null as Room | null;
  const request = store.get(id);
  request.onsuccess = () => {
    if (!request.result) return;
    saved = mutate(normalizeRoom(request.result));
    store.put(saved);
  };
  await settle(tx);
  if (!saved) throw new Error("방 기록을 찾지 못했어요.");
  return saved;
}

// Folduct 기록만 지웁니다. 폴더와 파일은 그대로입니다.
export async function forgetRoom(id: string): Promise<void> {
  await run("rooms", "readwrite", (store) => store.delete(id));
  await run("handles", "readwrite", (store) => store.delete(id));
}

export async function getHandle(id: string): Promise<FileSystemDirectoryHandle | null> {
  return (await run<FileSystemDirectoryHandle | undefined>("handles", "readonly", (store) => store.get(id))) ?? null;
}

export function saveHandle(id: string, handle: FileSystemDirectoryHandle): Promise<unknown> {
  return run("handles", "readwrite", (store) => store.put(handle, id));
}

export async function getLastSweepAt(): Promise<number | null> {
  return (await run<number | undefined>("meta", "readonly", (store) => store.get("lastSweepAt"))) ?? null;
}

export function setLastSweepAt(at: number): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(at, "lastSweepAt"));
}

const count = <T>(value: unknown, fallback: T): number | T => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);

// 예전 기록에 없는 칸은 기본값으로 채웁니다. scan은 네 칸만 다시 만들어, 예전에 같이 저장된 파일 목록 사본을 버립니다.
export function normalizeRoom(value: unknown): Room {
  const room = value as Room;
  const scan: Partial<Room["scan"]> = room.scan ?? {};
  return {
    ...room,
    things: Array.isArray(room.things) ? room.things.map((thing) => ({ ...thing, lastUsedAt: count(thing.lastUsedAt, null) })) : [],
    workDays: Array.isArray(room.workDays) ? room.workDays : [],
    care: { ...defaultCare, ...room.care },
    scan: { complete: scan.complete === true, failed: count(scan.failed, 0), at: count(scan.at, room.createdAt), freedBytes: count(scan.freedBytes, 0) },
    budgetBytes: typeof room.budgetBytes === "number" && room.budgetBytes > 0 ? room.budgetBytes : null,
    budgetNoticeAt: typeof room.budgetNoticeAt === "number" ? room.budgetNoticeAt : null,
  };
}
