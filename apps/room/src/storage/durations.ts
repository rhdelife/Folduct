import { useEffect, useReducer } from "react";
import { secondsKey, type ShelfItem } from "../domain/shelves";
import { readFolderFile, videoSeconds, type Folder } from "../gateways/native";
import { readVideo } from "./videoFiles";

// 서랍장 영상 길이 조건에 쓰는 길이 표(파일 → 초, 모르면 null). 앱을 켜 둔 동안만 기억해요. 파일을 고치면 열쇠가 바뀌어 다시 읽어요.
const known = new Map<string, number | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
const chunk = 200;
const browserQueue: (() => Promise<void>)[] = [];
let browserRunning = 0;

function runBrowserQueue() {
  while (browserRunning < 3 && browserQueue.length) {
    const next = browserQueue.shift()!;
    browserRunning++;
    void next().finally(() => {
      browserRunning--;
      runBrowserQueue();
    });
  }
}

function remember(items: ShelfItem[], values: (number | null)[]) {
  items.forEach((item, index) => {
    known.set(secondsKey(item), values[index] ?? null);
    pending.delete(secondsKey(item));
  });
  listeners.forEach((listener) => listener());
}

// on일 때만 읽어요. 데스크톱은 영상 메타데이터를, 브라우저는 연결한 File의 길이를 읽어요.
export function useVideoSeconds(items: ShelfItem[], folders: Map<string, Folder>, on: boolean): { seconds: Map<string, number | null>; version: number } {
  const [version, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!on) return;
    listeners.add(bump);
    const byRoom = new Map<string, ShelfItem[]>();
    for (const item of items) {
      const key = secondsKey(item);
      const folder = folders.get(item.room.id);
      if (item.thing.kind !== "video" || !folder || known.has(key) || pending.has(key)) continue;
      pending.add(key);
      if (typeof folder === "string") {
        const grouped = byRoom.get(folder) ?? [];
        grouped.push(item);
        byRoom.set(folder, grouped);
      } else {
        browserQueue.push(async () => {
          const seconds = await readFolderFile(folder, item.thing.path)
            .then((file) => readVideo(file, "loadedmetadata", ({ duration }) => Number.isFinite(duration) && duration >= 0 ? duration : null))
            .catch(() => null);
          remember([item], [seconds]);
        });
      }
    }
    runBrowserQueue();
    for (const [folder, list] of byRoom) {
      for (let start = 0; start < list.length; start += chunk) {
        const part = list.slice(start, start + chunk);
        videoSeconds(folder, part.map((item) => item.thing.path))
          .catch(() => part.map(() => null))
          .then((values) => remember(part, values));
      }
    }
    return () => void listeners.delete(bump);
  }, [items, folders, on]);
  return { seconds: known, version };
}
