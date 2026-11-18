import { boxPathCandidate, isInBox, numberedName } from "../domain/care";
import { isSafeRelativePath } from "../domain/model";
import { invoke } from "@tauri-apps/api/core";
import { childPath, fileManagerName, osErrorKind } from "../domain/platform";
import { isExcludedName } from "./folder";

// 실제 폴더에 하는 변경은 이 파일에만 있어요. 상자 안팎 이동(moveFile), 현관 문서를 방으로 옮기는 이동(moveDoorFile), 같은 폴더 안 이름 바꾸기(renameFile),
// 사용자가 확인한 파일 하나를 OS 휴지통으로 보내기(trashFile, 데스크톱만), 그리고 고른 파일을 다른 방 폴더로 옮기기·복제(moveBetween·copyBetween, 2026-11-18 요청).
// 영구 삭제나 내용 고쳐 쓰기는 하지 않습니다. 옮기기·복제 모두 대상에 같은 이름이 있으면 덮어쓰지 않아요.
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

// 상자 안 빈 이름. 원래 하위 경로를 상자 안에서도 유지하고, 디스크에 있는 이름과 이번 묶음에서 이미 잡은 이름(reserved)은 피해요.
export async function freeBoxPath(root: MoveDirectory, fromPath: string, reserved?: Set<string>): Promise<string | null> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = boxPathCandidate(fromPath, attempt);
    if (!isSafeRelativePath(candidate)) return null;
    if (reserved?.has(candidate) || (await fileExists(root, candidate))) continue;
    reserved?.add(candidate);
    return candidate;
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

// 한 방 폴더의 파일 하나를 다른 방 폴더로 옮겨요(되돌리기는 거꾸로 부르기). 정리 상자 안 파일·상자 안 자리는 받지 않아요.
export async function moveBetween(fromRoot: MoveDirectory, fromPath: string, toRoot: MoveDirectory, toPath: string): Promise<MoveResult> {
  if (!isSafeRelativePath(fromPath) || !isSafeRelativePath(toPath) || isInBox(fromPath) || isInBox(toPath)) {
    return { ok: false, reason: "invalid", message: "정리 상자 밖 파일만 다른 방으로 옮길 수 있어요." };
  }
  try {
    if (await fileExists(toRoot, toPath)) return { ok: false, reason: "occupied", message: "옮길 자리에 같은 이름의 파일이 있어요." };
    const fromParts = fromPath.split("/");
    let file: MoveFile;
    try {
      file = await (await walk(fromRoot, fromParts.slice(0, -1), false)).getFileHandle(fromParts[fromParts.length - 1]);
    } catch (error) {
      if (isNotFound(error)) return { ok: false, reason: "missing", message: "원래 파일을 찾지 못했어요." };
      throw error;
    }
    if (typeof file.move !== "function") return { ok: false, reason: "unsupported", message: "이 브라우저는 파일 이동을 지원하지 않아요." };
    const toParts = toPath.split("/");
    // 되돌릴 때 원래 폴더가 사라졌으면 만들지 않고 실패해요.
    await file.move(await walk(toRoot, toParts.slice(0, -1), false), toParts[toParts.length - 1]);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "failed", message: moveMessage(error) };
  }
}

// 한 방 폴더의 파일 하나를 다른 방 폴더 맨 위에 복제해요(데스크톱만). 원본은 그대로예요. Tauri 쪽(copy_file)도 범위·숨김·덮어쓰기를 한 번 더 막아요.
export async function copyBetween(fromRoot: string, fromPath: string, toRoot: string, toName: string): Promise<MoveResult> {
  if (!isSafeRelativePath(fromPath) || isInBox(fromPath) || !isSafeRelativePath(toName) || toName.includes("/") || toName.startsWith(".") || isExcludedName(toName)) {
    return { ok: false, reason: "invalid", message: "복제할 수 없는 파일이에요." };
  }
  try {
    await invoke("copy_file", { from: fromPath.split("/").reduce(childPath, fromRoot), to: childPath(toRoot, toName) });
    return { ok: true };
  } catch (error) {
    if (isNotFound(error)) return { ok: false, reason: "missing", message: "원래 파일을 찾지 못했어요." };
    if (osErrorKind(String(error)) === null && /exists|os error 17/i.test(String(error))) return { ok: false, reason: "occupied", message: "복제할 자리에 같은 이름의 파일이 있어요." };
    return { ok: false, reason: "failed", message: moveMessage(error).replace("옮기지 못했어요", "복제하지 못했어요") };
  }
}

// 파일 하나의 이름만 바꿉니다. 같은 폴더 안에서만, 정리 상자 밖 파일만이에요. 새 이름에 같은 이름의 파일이 있으면 덮어쓰지 않습니다.
export async function renameFile(root: MoveDirectory, path: string, newName: string): Promise<MoveResult> {
  const parts = path.split("/");
  const oldName = parts[parts.length - 1];
  const toPath = [...parts.slice(0, -1), newName].join("/");
  // 점으로 시작하거나 시스템 파일 이름이면 다시 읽을 때 목록에서 빠져(folder.ts isExcludedName) 파일을 잃은 것처럼 보여요.
  if (!isSafeRelativePath(path) || !newName.trim() || newName.includes("/") || newName.startsWith(".") || isExcludedName(newName) || !isSafeRelativePath(toPath) || isInBox(path)) {
    return { ok: false, reason: "invalid", message: "쓸 수 없는 이름이에요." };
  }
  if (newName === oldName) return { ok: true };
  try {
    // 대소문자만 바꾸면 macOS·Windows에서는 같은 파일이 '있다'고 나와요. 그때는 자기 자신이라 겹침으로 보지 않아요.
    const caseOnly = newName.toLowerCase() === oldName.toLowerCase();
    if (!caseOnly && (await fileExists(root, toPath))) return { ok: false, reason: "occupied", message: "같은 이름의 파일이 이미 있어요." };
    const directory = await walk(root, parts.slice(0, -1), false);
    let file: MoveFile;
    try {
      file = await directory.getFileHandle(oldName);
    } catch (error) {
      if (isNotFound(error)) return { ok: false, reason: "missing", message: "폴더에서 이 파일을 찾지 못했어요." };
      throw error;
    }
    if (typeof file.move !== "function") return { ok: false, reason: "unsupported", message: "이 브라우저는 파일 이름 바꾸기를 지원하지 않아요." };
    await file.move(directory, newName);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "failed", message: moveMessage(error).replace("옮기지 못했어요", "이름을 바꾸지 못했어요") };
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

// 방 폴더(root) 안 파일 하나를 휴지통으로 보내요. 부르기 전에 꼭 사용자에게 물어요. 휴지통에서 되살릴 수 있어요.
// Tauri 쪽(trash_file)도 방 폴더 밖·폴더·바로가기·숨김 파일을 한 번 더 막아요.
// 돌려받는 값은 휴지통 안 자리예요(macOS). 그 자리로 restoreTrashed를 부르면 되돌려요. 다른 OS는 null이라 되돌리기가 없어요.
export async function trashFile(root: string, path: string): Promise<string | null> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!isSafeRelativePath(path) || name.startsWith(".") || isExcludedName(name)) throw new DOMException("보낼 수 없는 파일이에요.", "NotAllowedError");
  return (await invoke<string | null>("trash_file", { path: path.split("/").reduce(childPath, root) })) ?? null;
}

// 휴지통으로 보낸 파일을 원래 자리(root 안 path)로 되돌려요. 같은 이름이 생겼으면 덮어쓰지 않고 실패해요.
export async function restoreTrashed(root: string, path: string, place: string): Promise<void> {
  if (!isSafeRelativePath(path)) throw new DOMException("안전하지 않은 경로예요.", "NotAllowedError");
  await invoke("restore_trashed", { from: place, to: path.split("/").reduce(childPath, root) });
}

// 파일·폴더가 없을 때 브라우저와 Tauri가 주는 오류. 판정만 해서 폴더에 할 수 있는 일은 늘지 않아요.
export function isNotFound(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "NotFoundError" || error.name === "TypeMismatchError";
  // Tauri 명령은 오류를 글로 줘요(예: 기록엔 있지만 이미 지워진 임시 파일을 휴지통으로 보낼 때 "os error 2").
  return osErrorKind(String(error)) === "gone";
}

function moveMessage(error: unknown): string {
  // 다른 디스크로는 이름 바꾸기가 안 됩니다. 복사 후 삭제로 우회하지 않아요. Tauri는 오류를 문자열로 줍니다.
  const kind = osErrorKind(String(error));
  if (kind === "crossDevice") return `다른 디스크에 있는 폴더라 옮기지 못했어요. ${fileManagerName()}에서 직접 옮겨 주세요.`;
  if (kind === "denied" || (error instanceof DOMException && error.name === "NotAllowedError")) return "폴더 수정 권한이 없어요.";
  if (kind === "busy" || (error instanceof DOMException && error.name === "NoModificationAllowedError")) return "다른 앱이 파일을 쓰고 있어 옮기지 못했어요.";
  return error instanceof Error && error.message ? `옮기지 못했어요. ${error.message}` : "옮기지 못했어요.";
}
