import type { Thing } from "./model";

// 도구가 만들어 내는 폴더. 이 아래 파일은 사람이 찾는 결과물보다 중간 산물(렌더한 쪽 이미지, 빌드 결과, 캐시)이라 줄 뒤쪽 더미로 묶어요.
// output·exports·out은 결과물을 두는 곳일 때가 많아 넣지 않아요. dist·build는 자동 생성으로 봐요(사용자에게 물어 둔 채 정한 기본값).
const machineFolders = new Set(["tmp", "temp", "cache", "caches", "target", "build", "dist", "generated", "__pycache__", "logs", "coverage", "venv", "site-packages", "deriveddata"]);

export const isMachineFolder = (name: string): boolean => machineFolders.has(name.toLowerCase());

// 사람이 옛것을 치워 둔 보관 폴더(_archive, backup, old…). 지금 쓰는 파일이 아니라서 더미로 묶어요(2026-11-10 사용자가 고름).
// 앞의 _·- 같은 표시는 떼고 봐요. 보관 폴더 안의 프로젝트 하나가 더미 하나예요(_archive/memory-desk).
const archiveFolders = new Set(["archive", "archives", "backup", "backups", "bak", "old", "legacy", "deprecated", "보관", "보관함", "백업"]);
export const isArchiveFolder = (name: string): boolean => archiveFolders.has(name.toLowerCase().replace(/^[_\-\s]+/, ""));

// 줄 뒤쪽 더미로 보내는 폴더: 자동 생성 폴더와 보관 폴더. 스캔도 이 폴더들을 맨 나중에 읽어요.
export const isBackFolder = (name: string): boolean => isMachineFolder(name) || isArchiveFolder(name);

export type Pile = { key: string; label: string; things: Thing[]; size: number; archive: boolean };

// 더미로 보낼 파일이면 묶을 열쇠, 아니면 null이에요. 자동 생성 폴더는 그 폴더부터 두 단계 아래까지, 보관 폴더는 한 단계 아래까지예요.
// tmp/pdfs/rt89/page-001.png → tmp/pdfs/rt89, …/target/debug/deps/x.rmeta → …/target/debug/deps, _archive/memory-desk/apps/a.ts → _archive/memory-desk
export function pileKey(path: string): string | null {
  const folders = path.split("/").slice(0, -1);
  const at = folders.findIndex(isBackFolder);
  return at < 0 ? null : folders.slice(0, at + (isArchiveFolder(folders[at]) ? 2 : 3)).join("/");
}

// 이름표: 더미 폴더 바로 위 폴더부터(src-tauri/target/debug/deps). 다른 곳의 같은 이름 더미와 헷갈리지 않게요.
function pileLabel(key: string): string {
  const folders = key.split("/");
  return folders.slice(Math.max(0, folders.findIndex(isBackFolder) - 1)).join("/");
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
    const pile = piles.get(key) ?? { key, label: pileLabel(key), things: [], size: 0, archive: isArchiveFolder(key.split("/").find(isBackFolder) ?? "") };
    pile.things.push(thing);
    pile.size += thing.size;
    piles.set(key, pile);
  }
  return { front, piles: [...piles.values()].sort((a, b) => b.size - a.size || a.key.localeCompare(b.key)) };
}
