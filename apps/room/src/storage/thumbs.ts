import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { mainHue, type Hue } from "../domain/hue";
import type { Room, Thing } from "../domain/model";
import { folderAccess, readFolderFile, type Folder } from "../gateways/native";
import { roomFolder } from "./box";
import { pictureSourceLimit, shrink } from "./pictures";

// 방 안 이미지 종이에 끼울 진짜 미리보기. 화면에 들어온 종이만 읽고, 앱을 켠 동안 메모리에만 둬요.
// 읽기만 해요. 사용자 폴더에 쓰지 않고, 권한을 묻지 않고, 손댄 것으로 세지 않아요.

// 가장 큰 줄 종이(160px)를 2배 화면에서 봐도 뭉개지지 않을 만큼.
export const thumbSide = 360;
// shortcut: 오래 만든 것부터 버리는 단순한 상한이라, 아주 큰 방에서 화면에 있던 그림이 기본 그림으로 돌아갈 수 있어요. 그게 보이면 화면에 있는 것을 빼고 버리게 바꿔요.
const keep = 400;
const atOnce = 3;
// 카메라 원본은 화면이 못 그리고 크기만 커요.
const rawEnds = ["dng", "cr2", "cr3", "nef", "arw", "raw"];

// null은 읽거나 그리지 못한 파일이에요. 다시 시도하지 않고 기본 그림으로 둬요.
const made = new Map<string, string | null>();
// 미리보기에서 뽑은 가장 넓은 색. 글자 몇 개라 버리지 않아요. null은 색을 못 읽은 이미지예요.
const huesMade = new Map<string, Hue | null>();
const pending = new Set<string>();
const queue: (() => Promise<void>)[] = [];
let running = 0;
const listeners = new Set<() => void>();

export function canThumb(thing: Pick<Thing, "kind" | "name" | "size" | "missing">): boolean {
  const end = thing.name.slice(thing.name.lastIndexOf(".") + 1).toLowerCase();
  return thing.kind === "image" && !thing.missing && thing.size > 0 && thing.size <= pictureSourceLimit && !rawEnds.includes(end);
}

// 방의 대표 이미지: 고정한 이미지 중 가장 최근에 고친 것, 없으면 가장 최근에 고친 이미지. 상자에 든 파일과 사라진 파일은 빼요.
export function coverOf(room: Pick<Room, "things" | "cover">): Thing | null {
  // 방 설정에서 고른 파일이 아직 방에 있고 그릴 수 있으면 그 파일이에요. 사용자가 올린 그림은 RoomCover가 따로 그려요.
  const chosen = room.cover ? room.things.find((thing) => thing.id === room.cover && !thing.box && canThumb(thing)) : undefined;
  if (chosen) return chosen;
  let best: Thing | null = null;
  for (const thing of room.things) {
    if (thing.box || !canThumb(thing)) continue;
    if (!best || (thing.pinned !== best.pinned ? thing.pinned : thing.lastModified > best.lastModified)) best = thing;
  }
  return best;
}

// 파일을 고치면 수정 시각이 바뀌어 새로 읽어요.
const keyOf = (thing: Thing) => `${thing.id}:${thing.lastModified}`;

function remember(key: string, url: string | null, hue: Hue | null) {
  made.set(key, url);
  huesMade.set(key, hue);
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

// 24×24로 한 번 더 줄여 화소를 세요.
async function hueFrom(blob: Blob): Promise<Hue | null> {
  const bitmap = await createImageBitmap(blob, { resizeWidth: 24, resizeHeight: 24 });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 24;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context ? mainHue(context.getImageData(0, 0, 24, 24).data) : null;
}

function request(key: string, read: () => Promise<File>, force = false) {
  // 미리보기를 버렸어도 색을 이미 알면, 색만 원할 때는 다시 읽지 않아요.
  if (made.has(key) || pending.has(key) || (!force && huesMade.has(key))) return;
  pending.add(key);
  queue.push(async () => {
    let url: string | null = null;
    let hue: Hue | null = null;
    try {
      const small = await shrink(await read(), thumbSide);
      const blob = new Blob([small.bytes], { type: small.type });
      url = URL.createObjectURL(blob);
      hue = await hueFrom(blob).catch(() => null);
    } catch {
      // HEIC를 못 그리는 화면, 깨진 파일, 그사이 사라진 파일. 기본 그림으로 둬요.
    }
    pending.delete(key);
    remember(key, url, hue);
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
        request(key, () => readFolderFile(folder, path), true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, wanted, folder, key, path]);
  return url;
}

// 색으로 볼 때만 켜요(on). 화면 밖 이미지도 3장씩 읽어 색을 세요. hues는 이미지 id → 색이고, 아직 못 읽은 이미지는 빠져요. total은 색을 읽을 수 있는 이미지 수예요.
export function useHues(folder: Folder | null, things: Thing[], on: boolean): { hues: Map<string, Hue | null>; total: number } {
  return useHuesOf(folder ? things.filter((thing) => !thing.box).map((thing) => ({ folder, thing })) : [], on);
}

// 여러 방에 걸친 이미지의 색(홈 컬러별 칸). 이미지마다 그 방 폴더에서 읽어요. 이미지가 아닌 파일은 걸러요.
export function useHuesOf(list: { folder: Folder; thing: Thing }[], on: boolean): { hues: Map<string, Hue | null>; total: number } {
  const all = list.filter(({ thing }) => canThumb(thing));
  const images = on ? all : [];
  const version = useSyncExternalStore(subscribe, () => huesMade.size, () => 0);
  useEffect(() => {
    for (const { folder, thing } of images) request(keyOf(thing), () => readFolderFile(folder, thing.path));
  }, [images.map(({ thing }) => keyOf(thing)).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const found = new Map<string, Hue | null>();
  for (const { thing } of images) if (huesMade.has(keyOf(thing))) found.set(thing.id, huesMade.get(keyOf(thing))!);
  void version;
  return { hues: found, total: all.length };
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
