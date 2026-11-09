import { isNewName, isPartialFile, type DoorRead } from "../domain/doorstep";
import { isSafeRelativePath, kindOf, type ScannedFile } from "../domain/model";
import { osErrorKind } from "../domain/platform";
import { isMachineFolder } from "../domain/pile";

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
    queryPermission(descriptor?: { mode?: AccessMode }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode?: AccessMode }): Promise<PermissionState>;
  }
  interface Window {
    showDirectoryPicker(options?: { mode?: AccessMode }): Promise<FileSystemDirectoryHandle>;
  }
}

export type AccessMode = "read" | "readwrite";
export type Access = "granted" | "prompt" | "denied" | "unknown";

export const scanLimits = { files: 1000, depth: 10 };

export type ScanResult = { files: ScannedFile[]; failed: number; complete: boolean; note: string | null };

// 폴더를 읽는 쪽을 추상화해 테스트에서는 메모리 폴더를 씁니다.
export type DirectorySource = {
  list(): AsyncIterable<{ name: string; kind: "file" | "directory" }>;
  file(name: string): Promise<{ size: number; lastModified: number }>;
  directory(name: string): Promise<DirectorySource>;
};

// Windows·리눅스가 드라이브와 폴더에 스스로 만드는 항목. 사용자 파일이 아니고, 일부는 읽을 수도 없어요.
const osHousekeeping = new Set(["$recycle.bin", "system volume information", "thumbs.db", "desktop.ini", "lost+found"]);

export function isExcludedName(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || osHousekeeping.has(name.toLowerCase());
}

export function canPickFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: "read" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

export async function readAccess(handle: FileSystemDirectoryHandle, mode: AccessMode = "read"): Promise<Access> {
  try {
    if (typeof handle.queryPermission !== "function") return "unknown";
    const state = await handle.queryPermission({ mode });
    return state === "granted" || state === "prompt" || state === "denied" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

// 사용자 클릭 안에서만 불러야 합니다.
export async function askAccess(handle: FileSystemDirectoryHandle, mode: AccessMode = "read"): Promise<boolean> {
  try {
    return (await handle.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

// 폴더를 못 읽은 이유. 브라우저는 DOMException, Tauri는 문자열로 거절합니다.
export function folderProblem(error: unknown): "denied" | "gone" | "other" {
  if (error instanceof DOMException) return error.name === "NotAllowedError" || error.name === "SecurityError" ? "denied" : error.name === "NotFoundError" ? "gone" : "other";
  const kind = osErrorKind(String(error));
  return kind === "denied" || kind === "gone" ? kind : "other";
}

export function handleSource(handle: FileSystemDirectoryHandle): DirectorySource {
  return {
    async *list() {
      for await (const [name, child] of handle.entries()) yield { name, kind: child.kind };
    },
    async file(name) {
      const file = await (await handle.getFileHandle(name)).getFile();
      return { size: file.size, lastModified: file.lastModified };
    },
    async directory(name) {
      return handleSource(await handle.getDirectoryHandle(name));
    },
  };
}

const readOrder = (entry: { name: string; kind: "file" | "directory" }): number => (entry.kind === "file" ? 0 : isMachineFolder(entry.name) ? 2 : 1);

export async function scanFolder(source: DirectorySource, onProgress?: (count: number) => void): Promise<ScanResult> {
  const result: ScanResult = { files: [], failed: 0, complete: true, note: null };
  // 자동 생성 폴더(tmp·target 같은)는 어느 깊이에 있든 바로 들어가지 않고 미뤄 뒀다가, 나머지를 다 읽은 뒤에 읽어요.
  // apps/…/src-tauri/target 같은 깊은 빌드 폴더가 한도를 먼저 채워 옆 폴더의 결과물을 못 읽는 일을 막아요.
  const later: { parent: DirectorySource; name: string; path: string; level: number }[] = [];
  const full = () => {
    if (result.files.length < scanLimits.files) return false;
    result.complete = false;
    result.note = `파일 ${scanLimits.files.toLocaleString("ko-KR")}개까지만 방에 들였어요.`;
    return true;
  };
  async function walk(dir: DirectorySource, parent: string, level: number): Promise<void> {
    let listing: { name: string; kind: "file" | "directory" }[] = [];
    try {
      for await (const entry of dir.list()) listing.push(entry);
    } catch (error) {
      // 방 폴더 자체를 못 읽으면(옮겨짐·드라이브 분리) 빈 폴더가 아니라 실패입니다. 하위 폴더는 세고 넘어갑니다.
      if (level === 0) throw error;
      result.failed += 1;
      return;
    }
    // 한 폴더 안에서는 파일 → 보통 폴더 → 자동 생성 폴더(tmp·build 같은) 순서로 읽어요. 한도(파일 수)가 차도 맨 위 결과물은 먼저 들어와요.
    listing = listing.sort((a, b) => readOrder(a) - readOrder(b));
    for (const entry of listing) {
      if (isExcludedName(entry.name)) continue;
      // 폴더로 내려가기 전에 봐야, 한도를 채운 뒤 남은 폴더를 더 읽지 않습니다. 위 단계도 다음 항목에서 바로 멈춥니다.
      if (full()) return;
      // 한글 이름은 NFC로 맞춰, 가져오기 스크립트(Node)가 읽은 경로와 같게 비교합니다.
      const name = entry.name.normalize("NFC");
      const path = parent ? `${parent}/${name}` : name;
      if (entry.kind === "directory") {
        if (level >= scanLimits.depth) {
          result.complete = false;
          result.note = `깊이 ${scanLimits.depth}을 넘는 폴더는 넣지 않았어요.`;
          continue;
        }
        if (isMachineFolder(entry.name)) {
          later.push({ parent: dir, name: entry.name, path, level: level + 1 });
          continue;
        }
        try {
          await walk(await dir.directory(entry.name), path, level + 1);
        } catch {
          result.failed += 1;
        }
        continue;
      }
      try {
        const info = await dir.file(entry.name);
        result.files.push({ path, name, kind: kindOf(name), size: info.size, lastModified: info.lastModified });
        onProgress?.(result.files.length);
      } catch {
        result.failed += 1;
      }
    }
  }
  await walk(source, "", 0);
  // 미룬 폴더 안에서 또 만난 자동 생성 폴더는 줄 끝에 더해져 같은 차례로 읽혀요.
  for (let at = 0; at < later.length && !full(); at += 1) {
    const { parent, name, path, level } = later[at];
    try {
      await walk(await parent.directory(name), path, level);
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

// 현관 폴더는 바로 아래 파일만 봅니다. 압축 푼 폴더가 줄을 덮지 않게요. 큰 다운로드 폴더도 부담이 없도록 크기와 날짜는 새 파일에만 묻습니다.
// 크기를 못 읽은 파일은 present에서 빼서 다음에 새 파일로 다시 봅니다. 폴더 자체를 못 읽으면 예외가 그대로 나갑니다.
export async function readDoorFolder(source: DirectorySource, seen: string[] | undefined): Promise<DoorRead> {
  const result: DoorRead = { present: [], found: [] };
  const known = seen && new Set(seen);
  for await (const entry of source.list()) {
    if (entry.kind !== "file" || isExcludedName(entry.name) || isPartialFile(entry.name)) continue;
    if (!isNewName(entry.name, known)) {
      result.present.push(entry.name);
      continue;
    }
    try {
      const info = await source.file(entry.name);
      const name = entry.name.normalize("NFC");
      result.present.push(entry.name);
      result.found.push({ path: entry.name, name, kind: kindOf(name), size: info.size, lastModified: info.lastModified });
    } catch {
      // 다음에 다시 봅니다.
    }
  }
  return result;
}

// 폴더 고르기를 못 쓰는 브라우저(Safari·Firefox)는 <input webkitdirectory>로 받습니다. 파일 이동은 못 합니다.
export function scanFileList(list: FileList): ScanResult & { rootName: string } {
  const result: ScanResult & { rootName: string } = { files: [], failed: 0, complete: true, note: null, rootName: "" };
  // 폴더를 고를 때와 같은 순서: 얕은 파일부터, 자동 생성 폴더 안은 맨 나중에요. 한도가 차도 맨 위 결과물이 먼저 들어와요.
  const files = Array.from(list).map((file) => {
    const parts = (file.webkitRelativePath || file.name).normalize("NFC").split("/").filter(Boolean);
    return { file, parts, rank: (parts.slice(1, -1).some(isMachineFolder) ? scanLimits.depth + 2 : 0) + parts.length };
  });
  files.sort((a, b) => a.rank - b.rank);
  for (const { file, parts } of files) {
    if (!result.rootName) result.rootName = parts[0] ?? file.name;
    const relative = parts.slice(1);
    if (relative.length === 0 || relative.some(isExcludedName)) continue;
    if (relative.length - 1 > scanLimits.depth) {
      result.complete = false;
      result.note = `깊이 ${scanLimits.depth}을 넘는 폴더는 넣지 않았어요.`;
      continue;
    }
    if (result.files.length >= scanLimits.files) {
      result.complete = false;
      result.note = `파일 ${scanLimits.files.toLocaleString("ko-KR")}개까지만 방에 들였어요.`;
      break;
    }
    result.files.push({ path: relative.join("/"), name: parts[parts.length - 1], kind: kindOf(file.name), size: file.size, lastModified: file.lastModified });
  }
  return result;
}

// 방 폴더 안의 상대 경로로 실제 파일을 엽니다. 읽기만 하고, 폴더 밖 경로는 열지 않습니다.
export async function readFileAt(handle: FileSystemDirectoryHandle, path: string): Promise<File> {
  if (!isSafeRelativePath(path)) throw new DOMException("안전하지 않은 경로", "NotAllowedError");
  const parts = path.split("/");
  let directory = handle;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  return (await directory.getFileHandle(parts[parts.length - 1])).getFile();
}
