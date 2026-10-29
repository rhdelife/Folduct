import { isSafeRelativePath, kindOf, type ScannedFile } from "../domain/model";

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

export function isExcludedName(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
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

export async function scanFolder(source: DirectorySource, onProgress?: (count: number) => void): Promise<ScanResult> {
  const result: ScanResult = { files: [], failed: 0, complete: true, note: null };
  async function walk(dir: DirectorySource, parent: string, level: number): Promise<void> {
    let listing: { name: string; kind: "file" | "directory" }[] = [];
    try {
      for await (const entry of dir.list()) listing.push(entry);
    } catch {
      result.failed += 1;
      return;
    }
    for (const entry of listing) {
      if (isExcludedName(entry.name)) continue;
      // 한글 이름은 NFC로 맞춰, 가져오기 스크립트(Node)가 읽은 경로와 같게 비교합니다.
      const name = entry.name.normalize("NFC");
      const path = parent ? `${parent}/${name}` : name;
      if (entry.kind === "directory") {
        if (level >= scanLimits.depth) {
          result.complete = false;
          result.note = `깊이 ${scanLimits.depth}을 넘는 폴더는 넣지 않았어요.`;
          continue;
        }
        try {
          await walk(await dir.directory(entry.name), path, level + 1);
        } catch {
          result.failed += 1;
        }
        continue;
      }
      if (result.files.length >= scanLimits.files) {
        result.complete = false;
        result.note = `파일 ${scanLimits.files.toLocaleString("ko-KR")}개까지만 방에 들였어요.`;
        return;
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
  return result;
}

// 폴더 고르기를 못 쓰는 브라우저(Safari·Firefox)는 <input webkitdirectory>로 받습니다. 파일 이동은 못 합니다.
export function scanFileList(list: FileList): ScanResult & { rootName: string } {
  const result: ScanResult & { rootName: string } = { files: [], failed: 0, complete: true, note: null, rootName: "" };
  for (const file of Array.from(list)) {
    const parts = (file.webkitRelativePath || file.name).normalize("NFC").split("/").filter(Boolean);
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
