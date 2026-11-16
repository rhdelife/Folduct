import { useEffect, useSyncExternalStore } from "react";
import type { PaperArt } from "../art/paperArts";
import { emptyKindIcons, iconArt, type KindIconStore } from "../domain/kindIcon";
import type { Kind } from "../domain/model";
import { getKindIcons, setKindIcons } from "./db";

// 형식 아이콘 보관함을 한 번 읽어 두고, 저장하면 그 형식 종이를 그린 모든 화면이 같이 바뀌어요.
let store: KindIconStore = emptyKindIcons;
let arts: Partial<Record<Kind, PaperArt>> = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

function apply(next: KindIconStore) {
  store = next;
  arts = {};
  for (const [kind, id] of Object.entries(next.use) as [Kind, string][]) {
    const icon = next.icons.find((item) => item.id === id);
    if (icon) arts[kind] = iconArt(icon);
  }
  listeners.forEach((listener) => listener());
}

function load() {
  // 테스트처럼 저장소가 없는 곳에서는 기본 종이만 써요.
  if (typeof indexedDB === "undefined") return;
  loading ??= getKindIcons().then(apply, (cause: unknown) => {
    loading = null;
    console.error(cause);
  });
}

export function useKindIcons(): KindIconStore {
  useEffect(load, []);
  return useSyncExternalStore(subscribe, () => store, () => store);
}

// 이 형식에 쓰기로 고른 아이콘의 종이. 없으면 undefined(기본 종이)예요.
export function useKindArt(kind: Kind): PaperArt | undefined {
  useEffect(load, []);
  return useSyncExternalStore(subscribe, () => arts[kind], () => undefined);
}

export async function saveKindIcons(next: KindIconStore): Promise<void> {
  await setKindIcons(next);
  apply(next);
}
