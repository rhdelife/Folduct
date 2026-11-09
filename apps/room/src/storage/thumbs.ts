import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import type { Room, Thing } from "../domain/model";
import { folderAccess, readFolderFile, type Folder } from "../gateways/native";
import { roomFolder } from "./box";
import { pictureSourceLimit, shrink } from "./pictures";

// 방 안 이미지 종이에 끼울 진짜 미리보기. 화면에 들어온 종이만 읽고, 앱을 켠 동안 메모리에만 둬요.
// 읽기만 해요. 사용자 폴더에 쓰지 않고, 권한을 묻지 않고, 손댄 것으로 세지 않아요.

// 80px 종이를 크게 키우거나 2배 화면에서 봐도 뭉개지지 않을 만큼.
export const thumbSide = 240;
// shortcut: 오래 만든 것부터 버리는 단순한 상한이라, 아주 큰 방에서 화면에 있던 그림이 기본 그림으로 돌아갈 수 있어요. 그게 보이면 화면에 있는 것을 빼고 버리게 바꿔요.
const keep = 400;
const atOnce = 3;
// 카메라 원본은 화면이 못 그리고 크기만 커요.
const rawEnds = ["dng", "cr2", "cr3", "nef", "arw", "raw"];

// null은 읽거나 그리지 못한 파일이에요. 다시 시도하지 않고 기본 그림으로 둬요.
const made = new Map<string, string | null>();
const pending = new Set<string>();
const queue: (() => Promise<void>)[] = [];
let running = 0;
const listeners = new Set<() => void>();

export function canThumb(thing: Pick<Thing, "kind" | "name" | "size" | "missing">): boolean {
  const end = thing.name.slice(thing.name.lastIndexOf(".") + 1).toLowerCase();
  return thing.kind === "image" && !thing.missing && thing.size > 0 && thing.size <= pictureSourceLimit && !rawEnds.includes(end);
}

// 방의 대표 이미지: 고정한 이미지 중 가장 최근에 고친 것, 없으면 가장 최근에 고친 이미지. 상자에 든 파일과 사라진 파일은 빼요.
export function coverOf(room: Pick<Room, "things">): Thing | null {
  let best: Thing | null = null;
  for (const thing of room.things) {
    if (thing.box || !canThumb(thing)) continue;
    if (!best || (thing.pinned !== best.pinned ? thing.pinned : thing.lastModified > best.lastModified)) best = thing;
  }
  return best;
}

// 파일을 고치면 수정 시각이 바뀌어 새로 읽어요.
const keyOf = (thing: Thing) => `${thing.id}:${thing.lastModified}`;

function remember(key: string, url: string | null) {
  made.set(key, url);
  for (const [old, oldUrl] of made) {
    if (made.size <= keep) break;
    made.delete(old);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }
  listeners.forEach((listener) => listener());
}

function pump() {
  while (running < atOnce && queue.length > 0) {
    const job = queue.shift()!;
    running += 1;
    void job().finally(() => {
      running -= 1;
      pump();
    });
  }
}

function request(key: string, read: () => Promise<File>) {
  if (made.has(key) || pending.has(key)) return;
  pending.add(key);
  queue.push(async () => {
    let url: string | null = null;
    try {
      const small = await shrink(await read(), thumbSide);
      url = URL.createObjectURL(new Blob([small.bytes], { type: small.type }));
    } catch {
      // HEIC를 못 그리는 화면, 깨진 파일, 그사이 사라진 파일. 기본 그림으로 둬요.
    }
    pending.delete(key);
    remember(key, url);
  });
  pump();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// folder가 없으면(샘플 방, 권한 없음) 읽지 않아요. ref의 요소가 화면 가까이 오면 그때 읽어요.
export function useThumb(ref: RefObject<Element | null>, folder: Folder | null, thing: Thing): string | undefined {
  const wanted = folder !== null && canThumb(thing);
  const key = keyOf(thing);
  const path = thing.path;
  const url = useSyncExternalStore(subscribe, () => (wanted ? made.get(key) ?? undefined : undefined), () => undefined);
  useEffect(() => {
    const element = ref.current;
    if (!wanted || !folder || !element || made.has(key)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        request(key, () => readFolderFile(folder, path));
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, wanted, folder, key, path]);
  return url;
}

// 권한을 묻지 않고 지금 읽을 수 있는 방 폴더들(방 id → 폴더). 샘플 방이나 브라우저에서 권한이 없는 방은 빠져요.
export function useReadableFolders(rooms: Room[]): Map<string, Folder> {
  const [folders, setFolders] = useState(() => new Map<string, Folder>());
  const key = rooms.map((room) => `${room.id}:${room.source}:${room.origin ?? ""}`).join();
  useEffect(() => {
    let live = true;
    const readable = async (room: Room) => {
      const found = await roomFolder(room).catch(() => null);
      return found && (await folderAccess(found).catch(() => "unknown")) === "granted" ? ([room.id, found] as const) : null;
    };
    void Promise.all(rooms.map(readable)).then((list) => live && setFolders(new Map(list.filter((entry) => entry !== null))));
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return folders;
}
