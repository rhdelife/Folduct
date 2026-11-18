import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readDir, readFile, stat, watch } from "@tauri-apps/plugin-fs";
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
// 메인 창 홈의 '작업 시작' 단추: 플로팅 창을 열고 어느 방을 시작할지 묻게 해요.
export const workStartAsked = "work-start";
// 플로팅 창의 작업 상태가 바뀔 때마다 메인 창에 알리고(payload는 Session 또는 null), 메인 창 홈의 멈춤·끝내기는 플로팅 창에 부탁해요.
export const sessionChanged = "session-changed";
export const workPauseAsked = "work-pause";
export const workEndAsked = "work-end";
// 메인 창 홈에서 고른 방으로 작업을 시작해요(payload는 방 id). 작은 창은 열지 않아요.
export const workStartRoom = "work-start-room";
// 작업 중 새 파일을 작업 방으로 자동으로 옮겼다고 메인 창에 알리고(글), 메인 창 알림의 '되돌리기'를 작은 창에 부탁해요.
export const workAutoMoved = "work-auto-moved";
export const workAutoUndo = "work-auto-undo";
// 작은 창의 '이번 주 정리' 알림에서 '보기'를 누르면 메인 창이 정리 창을 열어요.
export const sweepOpenAsked = "sweep-open";

// fromIcon: 메뉴 막대 아이콘을 눌러 부른 때. 프로도가 그 아이콘 아래로 내려와요.
export const setPetVisible = (visible: boolean, fromIcon = false): Promise<void> => invoke("set_pet_visible", { visible, fromIcon });


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
          // 대상 자리에 파일이 있으면 OS가 거절합니다(lib.rs move_file). 확인과 이동 사이에 생긴 파일도 덮어쓰지 않아요.
          await invoke("move_file", { from, to });
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

// 방 폴더 안 영상들의 길이(초). Spotlight로 읽고, 모르는 mp4·mov는 파일 머리에서 읽어요. 모르면 null이에요(데스크톱만).
export const videoSeconds = (root: string, paths: string[]): Promise<(number | null)[]> => invoke("video_seconds", { root, paths });

// macOS Quick Look이 그린 첫 장 그림(PNG)이에요. 발표·문서처럼 앱 안에서 못 여는 형식을 미리보기 창에 보여 줄 때 써요.
export async function firstPage(root: string, path: string): Promise<Blob> {
  return new Blob([await invoke<ArrayBuffer>("thumbnail", { path: inside(root, path) })], { type: "image/png" });
}

// 발표 파일 전체를 Quick Look 미리보기로 받아요(macOS). PDF로 나오면 pdf, 아니면 그림을 data URL로 넣은 HTML 글이에요.
export async function slidePreview(root: string, path: string): Promise<{ pdf: Blob } | { html: string }> {
  const bytes = new Uint8Array(await invoke<ArrayBuffer>("slide_preview", { path: inside(root, path) }));
  const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  return pdf ? { pdf: new Blob([bytes], { type: "application/pdf" }) } : { html: new TextDecoder().decode(bytes) };
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

// Finder에서 넣고 빼고 이름을 바꾸면 곧바로 알려 줘요(0.5초 묶음). 감시는 읽기뿐이고, 현관처럼 맨 위층만 열린 폴더는 recursive를 끄세요.
export async function watchFolder(paths: string | string[], onChange: () => void, recursive: boolean): Promise<() => void> {
  if (paths.length === 0) return () => {};
  return watch(paths, onChange, { recursive, delayMs: 500 });
}

// 방으로 고른 하위 폴더만 하위 전체를 읽고 옮길 수 있게 엽니다.
export const allowRooms = (paths: string[]): Promise<void> => invoke("allow_rooms", { folders: paths });

// 방 만들기 목록(2026-11-18 요청). 검색어가 없으면 자주 쓰는 자리 바로 아래 폴더를, 있으면 이름으로 찾은 폴더를 받아요. 이름·경로·고친 시각만이에요.
export type FoundFolder = { path: string; name: string; modified: number | null };
export async function findFolders(query: string): Promise<FoundFolder[]> {
  const rows = await invoke<[string, string, number | null][]>("find_folders", { query });
  // 경로는 디스크 이름 그대로 두고(스코프가 바이트로 비교), 보이는 이름만 NFC로 맞춰요.
  return rows.map(([path, name, modified]) => ({ path, name: name.normalize("NFC"), modified }));
}
// 목록에서 고른 폴더를 방 폴더로 열어요. Tauri 쪽이 홈 아래 보통 폴더인지 다시 확인해요.
export const allowFoundRooms = (paths: string[]): Promise<void> => invoke("allow_found_rooms", { folders: paths });

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
