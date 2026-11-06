import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doorTargets, normalizeDoorstep, type DoorItem } from "../domain/doorstep";
import { baseName, childPath, fileManagerName, isSafeWindowsName, joinPath, osErrorKind, osOf, samePath, shortPath } from "../domain/platform";
import { folderProblem, isExcludedName } from "../gateways/folder";
import { freeBoxPath, moveDoorFile, moveFile, type MoveDirectory } from "../gateways/mover";
import { folderName, openInApp, pathDirectory, pathSource, pickParent, readPathFile, sameFolder } from "../gateways/native";
import type { Room } from "../domain/model";

// Windows 경로만 받는 메모리 디스크입니다. 구분자가 섞이면 파일을 못 찾아 테스트가 깨져요. 대소문자는 Windows처럼 가리지 않습니다.
const disk = vi.hoisted(() => new Map<string, { dir?: boolean; data?: string }>());
const key = (path: string) => path.toLowerCase();

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => disk.has(path.toLowerCase()),
  stat: async (path: string) => {
    const entry = disk.get(path.toLowerCase());
    if (!entry) throw new Error("The system cannot find the path specified. (os error 3)");
    return { isFile: !entry.dir, isDirectory: !!entry.dir, size: entry.data?.length ?? 0, mtime: new Date(0) };
  },
  readDir: async (path: string) =>
    [...disk.entries()]
      .filter(([child]) => child !== path.toLowerCase() && child.startsWith(`${path.toLowerCase().replace(/\\$/, "")}\\`) && !child.slice(path.replace(/\\$/, "").length + 1).includes("\\"))
      .map(([child, entry]) => ({ name: child.slice(child.lastIndexOf("\\") + 1), isDirectory: !!entry.dir, isFile: !entry.dir, isSymlink: false })),
  mkdir: async (path: string) => void disk.set(path.toLowerCase(), { dir: true }),
  readFile: async (path: string) => new TextEncoder().encode(disk.get(path.toLowerCase())?.data ?? ""),
}));
const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
// move_file은 MoveFileExW처럼 대상 자리에 무엇이 있으면(대소문자만 달라도) 거절합니다.
const invoke = vi.hoisted(() =>
  vi.fn(async (cmd: string, args: any): Promise<any> => {
    if (cmd !== "move_file") return undefined;
    const entry = disk.get(args.from.toLowerCase());
    if (!entry) throw "The system cannot find the file specified. (os error 2)";
    if (disk.has(args.to.toLowerCase())) throw "Cannot create a file when that file already exists. (os error 183)";
    disk.set(args.to.toLowerCase(), entry);
    disk.delete(args.from.toLowerCase());
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

const root = "C:\\Users\\준\\방";
const box = "_Folduct 정리상자";
const windowsUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0.0.0";

beforeEach(() => {
  disk.clear();
  disk.set(key(root), { dir: true });
  disk.set(key(`${root}\\참고`), { dir: true });
  disk.set(key(`${root}\\참고\\시안.psd`), { data: "원본" });
  invoke.mockReset();
  dialog.open.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("운영체제 알아내기", () => {
  it("웹뷰의 UA로 고른다", () => {
    expect(osOf(windowsUa)).toBe("windows");
    expect(osOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe("mac");
    expect(osOf("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15")).toBe("linux");
  });

  it("파일 관리자 이름이 OS를 따른다", () => {
    expect([fileManagerName("mac"), fileManagerName("windows"), fileManagerName("linux")]).toEqual(["Finder", "파일 탐색기", "파일 관리자"]);
  });
});

describe("경로 잇기", () => {
  it("OS가 준 경로의 구분자를 그대로 쓴다", () => {
    expect(joinPath("/Users/a/방", "x.txt")).toBe("/Users/a/방/x.txt");
    expect(joinPath("/", "x.txt")).toBe("/x.txt");
    expect(joinPath("C:\\a", "x.txt")).toBe("C:\\a\\x.txt");
    expect(joinPath("D:\\", "x.txt")).toBe("D:\\x.txt");
    expect(joinPath("\\\\서버\\공유\\", "x.txt")).toBe("\\\\서버\\공유\\x.txt");
  });

  it("유닉스에서 \\는 구분자가 아니라 이름의 일부다", () => {
    expect(joinPath("/home/a/we\\ird", "x.txt")).toBe("/home/a/we\\ird/x.txt");
    expect(baseName("/home/a/we\\ird")).toBe("we\\ird");
  });

  it("폴더 이름을 고른다. 드라이브 뿌리도 빈 이름이 되지 않는다", () => {
    expect(folderName("C:\\Users\\준\\방")).toBe("방");
    expect(folderName("C:\\Users\\준\\방\\")).toBe("방");
    expect(folderName("/Users/준/방")).toBe("방");
    expect(folderName("E:\\")).toBe("E:");
    expect(folderName("/")).toBe("/");
  });

  it("같은 폴더: Windows는 대소문자·구분자를 가리지 않고, 유닉스는 대소문자를 가린다", () => {
    expect(samePath("C:\\Users\\A", "c:/users/a\\")).toBe(true);
    expect(sameFolder("C:\\Users\\A", "c:\\users\\a")).toBe(true);
    expect(samePath("/home/A", "/home/a")).toBe(false);
    expect(samePath("/Users/a/\u1100\u1161", "/Users/a/\uac00")).toBe(true);
    expect(sameFolder(undefined, "/a")).toBe(false);
  });

  it("집 폴더를 ~로 줄인다", () => {
    expect(shortPath("/Users/준/방")).toBe("~/방");
    expect(shortPath("/home/jun/방")).toBe("~/방");
    expect(shortPath("C:\\Users\\준\\방")).toBe("~\\방");
    expect(shortPath("D:\\작업\\방")).toBe("D:\\작업\\방");
  });
});

describe("Windows가 다르게 읽는 이름", () => {
  it("예약 이름·끝 점·콜론·금지 글자를 거절한다", () => {
    for (const name of ["CON", "con.txt", "NUL", "aux.tar.gz", "COM1", "lpt9.log", "COM¹", "이름.", "이름 ", "a.txt:숨김", "C:foo", "a?b", "a*b", "a<b", "a\\b", "a/b", "", "a\u0001b"]) {
      expect(isSafeWindowsName(name), name).toBe(false);
    }
    for (const name of ["보고서.pdf", "console.log", "conference.txt", "com10.txt", "보고서 (2).pdf", ".env", "a.b.c"]) expect(isSafeWindowsName(name), name).toBe(true);
  });

  it("Windows 폴더 안에서만 거절한다. 유닉스에서는 멀쩡한 이름이다", () => {
    expect(() => childPath("C:\\a", "CON")).toThrow();
    expect(() => childPath("C:\\a", "10:30 회의.txt")).toThrow();
    expect(childPath("/a", "CON")).toBe("/a/CON");
    expect(childPath("/a", "10:30 회의.txt")).toBe("/a/10:30 회의.txt");
  });

  it("앱이 보는 길 전부에서 탈출을 막는다", async () => {
    await expect(readPathFile(root, "C:foo")).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(readPathFile(root, "a.txt:숨김")).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(readPathFile(root, "..\\..\\비밀.txt")).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(openInApp(root, "참고/NUL")).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(invoke).not.toHaveBeenCalled();
    const result = await moveDoorFile(pathDirectory(root), "참고", pathDirectory(root), "CON");
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(disk.has(key(`${root}\\참고`))).toBe(true);
  });
});

describe("Windows 경로로 옮기기", () => {
  it("상자 안팎을 \\ 경로로 옮기고 읽는다", async () => {
    const room = pathDirectory(root);
    const to = (await freeBoxPath(room, "참고/시안.psd"))!;
    expect(to).toBe(`${box}/참고/시안.psd`);
    expect(await moveFile(room, "참고/시안.psd", to)).toEqual({ ok: true });
    expect(disk.get(key(`${root}\\${box}\\참고\\시안.psd`))?.data).toBe("원본");
    expect(await (await readPathFile(root, to)).text()).toBe("원본");
    expect(await moveFile(room, to, "참고/시안.psd")).toEqual({ ok: true });
    expect(disk.has(key(`${root}\\참고\\시안.psd`))).toBe(true);
  });

  it("대소문자만 다른 파일은 같은 자리로 보고 덮어쓰지 않는다", async () => {
    disk.set(key(`${root}\\${box}`), { dir: true });
    disk.set(key(`${root}\\${box}\\참고`), { dir: true });
    disk.set(key(`${root}\\${box}\\참고\\시안.PSD`), { data: "먼저 있던 것" });
    const room = pathDirectory(root);
    expect(await moveFile(room, "참고/시안.psd", `${box}/참고/시안.PSD`)).toMatchObject({ ok: false, reason: "occupied" });
    expect(await freeBoxPath(room, "참고/시안.psd")).toBe(`${box}/참고/시안 (2).psd`);
    expect(disk.get(key(`${root}\\${box}\\참고\\시안.psd`))?.data).toBe("먼저 있던 것");
    expect(disk.get(key(`${root}\\참고\\시안.psd`))?.data).toBe("원본");
  });

  it("폴더를 읽을 때도 \\로 내려간다", async () => {
    const seen: string[] = [];
    for await (const entry of (await pathSource(root).directory("참고")).list()) seen.push(entry.name);
    expect(seen).toEqual(["시안.psd"]);
    expect((await pathSource(`${root}\\참고`).file("시안.psd")).size).toBe(2);
  });

  it("드라이브 뿌리를 골라도 하위 경로가 맞고, 시스템 폴더는 방 후보에서 빠진다", async () => {
    disk.set("e:\\", { dir: true });
    disk.set("e:\\작업", { dir: true });
    disk.set("e:\\$recycle.bin", { dir: true });
    disk.set("e:\\system volume information", { dir: true });
    dialog.open.mockResolvedValue("E:\\");
    expect(await pickParent()).toEqual({ path: "E:\\", folders: [{ name: "작업", path: "E:\\작업" }] });
  });

  it("OS가 스스로 만드는 항목은 건너뛴다", () => {
    for (const name of ["$RECYCLE.BIN", "System Volume Information", "Thumbs.db", "desktop.ini", "lost+found", ".git", "node_modules"]) expect(isExcludedName(name), name).toBe(true);
    expect(isExcludedName("보고서.pdf")).toBe(false);
  });
});

describe("OS 오류 번호", () => {
  it("같은 번호도 OS마다 뜻이 다르다", () => {
    expect(osErrorKind("액세스가 거부되었습니다. (os error 5)", "windows")).toBe("denied");
    expect(osErrorKind("Input/output error (os error 5)", "linux")).toBeNull();
    expect(osErrorKind("Input/output error (os error 5)", "mac")).toBeNull();
    expect(osErrorKind("시스템이 파일을 다른 디스크 드라이브로 옮길 수 없습니다. (os error 17)", "windows")).toBe("crossDevice");
    expect(osErrorKind("File exists (os error 17)", "linux")).toBeNull();
    expect(osErrorKind("Invalid cross-device link (os error 18)", "linux")).toBe("crossDevice");
    expect(osErrorKind("Cross-device link (os error 18)", "mac")).toBe("crossDevice");
    expect(osErrorKind("지정된 경로를 찾을 수 없습니다. (os error 3)", "windows")).toBe("gone");
    expect(osErrorKind("No such process (os error 3)", "linux")).toBeNull();
    expect(osErrorKind("다른 프로세스가 사용 중입니다. (os error 32)", "windows")).toBe("busy");
    expect(osErrorKind("Permission denied (os error 13)", "mac")).toBe("denied");
    expect(osErrorKind("장치가 준비되지 않았습니다. (os error 21)", "windows")).toBe("gone");
    expect(osErrorKind("Is a directory (os error 21)", "linux")).toBeNull();
  });

  it("번호를 글보다 먼저 믿는다. 경로에 섞인 말에 속지 않는다", () => {
    expect(osErrorKind("failed to read D:\\not found\\a: 액세스 거부 (os error 5)", "windows")).toBe("denied");
    expect(osErrorKind("failed to read /not found/a: Permission denied (os error 13)", "linux")).toBe("denied");
  });

  it("플러그인의 영어 문구는 어느 OS든 같다", () => {
    for (const os of ["mac", "windows", "linux"] as const) {
      expect(osErrorKind("forbidden path: C:\\a", os)).toBe("denied");
      expect(osErrorKind("path not allowed on the configured scope", os)).toBe("denied");
      expect(osErrorKind("이상한 오류", os)).toBeNull();
    }
  });

  it("Windows 웹뷰에서 폴더 문제와 옮기기 문구로 이어진다", async () => {
    vi.stubGlobal("navigator", { userAgent: windowsUa });
    expect(folderProblem("액세스가 거부되었습니다. (os error 5)")).toBe("denied");
    expect(folderProblem("장치가 준비되지 않았습니다. (os error 21)")).toBe("gone");
    const failing = (text: string): MoveDirectory => ({
      getDirectoryHandle: async () => failing(text),
      getFileHandle: async (name) => {
        if (name === "자리.txt") throw new DOMException("없음", "NotFoundError");
        return { move: async () => { throw text; } };
      },
    });
    const move = (text: string) => moveDoorFile(failing(text), "원본.txt", failing(text), "자리.txt");
    expect(await move("다른 드라이브 (os error 17)")).toMatchObject({ message: "다른 디스크에 있는 폴더라 옮기지 못했어요. 파일 탐색기에서 직접 옮겨 주세요." });
    expect(await move("거부 (os error 5)")).toMatchObject({ message: "폴더 수정 권한이 없어요." });
    expect(await move("사용 중 (os error 32)")).toMatchObject({ message: "다른 앱이 파일을 쓰고 있어 옮기지 못했어요." });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    expect(await move("Cross-device link (os error 18)")).toMatchObject({ message: "다른 디스크에 있는 폴더라 옮기지 못했어요. Finder에서 직접 옮겨 주세요." });
    expect(await move("File exists (os error 17)")).toMatchObject({ message: "옮기지 못했어요." });
  });
});

describe("현관", () => {
  const item = { id: "i", folder: "C:\\다운로드", path: "a.pdf", name: "a.pdf", kind: "pdf", size: 1, lastModified: 0, since: 0 } as DoorItem;
  const room = (origin: string) => ({ id: origin, source: "handle", origin, createdAt: 0, workDays: [], care: { done: false } }) as unknown as Room;

  it("Windows에서 대소문자만 다른 같은 폴더는 받을 방이 아니다", () => {
    expect(doorTargets([room("c:\\다운로드\\"), room("C:\\방")], item).map((target) => target.origin)).toEqual(["C:\\방"]);
  });

  it("망가진 현관 기록은 그릴 수 없는 줄만 뺀다", () => {
    const state = normalizeDoorstep({ folders: ["/a", 3, null], items: [null, { id: "x" }, item], seen: {}, readAt: 1 });
    expect(state.folders).toEqual(["/a"]);
    expect(state.items).toEqual([item]);
    expect(normalizeDoorstep("망가짐").items).toEqual([]);
  });
});
