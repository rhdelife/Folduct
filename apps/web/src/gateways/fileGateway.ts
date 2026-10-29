import type { ScanResult } from "./folderScan";
import { scanDirectory, scanFileList, type DirectorySource, type ScanProgress } from "./folderScan";
import type { SourceMode } from "../domain/models";

export type FolderDraft = {
  sourceMode: SourceMode;
  rootName: string;
  handle: FileSystemDirectoryHandle | null;
  scan: ScanResult;
};

export type PickResult =
  | { status: "cancelled" }
  | { status: "unavailable" }
  | { status: "denied"; message: string }
  | { status: "ready"; draft: FolderDraft };

export function canUseDirectoryPicker(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDirectory(options: {
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
}): Promise<PickResult> {
  if (!canUseDirectoryPicker()) return { status: "unavailable" };
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    if (options.signal?.aborted) return { status: "cancelled" };
    const scan = await scanDirectory(directoryHandleSource(handle), options);
    if (scan.stoppedReason === "cancelled") return { status: "cancelled" };
    return {
      status: "ready",
      draft: { sourceMode: "handle", rootName: handle.name, handle, scan },
    };
  } catch (error) {
    if (isCancellation(error)) return { status: "cancelled" };
    return { status: "denied", message: deniedMessage(error) };
  }
}

export function draftFromFileList(files: FileList | File[]): FolderDraft | null {
  const scan = scanFileList(files);
  if (!scan.rootName || (scan.files.length === 0 && scan.failures.length === 0)) return null;
  return {
    sourceMode: "input",
    rootName: scan.rootName,
    handle: null,
    scan,
  };
}

export type AccessMode = "read" | "readwrite";

export async function readPermission(handle: FileSystemDirectoryHandle, mode: AccessMode = "read"): Promise<"granted" | "prompt" | "denied" | "unknown"> {
  try {
    if (typeof handle.queryPermission !== "function") return "unknown";
    const state = await handle.queryPermission({ mode });
    if (state === "granted" || state === "prompt" || state === "denied") return state;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function askPermission(handle: FileSystemDirectoryHandle, mode: AccessMode = "read"): Promise<"granted" | "denied"> {
  try {
    const state = await handle.requestPermission({ mode });
    return state === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

function directoryHandleSource(handle: FileSystemDirectoryHandle): DirectorySource {
  return {
    async *list() {
      for await (const [name, child] of handle.entries()) {
        yield { name, kind: child.kind };
      }
    },
    async file(name) {
      const child = await handle.getFileHandle(name);
      const file = await child.getFile();
      return { size: file.size, lastModified: file.lastModified, mime: file.type, file };
    },
    async directory(name) {
      const child = await handle.getDirectoryHandle(name);
      return directoryHandleSource(child);
    },
  };
}

function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function deniedMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "SecurityError") {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return "이 페이지에서는 폴더 접근을 허용할 수 없습니다. 보안 연결에서 다시 시도해 주세요.";
    }
    return "이 브라우저 창에서는 폴더 선택을 열 수 없습니다. 프로젝트를 만들지 않았습니다. 폴더 입력으로 다시 선택할 수 있습니다.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "폴더 접근이 거부되었습니다. 프로젝트를 만들지 않았습니다.";
  }
  return "폴더를 열지 못했습니다. 프로젝트를 만들지 않았습니다.";
}
