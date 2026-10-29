import { sessionFile } from "./sessionFiles";

export type ReadProjectFileResult =
  | { ok: true; file: File }
  | { ok: false; reason: "unavailable" | "read-failed" };

export async function readProjectFile(
  projectId: string,
  relativePath: string,
  handle: FileSystemDirectoryHandle | null,
): Promise<ReadProjectFileResult> {
  const remembered = sessionFile(projectId, relativePath);
  if (remembered) return { ok: true, file: remembered };
  if (!handle) return { ok: false, reason: "unavailable" };
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return { ok: false, reason: "read-failed" };
  }
  try {
    let directory = handle;
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part);
    }
    const fileHandle = await directory.getFileHandle(parts[parts.length - 1]);
    return { ok: true, file: await fileHandle.getFile() };
  } catch {
    return { ok: false, reason: "read-failed" };
  }
}
