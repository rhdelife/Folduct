import type { Thing } from "./model";

// 버전 묶기: '포스터.png'·'포스터_v2.png'·'포스터_최종.png'·'포스터_최최종 (1).png'처럼 같은 파일을 여러 번 저장한 것을 한 묶음으로 봐요.
// 화면에서만 묶어요. 파일은 옮기거나 이름을 바꾸지 않아요.

// 이름 끝에서 떼어 낼 꼬리. 한 번에 하나씩, 더 뗄 게 없을 때까지 반복해요('포스터_최종_v2' → '포스터_최종' → '포스터').
// 영어 낱말은 앞에 구분자가 있어야 떼요('nav2'의 v2는 버전이 아니에요). 한국어는 붙여 쓰는 일이 많아 구분자 없이도 떼요.
// '-1'·'_2'처럼 숫자만 붙은 꼬리는 떼지 않아요. 1장·2장, slide-1·slide-2처럼 버전이 아닌 한 벌인 경우가 많아서예요.
// v·ver·rev 번호는 가운데 있어도 거기서 잘라요('presentation_v7_6slides', 'composition-v2-renaissance' → 그 앞까지).
const versionToken = /(^|[\s._-])(v|ver|rev|version)\.?\s*\d+([\s._-].*)?$/i;
const tails = [
  versionToken,
  /[\s._-]*\(\d+\)$/, // (1) 받은 파일 겹침
  /\s+\d+$/, // '파일 2' macOS 복사본
  /(^|[\s._-]+)(copy|사본|복사본)(\s*\d+)?$/i,
  /[\s._-]*(진짜|찐)?(최)*최종(본)?\d*$/,
  /(^|[\s._-]+)final\d*$/i,
  /[\s._-]*(수정본?|초안)\d*$/,
  /(^|[\s._-]+)(edit|edited|fix|fixed|draft)\d*$/i,
  /[\s._-]+\d{6}(\d{2})?$/, // 251103, 20251103
  /[\s._-]+\d{4}-\d{2}-\d{2}$/,
];

export function versionStem(name: string): string {
  const clean = name.normalize("NFC").toLowerCase();
  const dot = clean.lastIndexOf(".");
  let stem = dot > 0 ? clean.slice(0, dot) : clean;
  for (let changed = true; changed; ) {
    changed = false;
    for (const tail of tails) {
      const next = stem.replace(tail, "");
      if (next !== stem) {
        stem = next;
        changed = true;
      }
    }
  }
  return stem.replace(/[\s._-]+$/, "");
}

const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// 폴더 열쇠: 버전 번호가 붙은 폴더는 버전 없는 형제 폴더와 같은 자리로 봐요.
// output/comic, output/comic-rough-marker-v2, output/comic-final-style-v4 → 모두 output/comic. 형제가 없으면 번호 앞까지(x-v1, x-v2 → x).
function folderKeys(dirs: Iterable<string>): Map<string, string> {
  const unique = [...new Set(dirs)];
  const siblings = new Map<string, string[]>();
  for (const dir of unique) {
    const parent = dirOf(dir);
    siblings.set(parent, [...(siblings.get(parent) ?? []), baseOf(dir).normalize("NFC").toLowerCase()]);
  }
  const keys = new Map<string, string>();
  for (const dir of unique) {
    const parent = dirOf(dir);
    const base = baseOf(dir).normalize("NFC").toLowerCase();
    if (!dir || !versionToken.test(base)) {
      keys.set(dir, `${parent}/${base}`);
      continue;
    }
    const plain = (siblings.get(parent) ?? []).filter((other) => other !== base && base.startsWith(other) && /[\s._-]/.test(base[other.length] ?? "")).sort((a, b) => a.length - b.length)[0];
    keys.set(dir, `${parent}/${plain ?? base.replace(versionToken, "")}`);
  }
  return keys;
}

// 두 개 이상인 계열만 돌려줘요(계열 열쇠 → 새것부터 고친 순서). 같은 폴더(또는 버전 형제 폴더)·같은 형식·같은 줄기면 같은 계열이에요.
// 다른 폴더의 README.md끼리는 묶이지 않아요. 상자에 든 파일은 넣지 않아요.
export function groupVersions(things: Thing[]): Map<string, Thing[]> {
  const live = things.filter((thing) => !thing.box);
  const folders = folderKeys(live.map((thing) => dirOf(thing.path)));
  const all = new Map<string, Thing[]>();
  for (const thing of live) {
    const key = `${folders.get(dirOf(thing.path))}\n${thing.kind}\n${versionStem(thing.name)}`;
    all.set(key, [...(all.get(key) ?? []), thing]);
  }
  const groups = new Map<string, Thing[]>();
  for (const [key, list] of all) if (list.length > 1) groups.set(key, list.sort((a, b) => b.lastModified - a.lastModified));
  return groups;
}

// 이 파일이 든 계열. 혼자면 undefined예요.
export const seriesOf = (things: Thing[], thing: Thing): Thing[] | undefined => [...groupVersions(things).values()].find((list) => list.some((item) => item.id === thing.id));
