import type { FileKind, FolderSnapshot, LocalEntry } from "./types";

const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "ico"]);
const videoExtensions = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);
const textExtensions = new Set([
  "txt", "md", "markdown", "json", "xml", "yaml", "yml", "html", "css", "scss", "js", "jsx", "ts", "tsx",
  "py", "java", "kt", "swift", "go", "rs", "c", "h", "cpp", "hpp", "sh", "zsh", "sql", "log", "ini", "toml",
]);
const tableExtensions = new Set(["csv", "tsv", "xls", "xlsx", "numbers"]);
const officeExtensions = new Set(["doc", "docx", "ppt", "pptx", "hwp", "hwpx", "pages", "key"]);
const designExtensions = new Set(["psd", "ai", "sketch", "fig", "xd", "indd", "eps"]);
const archiveExtensions = new Set(["zip", "rar", "7z", "tar", "gz", "dmg", "iso"]);

export function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function kindOf(name: string, mime = ""): FileKind {
  const extension = extensionOf(name);
  if (mime.startsWith("image/") || imageExtensions.has(extension)) return "image";
  if (mime.startsWith("video/") || videoExtensions.has(extension)) return "video";
  if (mime.startsWith("audio/") || audioExtensions.has(extension)) return "audio";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (extension === "csv" || extension === "tsv") return "table";
  if (mime.startsWith("text/") || textExtensions.has(extension)) return "text";
  if (tableExtensions.has(extension)) return "table";
  if (officeExtensions.has(extension)) return "office";
  if (designExtensions.has(extension)) return "design";
  if (archiveExtensions.has(extension)) return "archive";
  return "unknown";
}

function toEntry(file: File, path: string): LocalEntry {
  const extension = extensionOf(file.name);
  return {
    id: `${path}:${file.lastModified}:${file.size}`,
    name: file.name,
    path,
    extension,
    kind: kindOf(file.name, file.type),
    size: file.size,
    modifiedAt: file.lastModified,
    file,
  };
}

async function walkDirectory(handle: FileSystemDirectoryHandle, parent = ""): Promise<LocalEntry[]> {
  const files: LocalEntry[] = [];
  for await (const [name, child] of handle.entries()) {
    if (name.startsWith(".")) continue;
    const path = parent ? `${parent}/${name}` : name;
    if (child.kind === "file") files.push(toEntry(await child.getFile(), path));
    else files.push(...(await walkDirectory(child, path)));
  }
  return files;
}

export async function selectFolder(): Promise<FolderSnapshot | null> {
  if ("showDirectoryPicker" in window) {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    return { name: handle.name, files: await walkDirectory(handle), source: "directory-picker" };
  }
  return null;
}

export function snapshotFromInput(fileList: FileList): FolderSnapshot {
  const files = Array.from(fileList).map((file) => {
    const path = file.webkitRelativePath || file.name;
    return toEntry(file, path);
  });
  const firstPath = files[0]?.path ?? "내 폴더";
  return { name: firstPath.split("/")[0], files, source: "directory-input" };
}

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
    queryPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  }

  interface Window {
    showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}
