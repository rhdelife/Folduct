import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readDir, readFile, rename, stat } from "@tauri-apps/plugin-fs";
import { isSafeRelativePath } from "../domain/model";
import { baseName, childPath, joinPath, samePath } from "../domain/platform";
import { askAccess, handleSource, isExcludedName, readAccess, readFileAt, scanFolder, type Access, type AccessMode, type DirectorySource, type ScanResult } from "./folder";
import { asMoveDirectory, canMoveFiles, type MoveDirectory } from "./mover";

// 데스크톱 앱(Tauri)에서는 폴더를 핸들 대신 절대 경로로 다룹니다. 브라우저 빌드는 folder.ts·mover.ts를 그대로 씁니다.
// 경로 접근은 사용자가 고른 폴더(Tauri 런타임 fs 스코프)로만 제한되고, 이 파일은 읽기·폴더 만들기·이름 바꾸기만 씁니다.
export type Folder = FileSystemDirectoryHandle | string;

export const isNative = (): boolean => isTauri();

export const petSettingsChanged = "pet-settings";
// 플로팅 창이 현관 줄이나 방을 바꿨을 때, 작업을 끝냈을 때 메인 창에 알립니다.
export const doorChanged = "door-changed";
export const sessionEnded = "session-ended";
export const workLogged = "work-logged";

export const setPetVisible = (visible: boolean): Promise<void> => invoke("set_pet_visible", { visible });


const notFound = () => new DOMException("없음", "NotFoundError");

function inside(root: string, path: string): string {
  if (!isSafeRelativePath(path)) throw new DOMException("안전하지 않은 경로", "NotAllowedError");
  return path.split("/").reduce(childPath, root);
}

export function pathSource(dir: string): DirectorySource {
  return {
    async *list() {
      // 심볼릭 링크는 따라가지 않습니다. 폴더 밖으로 나가거나 맴돌 수 있어서요.
      for (const entry of await readDir(dir)) if (!entry.isSymlink) yield { name: entry.name, kind: entry.isDirectory ? "directory" : "file" };
    },
    async file(name) {
      const info = await stat(joinPath(dir, name));
      return { size: info.size, lastModified: info.mtime?.getTime() ?? 0 };
    },
    async directory(name) {
      return pathSource(joinPath(dir, name));
    },
  };
}

// mdls가 찍는 "2026-11-01 15:40:41 +0000"을 ms로. 다른 모양은 null입니다.
export function parseSpotlightDate(value: string | null | undefined): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const at = Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
  return Number.isNaN(at) ? null : at;
}

// mover.ts의 규칙(덮어쓰지 않기, (2) 이름, 상자 안팎만)은 그대로 두고, 폴더 다루는 손만 경로로 바꿉니다.
type PathDirectory = MoveDirectory & { path: string };

export function pathDirectory(dir: string): PathDirectory {
  return {
    path: dir,
    async getDirectoryHandle(name, options) {
      const path = childPath(dir, name);
      if (!(await exists(path))) {
        if (!options?.create) throw notFound();
        await mkdir(path);
      }
      return pathDirectory(path);
    },
    async getFileHandle(name) {
      const from = childPath(dir, name);
      if (!(await exists(from)) || !(await stat(from)).isFile) throw notFound();
      return {
        async move(destination, newName) {
          const to = childPath((destination as PathDirectory).path, newName);
          // shortcut: 확인과 이름 바꾸기 사이에 다른 앱이 같은 이름을 만들면 덮어쓸 수 있어요(브라우저 move()와 같은 한계). 문제가 되면 Rust에서 renamex_np(RENAME_EXCL)로 바꿉니다.
          if (await exists(to)) throw new DOMException("자리에 파일이 있어요", "InvalidModificationError");
          await rename(from, to);
        },
      };
    },
  };
}

// 앱 안 보기 창이 쓰는 형식만. 타입이 없으면 WebKit이 blob 영상·소리·SVG를 못 틉니다.
const mediaTypes: Record<string, string> = { svg: "image/svg+xml", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", aiff: "audio/aiff" };

export async function readPathFile(root: string, path: string): Promise<File> {
  const full = inside(root, path);
  if (!(await exists(full))) throw notFound();
  const name = path.slice(path.lastIndexOf("/") + 1);
  return new File([await readFile(full)], name, { type: mediaTypes[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "" });
}

export async function openInApp(root: string, path: string): Promise<void> {
  await invoke("open_in_app", { path: inside(root, path) });
}

export async function revealInFinder(root: string, path: string): Promise<void> {
  await invoke("reveal_in_finder", { path: inside(root, path) });
}

export type ChildFolder = { name: string; path: string };

// 상위 폴더 하나를 고르면 바로 아래 폴더들을 방 후보로 돌려줍니다. 이때는 하위 내용까지 열지 않습니다.
export async function pickParent(): Promise<{ path: string; folders: ChildFolder[] } | null> {
  const path = await open({ directory: true, recursive: false });
  if (typeof path !== "string") return null;
  const folders = (await readDir(path))
    .filter((entry) => entry.isDirectory && !isExcludedName(entry.name))
    // 경로는 디스크 이름 그대로 두고(스코프가 바이트로 비교), 보이는 이름만 NFC로 맞춥니다.
    .map((entry) => ({ name: entry.name.normalize("NFC"), path: joinPath(path, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { path, folders };
}

// 방으로 고른 하위 폴더만 하위 전체를 읽고 옮길 수 있게 엽니다.
export const allowRooms = (paths: string[]): Promise<void> => invoke("allow_rooms", { folders: paths });

export async function pickRoomFolder(defaultPath?: string): Promise<string | null> {
  const path = await open({ directory: true, recursive: true, defaultPath });
  return typeof path === "string" ? path : null;
}

export const sameFolder = (a: string | undefined, b: string): boolean => a !== undefined && samePath(a, b);

// 핸들(브라우저)과 경로(데스크톱)를 같은 자리에서 다루기 위한 갈림길입니다. 경로는 고를 때 이미 권한을 받았습니다.
export const folderAccess = (folder: Folder, mode?: AccessMode): Promise<Access> => (typeof folder === "string" ? Promise.resolve("granted") : readAccess(folder, mode));
export const askFolder = (folder: Folder, mode?: AccessMode): Promise<boolean> => (typeof folder === "string" ? Promise.resolve(true) : askAccess(folder, mode));
export const folderSource = (folder: Folder): DirectorySource => (typeof folder === "string" ? pathSource(folder) : handleSource(folder));
// 스캔한 뒤 macOS에 마지막 사용 시각을 묻습니다. 브라우저 핸들과 Windows·리눅스는 알 수 없어 null로 둬요. 시각을 못 읽어도 스캔은 그대로 씁니다.
export async function scanRoomFolder(folder: Folder, onProgress?: (count: number) => void): Promise<ScanResult> {
  const scan = await scanFolder(folderSource(folder), onProgress);
  if (typeof folder !== "string") return scan;
  for (let start = 0; start < scan.files.length; start += 200) {
    const chunk = scan.files.slice(start, start + 200);
    try {
      const dates = await invoke<(string | null)[]>("last_used_dates", { root: folder, paths: chunk.map((file) => file.path) });
      chunk.forEach((file, index) => (file.lastUsedAt = parseSpotlightDate(dates[index])));
    } catch {
      // 이 묶음만 날짜 없이 둡니다.
    }
  }
  return scan;
}
export const folderMover = (folder: Folder): MoveDirectory => (typeof folder === "string" ? pathDirectory(folder) : asMoveDirectory(folder));
export const canMoveIn = (folder: Folder): boolean => typeof folder === "string" || canMoveFiles();
export const readFolderFile = (folder: Folder, path: string): Promise<File> => (typeof folder === "string" ? readPathFile(folder, path) : readFileAt(folder, path));
export const folderName = (folder: Folder): string => (typeof folder === "string" ? baseName(folder) : folder.name);
