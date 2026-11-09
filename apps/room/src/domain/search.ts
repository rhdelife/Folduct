import { matchesName, type Thing } from "./model";

export const isSearching = (query: string): boolean => query.trim() !== "";

// 방 안 찾기는 경로 전체를 봐요. 폴더 이름(rt89, calculation_pack)으로도 찾을 수 있어요.
// 상자에 든 파일은 원래 경로로 봐요. 상자 폴더 이름(_Folduct 정리상자)에 '정리'·'상자'가 들어 있어 모든 상자 파일이 걸리지 않게요.
const searchPath = (thing: Thing): string => thing.box?.fromPath ?? thing.path;
export const matchesPath = (thing: Thing, query: string): boolean => matchesName(searchPath(thing), query);

// 찾은 파일 순서: 이름에 낱말이 다 있는 파일 → 폴더 이름으로만 맞은 파일. 같으면 얕은(맨 위에 가까운) 파일, 그다음 큰 파일이에요.
export function searchOrder(query: string): (a: Thing, b: Thing) => number {
  const rank = (thing: Thing) => (matchesName(thing.name, query) ? 0 : 1000) + searchPath(thing).split("/").length;
  return (a, b) => rank(a) - rank(b) || b.size - a.size;
}
