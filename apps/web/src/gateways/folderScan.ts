import { kindOf } from "../fileSystem";
import { limits } from "../domain/limits";
import type { AssetKind, ScanStopReason } from "../domain/models";

export type ScanProgress = {
  collected: number;
  failed: number;
  currentPath: string;
};

export type ScannedFile = {
  relativePath: string;
  displayName: string;
  kind: AssetKind;
  size: number;
  lastModified: number;
  file: File | null;
};

export type ScanFailure = {
  relativePath: string;
  message: string;
};

export type ScanResult = {
  files: ScannedFile[];
  failures: ScanFailure[];
  complete: boolean;
  stoppedReason: ScanStopReason | null;
};

export type DirectoryListing = {
  name: string;
  kind: "file" | "directory";
};

export type DirectorySource = {
  list(): AsyncIterable<DirectoryListing>;
  file(name: string): Promise<{ size: number; lastModified: number; mime: string; file: File | null }>;
  directory(name: string): Promise<DirectorySource>;
};

export type MemoryNode =
  | { kind: "file"; name: string; size?: number; lastModified?: number; mime?: string; error?: string }
  | { kind: "directory"; name: string; error?: string; children: MemoryNode[] };

type ScanOptions = {
  signal?: AbortSignal;
  maxFiles?: number;
  maxDepth?: number;
  onProgress?: (progress: ScanProgress) => void;
};

type ScanState = {
  files: ScannedFile[];
  failures: ScanFailure[];
  fileLimited: boolean;
  depthLimited: boolean;
  cancelled: boolean;
  maxFiles: number;
  maxDepth: number;
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
};

export function isExcludedName(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || name === ".git";
}

export function memoryDirectory(nodes: MemoryNode[]): DirectorySource {
  return {
    async *list() {
      for (const node of nodes) {
        yield { name: node.name, kind: node.kind === "directory" ? "directory" : "file" };
      }
    },
    async file(name) {
      const node = nodes.find((item) => item.name === name && item.kind === "file");
      if (!node || node.kind !== "file") throw new Error("파일을 찾지 못했습니다.");
      if (node.error) throw new Error(node.error);
      return {
        size: node.size ?? 1,
        lastModified: node.lastModified ?? 0,
        mime: node.mime ?? "",
        file: null,
      };
    },
    async directory(name) {
      const node = nodes.find((item) => item.name === name && item.kind === "directory");
      if (!node || node.kind !== "directory") throw new Error("폴더를 찾지 못했습니다.");
      if (node.error) throw new Error(node.error);
      return memoryDirectory(node.children);
    },
  };
}

export async function scanDirectory(source: DirectorySource, options: ScanOptions = {}): Promise<ScanResult> {
  const state: ScanState = {
    files: [],
    failures: [],
    fileLimited: false,
    depthLimited: false,
    cancelled: false,
    maxFiles: options.maxFiles ?? limits.maxFiles,
    maxDepth: options.maxDepth ?? limits.maxDirectoryDepth,
    signal: options.signal,
    onProgress: options.onProgress,
  };
  await walk(source, "", 0, state);
  return toResult(state);
}

export function scanFileList(files: Iterable<File>, options: ScanOptions = {}): ScanResult & { rootName: string } {
  const state: ScanState = {
    files: [],
    failures: [],
    fileLimited: false,
    depthLimited: false,
    cancelled: false,
    maxFiles: options.maxFiles ?? limits.maxFiles,
    maxDepth: options.maxDepth ?? limits.maxDirectoryDepth,
    signal: options.signal,
    onProgress: options.onProgress,
  };
  let rootName = "";
  for (const file of files) {
    if (state.signal?.aborted) {
      state.cancelled = true;
      break;
    }
    if (state.files.length >= state.maxFiles) {
      state.fileLimited = true;
      break;
    }
    const parts = pathParts(file);
    if (!rootName) rootName = parts[0] || file.name;
    const relativeParts = parts[0] === rootName ? parts.slice(1) : parts;
    if (relativeParts.length === 0 || relativeParts.some(isExcludedName)) continue;
    const depth = relativeParts.length - 1;
    if (depth > state.maxDepth) {
      state.depthLimited = true;
      continue;
    }
    const relativePath = relativeParts.join("/");
    state.files.push({
      relativePath,
      displayName: file.name,
      kind: kindOf(file.name, file.type),
      size: file.size,
      lastModified: file.lastModified,
      file,
    });
    state.onProgress?.({ collected: state.files.length, failed: state.failures.length, currentPath: relativePath });
  }
  return { rootName, ...toResult(state) };
}

async function walk(source: DirectorySource, parent: string, depth: number, state: ScanState): Promise<void> {
  let listing: DirectoryListing[];
  try {
    listing = [];
    for await (const entry of source.list()) listing.push(entry);
  } catch (error) {
    state.failures.push({ relativePath: parent || ".", message: errorMessage(error) });
    return;
  }

  for (const entry of listing) {
    if (state.signal?.aborted) {
      state.cancelled = true;
      return;
    }
    if (state.fileLimited) return;
    if (isExcludedName(entry.name)) continue;
    const relativePath = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      if (depth >= state.maxDepth) {
        state.depthLimited = true;
        continue;
      }
      try {
        const child = await source.directory(entry.name);
        await walk(child, relativePath, depth + 1, state);
      } catch (error) {
        state.failures.push({ relativePath, message: errorMessage(error) });
        state.onProgress?.({ collected: state.files.length, failed: state.failures.length, currentPath: relativePath });
      }
      continue;
    }
    if (state.files.length >= state.maxFiles) {
      state.fileLimited = true;
      return;
    }
    try {
      const loaded = await source.file(entry.name);
      state.files.push({
        relativePath,
        displayName: entry.name,
        kind: kindOf(entry.name, loaded.mime),
        size: loaded.size,
        lastModified: loaded.lastModified,
        file: loaded.file,
      });
    } catch (error) {
      state.failures.push({ relativePath, message: errorMessage(error) });
    }
    state.onProgress?.({ collected: state.files.length, failed: state.failures.length, currentPath: relativePath });
  }
}

function toResult(state: ScanState): ScanResult {
  const stoppedReason: ScanStopReason | null = state.cancelled
    ? "cancelled"
    : state.fileLimited
      ? "file-limit"
      : state.depthLimited
        ? "depth-limit"
        : null;
  return {
    files: state.files,
    failures: state.failures,
    complete: stoppedReason === null,
    stoppedReason,
  };
}

function pathParts(file: File): string[] {
  const relative = "webkitRelativePath" in file && typeof file.webkitRelativePath === "string" ? file.webkitRelativePath : "";
  const raw = relative.length > 0 ? relative : file.name;
  return raw.split("/").filter((part) => part.length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "파일을 읽지 못했습니다.";
}
