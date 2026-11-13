import { normalizeWorkLog, type WorkLog } from "../domain/worklog";
import { normalizePet, normalizeSession, type PetSettings, type Session } from "../domain/session";
import { normalizeCare } from "../domain/care";
import { emptyDoorstep, normalizeDoorstep, type Doorstep } from "../domain/doorstep";
import { normalizeFace } from "../domain/face";
import { storedKind, type Room, type Thing } from "../domain/model";

// 이 브라우저 안에만 저장합니다. 파일 내용은 저장하지 않고 이름·크기·자리·메모만 둡니다.
const name = "folduct-room";
// WebKit의 IndexedDB는 가끔 답 없이 멈춥니다. 빈 화면에 갇히지 않게 실패로 돌려 '다시 시도'를 보여 줘요.
const openTimeoutMs = 10_000;
let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      opening = null;
      reject(new Error("저장소가 응답하지 않아요."));
    }, openTimeoutMs);
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("rooms", { keyPath: "id" });
      db.createObjectStore("handles");
      db.createObjectStore("meta");
    };
    request.onsuccess = () => {
      clearTimeout(timer);
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
      clearTimeout(timer);
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

export async function run<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  const tx = db.transaction(store, mode);
  const request = action(tx.objectStore(store));
  await settle(tx);
  return request.result as T;
}

export async function listRooms(): Promise<Room[]> {
  const rooms = await run<unknown[]>("rooms", "readonly", (store) => store.getAll());
  // 읽을 수 없는 기록 하나 때문에 다른 방까지 못 보게 하지 않습니다. 저장된 기록은 지우지 않고 건너뛰기만 해요.
  // 내 방이 먼저, 샘플은 뒤예요. 샘플은 새 파일 줄을 보이려고 하루 전에 만든 것으로 저장돼, 날짜만 보면 새로고침 뒤 내 방 앞으로 왔어요.
  const sampleLast = (room: Room) => (room.source === "sample" ? 1 : 0);
  return rooms.filter(isRoomRecord).map(normalizeRoom).sort((a, b) => sampleLast(a) - sampleLast(b) || a.createdAt - b.createdAt);
}

export async function getRoom(id: string): Promise<Room | null> {
  const room = await run<unknown>("rooms", "readonly", (store) => store.get(id));
  return isRoomRecord(room) ? normalizeRoom(room) : null;
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
    if (!isRoomRecord(request.result)) return;
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
  await deleteRoomMark(id);
  await run("meta", "readwrite", (store) => store.delete(roomPictures(id)));
  await run("meta", "readwrite", (store) => store.delete(IDBKeyRange.bound(`ai:${id}:`, `ai:${id}:\uffff`)));
}

// 파일마다 사용자가 고른 그림. 방 기록을 자주 저장하니 무거운 그림은 따로, 저장소를 새로 만들지 않고 meta에 `pic:<방 id>:<물건 id>` 키로 둡니다.
// Blob 대신 바이트로 둡니다. WebKit IndexedDB의 Blob 저장은 버전마다 말썽이 있었어요.
export type StoredPicture = { type: string; bytes: ArrayBuffer };
export type RoomPicture = { room: string; thing: string; picture: StoredPicture };

const pictureKey = (room: string, thing: string) => `pic:${room}:${thing}`;
const roomPictures = (room: string) => IDBKeyRange.bound(`pic:${room}:`, `pic:${room}:￿`);

export const isStoredPicture = (value: unknown): value is StoredPicture => {
  const picture = value as Partial<StoredPicture> | null | undefined;
  return typeof picture?.type === "string" && picture.type.startsWith("image/") && picture.bytes instanceof ArrayBuffer && picture.bytes.byteLength > 0;
};

// 물건 id는 UUID라 콜론이 없어요. 마지막 콜론 앞이 방 id입니다.
export function parsePictureKey(key: unknown): { room: string; thing: string } | null {
  if (typeof key !== "string" || !key.startsWith("pic:")) return null;
  const cut = key.lastIndexOf(":");
  const room = key.slice(4, cut);
  const thing = key.slice(cut + 1);
  return cut > 4 && room && thing ? { room, thing } : null;
}

export async function listPictures(): Promise<RoomPicture[]> {
  const db = await open();
  const tx = db.transaction("meta", "readonly");
  const store = tx.objectStore("meta");
  const range = IDBKeyRange.bound("pic:", "pic:￿");
  const keys = store.getAllKeys(range);
  const values = store.getAll(range);
  await settle(tx);
  // 망가진 기록은 건너뛰기만 하고 지우지 않아요.
  return keys.result.flatMap((key, at) => {
    const id = parsePictureKey(key);
    const picture = values.result[at];
    return id && isStoredPicture(picture) ? [{ ...id, picture }] : [];
  });
}

export function putPicture(room: string, thing: string, picture: StoredPicture): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(picture, pictureKey(room, thing)));
}

export function deletePicture(room: string, thing: string): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.delete(pictureKey(room, thing)));
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

// 메뉴 막대 작은 창에 '이번 주 정리'를 마지막으로 알린 때. 한 주에 한 번만 알려요.
export async function getSweepNoticeAt(): Promise<number | null> {
  const at = await run<unknown>("meta", "readonly", (store) => store.get("sweepNoticeAt"));
  return typeof at === "number" ? at : null;
}

export function setSweepNoticeAt(at: number): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(at, "sweepNoticeAt"));
}

// 끈 적이 없으면 켜져 있습니다.
export async function getSession(): Promise<Session | null> {
  return normalizeSession(await run<unknown>("meta", "readonly", (store) => store.get("session")));
}

export function saveSession(session: Session | null): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(session, "session"));
}

export async function getPetSettings(): Promise<PetSettings> {
  return normalizePet(await run<unknown>("meta", "readonly", (store) => store.get("pet")));
}

export function savePetSettings(pet: PetSettings): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(pet, "pet"));
}

export async function getWorkLog(): Promise<WorkLog> {
  return normalizeWorkLog(await run<unknown>("meta", "readonly", (store) => store.get("workLog")));
}

export async function patchWorkLog(mutate: (log: WorkLog) => WorkLog): Promise<WorkLog> {
  const db = await open();
  const tx = db.transaction("meta", "readwrite");
  const store = tx.objectStore("meta");
  let saved: WorkLog = {};
  const request = store.get("workLog");
  request.onsuccess = () => {
    saved = mutate(normalizeWorkLog(request.result));
    store.put(saved, "workLog");
  };
  await settle(tx);
  return saved;
}

export async function getIntroOn(): Promise<boolean> {
  return (await run<boolean | undefined>("meta", "readonly", (store) => store.get("introOn"))) !== false;
}

export function setIntroOn(on: boolean): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(on, "introOn"));
}

// 방 오브제 이미지. 방 기록을 자주 저장하니 무거운 그림은 따로 둡니다. 저장소를 새로 만들지 않고 meta에 방별 키로 넣어요.
export function deleteRoomMark(id: string): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.delete(`mark:${id}`));
}

export async function getDoorstep(): Promise<Doorstep> {
  return normalizeDoorstep(await run<unknown>("meta", "readonly", (store) => store.get("doorstep")));
}

// patchRoom과 같은 이유로 읽기·고치기·쓰기를 한 트랜잭션에서 합니다. 폴더를 읽는 동안 사용자가 고친 값을 덮지 않아요.
export async function patchDoorstep(mutate: (state: Doorstep) => Doorstep): Promise<Doorstep> {
  const db = await open();
  const tx = db.transaction("meta", "readwrite");
  const store = tx.objectStore("meta");
  let saved = emptyDoorstep;
  const request = store.get("doorstep");
  request.onsuccess = () => {
    saved = mutate(normalizeDoorstep(request.result));
    store.put(saved, "doorstep");
  };
  await settle(tx);
  return saved;
}

const count = <T>(value: unknown, fallback: T): number | T => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);

export function isRoomRecord(value: unknown): boolean {
  const room = value as Partial<Room> | null | undefined;
  return typeof room === "object" && room !== null && typeof room.id === "string";
}

const isThingRecord = (value: unknown): boolean => {
  const thing = value as Partial<Thing> | null | undefined;
  return typeof thing?.id === "string" && typeof thing.path === "string" && typeof thing.name === "string";
};

// 예전 기록에 없는 칸은 기본값으로 채웁니다. scan은 네 칸만 다시 만들어, 예전에 같이 저장된 파일 목록 사본을 버립니다.
export function normalizeRoom(value: unknown): Room {
  const room = value as Room;
  const scan: Partial<Room["scan"]> = room.scan ?? {};
  return {
    ...room,
    name: typeof room.name === "string" && room.name ? room.name : typeof room.rootName === "string" && room.rootName ? room.rootName : "이름 없는 방",
    createdAt: count(room.createdAt, 0),
    // 그릴 수 없는 물건은 빼고, 종류·크기·시각이 망가진 물건은 고쳐서 살립니다.
    things: Array.isArray(room.things)
      ? room.things.filter(isThingRecord).map((thing) => ({ ...thing, kind: storedKind(thing.kind, thing.name), size: count(thing.size, 0), lastModified: count(thing.lastModified, 0), lastUsedAt: count(thing.lastUsedAt, null), seenAt: count(thing.seenAt, count(room.createdAt, 0)) }))
      : [],
    workDays: Array.isArray(room.workDays) ? room.workDays.filter((day) => typeof day === "string") : [],
    care: normalizeCare(room.care),
    scan: { complete: scan.complete === true, failed: count(scan.failed, 0), at: count(scan.at, room.createdAt), freedBytes: count(scan.freedBytes, 0) },
    doneOfferAt: typeof room.doneOfferAt === "number" ? room.doneOfferAt : null,
    face: normalizeFace(room.face, room.id),
    // 방 썸네일은 2026-11-13에 생겼어요. 그 전 기록이나 망가진 값은 자동(가장 최근 그림)이에요.
    cover: typeof room.cover === "string" && room.cover ? room.cover : null,
  };
}
