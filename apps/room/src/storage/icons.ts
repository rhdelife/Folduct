import { useEffect, useSyncExternalStore } from "react";
import type { DuctIcon } from "../domain/icon";
import { getIcons, setIcons } from "./db";

// 아이콘 보관함을 한 번 읽어 두고, 저장하면 보고 있는 화면(방 카드, 방 설정, 만들기 창)이 같이 바뀌어요.
let icons: DuctIcon[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const emit = () => listeners.forEach((listener) => listener());

function load() {
  loading ??= getIcons().then(
    (saved) => {
      icons = saved;
      emit();
    },
    (cause: unknown) => {
      loading = null;
      console.error(cause);
    },
  );
}

export function useIcons(): DuctIcon[] {
  useEffect(load, []);
  return useSyncExternalStore(subscribe, () => icons, () => icons);
}

export async function saveIcons(next: DuctIcon[]): Promise<void> {
  await setIcons(next);
  icons = next;
  emit();
}
