import { boxPathCandidate, isInBox, numberedName } from "../domain/care";
import { isSafeRelativePath } from "../domain/model";
import { fileManagerName, osErrorKind } from "../domain/platform";

// 실제 폴더에 하는 변경은 이 파일의 두 가지 이동뿐입니다. 상자 안팎 이동(moveFile)과 현관 문서를 방으로 옮기는 이동(moveDoorFile). 지우거나 내용을 고쳐 쓰지 않습니다.
export type MoveDirectory = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MoveDirectory>;
  getFileHandle(name: string): Promise<MoveFile>;
};

export type MoveFile = { move?: (destination: MoveDirectory, name: string) => Promise<void> };

export type MoveResult = { ok: true } | { ok: false; reason: "unsupported" | "missing" | "occupied" | "invalid" | "failed"; message: string };

export function canMoveFiles(): boolean {
  return typeof FileSystemFileHandle !== "undefined" && "move" in FileSystemFileHandle.prototype;
}

export function asMoveDirectory(handle: FileSystemDirectoryHandle): MoveDirectory {
  return handle as unknown as MoveDirectory;
}

export async function fileExists(root: MoveDirectory, path: string): Promise<boolean> {
  if (!isSafeRelativePath(path)) return false;
  const parts = path.split("/");
  try {
    const directory = await walk(root, parts.slice(0, -1), false);
    await directory.getFileHandle(parts[parts.length - 1]);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function freeBoxPath(root: MoveDirectory, fromPath: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = boxPathCandidate(fromPath, attempt);
    if (!isSafeRelativePath(candidate)) return null;
    if (!(await fileExists(root, candidate))) return candidate;
  }
  return null;
}

// 상자 안으로 넣거나 상자에서 꺼내는 이동만 허용합니다. 대상에 파일이 있으면 덮어쓰지 않습니다.
export async function moveFile(root: MoveDirectory, fromPath: string, toPath: string): Promise<MoveResult> {
  if (!isSafeRelativePath(fromPath) || !isSafeRelativePath(toPath) || isInBox(fromPath) === isInBox(toPath)) {
    return { ok: false, reason: "invalid", message: "정리 상자 안팎으로만 옮길 수 있어요." };
  }
  try {
    if (await fileExists(root, toPath)) return { ok: false, reason: "occupied", message: "옮길 자리에 같은 이름의 파일이 있어요." };
    const fromParts = fromPath.split("/");
    let file: MoveFile;
    try {
      file = await (await walk(root, fromParts.slice(0, -1), false)).getFileHandle(fromParts[fromParts.length - 1]);
    } catch (error) {
      if (isNotFound(error)) return { ok: false, reason: "missing", message: "원래 파일을 찾지 못했어요." };
      throw error;
    }
    if (typeof file.move !== "function") return { ok: false, reason: "unsupported", message: "이 브라우저는 파일 이동을 지원하지 않아요." };
    const toParts = toPath.split("/");
    await file.move(await walk(root, toParts.slice(0, -1), true), toParts[toParts.length - 1]);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "failed", message: moveMessage(error) };
  }
}

export async function freeDoorName(root: MoveDirectory, name: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = numberedName(name, attempt);
    if (!(await fileExists(root, candidate))) return candidate;
  }
  return null;
}

// 현관 폴더 바로 아래 파일 하나를 방 폴더 바로 아래로 옮기거나 되돌립니다. 하위 경로는 받지 않고, 대상에 파일이 있으면 덮어쓰지 않습니다.
export async function moveDoorFile(fromRoot: MoveDirectory, fromName: string, toRoot: MoveDirectory, toName: string): Promise<MoveResult> {
  if (!isSafeRelativePath(fromName) || !isSafeRelativePath(toName) || fromName.includes("/") || toName.includes("/")) {
    return { ok: false, reason: "invalid", message: "폴더 바로 아래 파일만 옮길 수 있어요." };
  }
  try {
    if (await fileExists(toRoot, toName)) return { ok: false, reason: "occupied", message: "옮길 자리에 같은 이름의 파일이 있어요." };
    let file: MoveFile;
    try {
      file = await fromRoot.getFileHandle(fromName);
    } catch (error) {
      if (isNotFound(error)) return { ok: false, reason: "missing", message: "원래 파일을 찾지 못했어요." };
      throw error;
    }
    if (typeof file.move !== "function") return { ok: false, reason: "unsupported", message: "이 브라우저는 파일 이동을 지원하지 않아요." };
    await file.move(toRoot, toName);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "failed", message: moveMessage(error) };
  }
}

async function walk(root: MoveDirectory, parts: string[], create: boolean): Promise<MoveDirectory> {
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return directory;
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotFoundError" || error.name === "TypeMismatchError");
}

function moveMessage(error: unknown): string {
  // 다른 디스크로는 이름 바꾸기가 안 됩니다. 복사 후 삭제로 우회하지 않아요. Tauri는 오류를 문자열로 줍니다.
  const kind = osErrorKind(String(error));
  if (kind === "crossDevice") return `다른 디스크에 있는 폴더라 옮기지 못했어요. ${fileManagerName()}에서 직접 옮겨 주세요.`;
  if (kind === "denied" || (error instanceof DOMException && error.name === "NotAllowedError")) return "폴더 수정 권한이 없어요.";
  if (kind === "busy" || (error instanceof DOMException && error.name === "NoModificationAllowedError")) return "다른 앱이 파일을 쓰고 있어 옮기지 못했어요.";
  return error instanceof Error && error.message ? `옮기지 못했어요. ${error.message}` : "옮기지 못했어요.";
}
