import { useEffect, useReducer } from "react";
import { secondsKey, type ShelfItem } from "../domain/shelves";
import { videoSeconds, type Folder } from "../gateways/native";

// 서랍장 영상 길이 조건에 쓰는 길이 표(파일 → 초, 모르면 null). 앱을 켜 둔 동안만 기억해요. 파일을 고치면 열쇠가 바뀌어 다시 읽어요.
const known = new Map<string, number | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
const chunk = 200;

// on일 때만 읽어요. 데스크톱에서 폴더를 연결한 방의 영상만 읽을 수 있어요. version은 새로 읽힐 때마다 올라가요.
export function useVideoSeconds(items: ShelfItem[], folders: Map<string, Folder>, on: boolean): { seconds: Map<string, number | null>; version: number } {
  const [version, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!on) return;
    listeners.add(bump);
    const byRoom = new Map<string, ShelfItem[]>();
    for (const item of items) {
      const key = secondsKey(item);
      if (item.thing.kind !== "video" || typeof folders.get(item.room.id) !== "string" || known.has(key) || pending.has(key)) continue;
      pending.add(key);
      byRoom.set(item.room.id, [...(byRoom.get(item.room.id) ?? []), item]);
    }
    for (const [roomId, list] of byRoom) {
      const folder = folders.get(roomId) as string;
      for (let start = 0; start < list.length; start += chunk) {
        const part = list.slice(start, start + chunk);
        videoSeconds(folder, part.map((item) => item.thing.path))
          .catch(() => part.map(() => null))
          .then((values) => {
            part.forEach((item, index) => {
              known.set(secondsKey(item), values[index] ?? null);
              pending.delete(secondsKey(item));
            });
            listeners.forEach((listener) => listener());
          });
      }
    }
    return () => void listeners.delete(bump);
  }, [items, folders, on]);
  return { seconds: known, version };
}
