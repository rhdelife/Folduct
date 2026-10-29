/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import capabilities from "../../src-tauri/capabilities/default.json";
import { scanFolder } from "../gateways/folder";
import { fileExists, freeBoxPath, moveFile } from "../gateways/mover";
import { openInApp, pathDirectory, pathSource, readPathFile } from "../gateways/native";

// 메모리 디스크. rename은 POSIX처럼 덮어쓰므로, 덮어쓰지 않는 건 어댑터가 지켜야 합니다.
type Entry = { dir?: boolean; link?: boolean; data?: string; mtime?: number };
const disk = vi.hoisted(() => new Map<string, { dir?: boolean; link?: boolean; data?: string; mtime?: number }>());

vi.mock("@tauri-apps/plugin-fs", () => {
  const get = (path: string): Entry => {
    const entry = disk.get(path);
    if (!entry) throw new Error(`No such file or directory: ${path}`);
    return entry;
  };
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  return {
    exists: async (path: string) => disk.has(path),
    stat: async (path: string) => {
      const entry = get(path);
      return { isFile: !entry.dir, isDirectory: !!entry.dir, size: entry.data?.length ?? 0, mtime: new Date(entry.mtime ?? 0) };
    },
    readDir: async (path: string) => {
      get(path);
      return [...disk.entries()]
        .filter(([child]) => parentOf(child) === path)
        .map(([child, entry]) => ({ name: child.slice(path.length + 1), isDirectory: !!entry.dir && !entry.link, isFile: !entry.dir && !entry.link, isSymlink: !!entry.link }));
    },
    mkdir: async (path: string) => {
      if (disk.has(path) || !disk.get(parentOf(path))?.dir) throw new Error(`mkdir failed: ${path}`);
      disk.set(path, { dir: true });
    },
    rename: async (from: string, to: string) => {
      disk.set(to, get(from));
      disk.delete(from);
    },
    readFile: async (path: string) => new TextEncoder().encode(get(path).data ?? ""),
  };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));

function seed() {
  disk.clear();
  disk.set("/p", { dir: true });
  disk.set("/p/참고", { dir: true });
  disk.set("/p/참고/시안.psd", { data: "원본", mtime: 5 });
}

describe("데스크톱 폴더 읽기", () => {
  it("숨김·node_modules·심볼릭 링크는 빼고, 이름은 NFC로, 크기와 고친 시각을 읽는다", async () => {
    seed();
    const nfd = "영상".normalize("NFD");
    disk.set("/p/.git", { dir: true });
    disk.set("/p/.git/HEAD", { data: "x" });
    disk.set("/p/node_modules", { dir: true });
    disk.set("/p/바로가기", { dir: true, link: true });
    disk.set(`/p/${nfd}`, { dir: true });
    disk.set(`/p/${nfd}/a.mov`, { data: "12345", mtime: 9 });
    const result = await scanFolder(pathSource("/p"));
    expect(result.files.map((file) => [file.path, file.kind, file.size, file.lastModified])).toEqual([
      ["참고/시안.psd", "design", 2, 5],
      ["영상/a.mov", "video", 5, 9],
    ]);
  });
});

describe("데스크톱 정리 상자 이동", () => {
  it("상자 폴더를 만들어 옮기고 되돌린다", async () => {
    seed();
    const root = pathDirectory("/p");
    const boxPath = await freeBoxPath(root, "참고/시안.psd");
    expect(boxPath).toBe("_Folduct 정리상자/참고/시안.psd");
    expect(await moveFile(root, "참고/시안.psd", boxPath!)).toEqual({ ok: true });
    expect(disk.get("/p/_Folduct 정리상자/참고/시안.psd")?.data).toBe("원본");
    expect(await fileExists(root, "참고/시안.psd")).toBe(false);
    expect(await moveFile(root, boxPath!, "참고/시안.psd")).toEqual({ ok: true });
    expect(disk.get("/p/참고/시안.psd")?.data).toBe("원본");
  });

  it("덮어쓰지 않는다: 겹치면 (2), 되돌릴 자리가 차 있으면 거절, 확인을 건너뛰어도 move가 거절", async () => {
    seed();
    const root = pathDirectory("/p");
    await moveFile(root, "참고/시안.psd", "_Folduct 정리상자/참고/시안.psd");
    disk.set("/p/참고/시안.psd", { data: "새 파일" });
    expect(await freeBoxPath(root, "참고/시안.psd")).toBe("_Folduct 정리상자/참고/시안 (2).psd");
    expect(await moveFile(root, "_Folduct 정리상자/참고/시안.psd", "참고/시안.psd")).toMatchObject({ ok: false, reason: "occupied" });
    const file = await (await (await root.getDirectoryHandle("_Folduct 정리상자")).getDirectoryHandle("참고")).getFileHandle("시안.psd");
    await expect(file.move!(await root.getDirectoryHandle("참고"), "시안.psd")).rejects.toThrow();
    expect(disk.get("/p/참고/시안.psd")?.data).toBe("새 파일");
    expect(disk.get("/p/_Folduct 정리상자/참고/시안.psd")?.data).toBe("원본");
  });

  it("상자 밖끼리, 프로젝트 밖 경로, 없는 파일은 거절한다", async () => {
    seed();
    const root = pathDirectory("/p");
    expect((await moveFile(root, "참고/시안.psd", "다른곳/시안.psd")).ok).toBe(false);
    expect((await moveFile(root, "../밖/시안.psd", "_Folduct 정리상자/시안.psd")).ok).toBe(false);
    expect(await moveFile(root, "참고/없음.psd", "_Folduct 정리상자/없음.psd")).toMatchObject({ ok: false, reason: "missing" });
    expect(disk.has("/p/_Folduct 정리상자")).toBe(false);
  });
});

describe("데스크톱 파일 열기", () => {
  it("방 안 경로만 읽고 열며, 보기 창이 틀 수 있게 형식을 붙인다", async () => {
    seed();
    disk.set("/p/clip.mov", { data: "v" });
    expect((await readPathFile("/p", "clip.mov")).type).toBe("video/quicktime");
    await expect(readPathFile("/p", "../etc/passwd")).rejects.toThrow();
    await expect(readPathFile("/p", "없음.txt")).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(openInApp("/p", "../밖/실행.command")).rejects.toThrow();
  });
});

describe("데스크톱 권한", () => {
  it("fs 권한은 읽기·폴더 만들기·이름 바꾸기뿐이고, 고정 경로 스코프를 두지 않는다", () => {
    const allowed = /^fs:allow-(read-dir|stat|exists|read-file|mkdir|rename)$/;
    expect(capabilities.permissions.filter((permission) => typeof permission !== "string" || (permission.startsWith("fs:") && !allowed.test(permission)))).toEqual([]);
  });

  it("앱 소스는 plugin-fs의 지우기·쓰기 함수를 가져오지 않는다", () => {
    const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../tests/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const names = Object.values(sources).flatMap((text) => [...text.matchAll(/import\s*{([^}]*)}\s*from\s*"@tauri-apps\/plugin-fs"/g)].flatMap((match) => match[1].split(",").map((name) => name.trim()).filter(Boolean)));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !["exists", "mkdir", "readDir", "readFile", "rename", "stat"].includes(name))).toEqual([]);
  });
});
