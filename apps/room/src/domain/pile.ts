import type { Thing } from "./model";

// 도구가 만들어 내는 폴더. 이 아래 파일은 사람이 찾는 결과물보다 중간 산물(렌더한 쪽 이미지, 빌드 결과, 캐시)이라 줄 뒤쪽 더미로 묶어요.
// output·exports·out은 결과물을 두는 곳일 때가 많아 넣지 않아요. dist·build는 자동 생성으로 봐요(사용자에게 물어 둔 채 정한 기본값).
const machineFolders = new Set(["tmp", "temp", "cache", "caches", "target", "build", "dist", "generated", "__pycache__", "logs", "coverage", "venv", "site-packages", "deriveddata"]);

export const isMachineFolder = (name: string): boolean => machineFolders.has(name.toLowerCase());

export type Pile = { key: string; label: string; things: Thing[]; size: number };

// 자동 생성 폴더 아래 파일이면 묶을 열쇠(그 폴더부터 두 단계 아래까지의 경로). 아니면 null이에요.
// tmp/pdfs/rt89/page-001.png → tmp/pdfs/rt89, …/target/debug/deps/x.rmeta → …/target/debug/deps
export function pileKey(path: string): string | null {
  const folders = path.split("/").slice(0, -1);
  const at = folders.findIndex(isMachineFolder);
  return at < 0 ? null : folders.slice(0, at + 3).join("/");
}

// 이름표: 자동 생성 폴더 바로 위 폴더부터(src-tauri/target/debug/deps). 다른 곳의 같은 이름 더미와 헷갈리지 않게요.
function pileLabel(key: string): string {
  const folders = key.split("/");
  return folders.slice(Math.max(0, folders.findIndex(isMachineFolder) - 1)).join("/");
}

// 줄 하나를 앞줄(사람이 찾는 파일)과 더미로 나눕니다. 고정한 파일은 늘 앞줄이에요. 들어온 순서(크기순)를 지키고, 더미는 큰 것부터예요.
export function splitLane(things: Thing[]): { front: Thing[]; piles: Pile[] } {
  const front: Thing[] = [];
  const piles = new Map<string, Pile>();
  for (const thing of things) {
    const key = thing.pinned ? null : pileKey(thing.path);
    if (key === null) {
      front.push(thing);
      continue;
    }
    const pile = piles.get(key) ?? { key, label: pileLabel(key), things: [], size: 0 };
    pile.things.push(thing);
    pile.size += thing.size;
    piles.set(key, pile);
  }
  return { front, piles: [...piles.values()].sort((a, b) => b.size - a.size || a.key.localeCompare(b.key)) };
}
