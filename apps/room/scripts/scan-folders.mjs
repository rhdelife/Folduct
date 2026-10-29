#!/usr/bin/env node
// 여러 작업 폴더의 파일 목록(이름·크기·고친 시각)만 읽어 Folduct '가져오기' 파일로 만듭니다. 파일 내용은 읽지 않습니다.
// 사용: node apps/room/scripts/scan-folders.mjs --out ~/Downloads/folduct-rooms.json ~/프로젝트1 ~/프로젝트2 ...
import { lstat, opendir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

// 앱의 폴더 읽기(src/gateways/folder.ts)와 같은 규칙입니다.
const limits = { files: 1000, depth: 10 };
const excluded = (name) => name.startsWith(".") || name === "node_modules";

async function scan(root) {
  const result = { files: [], failed: 0, complete: true, note: null };
  const full = () => result.files.length >= limits.files;
  async function walk(dir, parent, level) {
    let listing;
    try {
      listing = await opendir(dir);
    } catch {
      result.failed += 1;
      return;
    }
    for await (const entry of listing) {
      if (excluded(entry.name)) continue;
      // 바로가기(심볼릭 링크)는 폴더 밖으로 이어질 수 있어 건너뜁니다.
      if (entry.isSymbolicLink()) continue;
      const name = entry.name.normalize("NFC");
      const path = parent ? `${parent}/${name}` : name;
      if (entry.isDirectory()) {
        if (level >= limits.depth) {
          result.complete = false;
          result.note = `깊이 ${limits.depth}을 넘는 폴더는 넣지 않았어요.`;
          continue;
        }
        await walk(join(dir, entry.name), path, level + 1);
        if (full()) return;
        continue;
      }
      if (!entry.isFile()) continue;
      if (full()) {
        result.complete = false;
        result.note = `파일 ${limits.files.toLocaleString("ko-KR")}개까지만 방에 들였어요.`;
        return;
      }
      try {
        const info = await lstat(join(dir, entry.name));
        result.files.push({ path, name, size: info.size, lastModified: Math.round(info.mtimeMs) });
      } catch {
        result.failed += 1;
      }
    }
  }
  await walk(root, "", 0);
  return result;
}

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
if (outAt < 0 || !args[outAt + 1]) {
  console.error("사용: node scan-folders.mjs --out <결과.json> <폴더>...");
  process.exit(1);
}
const out = resolve(args[outAt + 1]);
const folders = args.filter((_, i) => i !== outAt && i !== outAt + 1).map((folder) => resolve(folder));

const rooms = [];
for (const origin of folders) {
  const info = await lstat(origin).catch(() => null);
  if (!info?.isDirectory()) {
    console.error(`건너뜀(폴더 아님): ${origin}`);
    continue;
  }
  const result = await scan(origin);
  rooms.push({ name: basename(origin).normalize("NFC"), origin, ...result });
  console.error(`${basename(origin)}: 파일 ${result.files.length}개${result.complete ? "" : " (일부)"}${result.failed ? `, 못 읽음 ${result.failed}` : ""}`);
}
await writeFile(out, JSON.stringify({ kind: "folduct-rooms", version: 1, exportedAt: Date.now(), rooms }));
console.error(`방 ${rooms.length}개 → ${out}`);
