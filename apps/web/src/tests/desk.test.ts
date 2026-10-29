import { afterEach, describe, expect, it } from "vitest";
import { createId } from "../domain/ids";
import { seedDemoIfEmpty } from "../services/demoDesk";
import { openStorage, type FolductStorage } from "../services/storage";
import { canSaveNewProject, sameNameWarning } from "../domain/connectPolicy";
import { clampDeskPosition, deskCard, deskSlots, firstOpenDeskPosition } from "../domain/deskLayout";
import { limits } from "../domain/limits";
import { isExcludedName, memoryDirectory, scanDirectory, scanFileList } from "../gateways/folderScan";
import type { MemoryNode } from "../gateways/folderScan";

describe("샘플 저장소", () => {
  const opened: FolductStorage[] = [];
  afterEach(() => {
    for (const storage of opened.splice(0)) storage.close();
  });

  it("동시에 준비해도 샘플 프로젝트는 하나만 만든다", async () => {
    const name = `folduct-demo-${createId()}`;
    const first = await openStorage(name);
    const second = await openStorage(name);
    if (!first.ok || !second.ok) throw new Error("저장소를 열지 못했습니다.");
    opened.push(first.value, second.value);
    await Promise.all([seedDemoIfEmpty(first.value), seedDemoIfEmpty(second.value)]);
    expect(await second.value.listProjects()).toHaveLength(1);
  });
});

describe("책상 배치", () => {
  it("비어 있는 첫 칸을 고르고 이미 놓인 좌표는 바꾸지 않는다", () => {
    const slots = deskSlots();
    const user = { x: 12, y: 300 };
    const before = [{ ...user }];
    expect(firstOpenDeskPosition([])).toEqual(slots[0]);
    expect(firstOpenDeskPosition([slots[0]])).toEqual(slots[1]);
    expect(firstOpenDeskPosition(before)).not.toEqual(user);
    expect(before).toEqual([user]);
  });

  it("이동한 좌표를 책상 안에 둔다", () => {
    expect(clampDeskPosition({ x: -20, y: 5000 })).toEqual({
      x: 0,
      y: limits.deskHeight - deskCard.height,
    });
  });
});

describe("폴더 수집", () => {
  it("숨김 파일과 node_modules를 제외하고 한글 경로를 유지한다", async () => {
    const scan = await scanDirectory(memoryDirectory([
      { kind: "file", name: ".hidden.txt" },
      { kind: "directory", name: "node_modules", children: [{ kind: "file", name: "pkg.js" }] },
      { kind: "directory", name: "자료", children: [{ kind: "file", name: "메모.txt", size: 4 }] },
    ]));
    expect(scan.complete).toBe(true);
    expect(scan.files.map((file) => file.relativePath)).toEqual(["자료/메모.txt"]);
    expect(isExcludedName(".git")).toBe(true);
  });

  it("깊이 10의 파일은 포함하고 그 아래는 남긴다", async () => {
    const included = await scanDirectory(memoryDirectory([nest(10, "안.txt")]));
    const excluded = await scanDirectory(memoryDirectory([nest(11, "밖.txt")]));
    expect(included.files.map((file) => file.displayName)).toEqual(["안.txt"]);
    expect(included.complete).toBe(true);
    expect(excluded.files).toEqual([]);
    expect(excluded.stoppedReason).toBe("depth-limit");
    expect(excluded.complete).toBe(false);
  });

  it("1,000개를 넘기면 부분 수집으로 멈춘다", async () => {
    const files: MemoryNode[] = Array.from({ length: 1001 }, (_, index) => ({ kind: "file" as const, name: `f${index}.txt` }));
    const scan = await scanDirectory(memoryDirectory(files));
    expect(scan.files).toHaveLength(1000);
    expect(scan.complete).toBe(false);
    expect(scan.stoppedReason).toBe("file-limit");
  });

  it("한 파일의 읽기 실패가 나머지 수집을 막지 않는다", async () => {
    const scan = await scanDirectory(memoryDirectory([
      { kind: "file", name: "깨짐.txt", error: "읽기 실패" },
      { kind: "file", name: "정상.txt", size: 2 },
    ]));
    expect(scan.files.map((file) => file.displayName)).toEqual(["정상.txt"]);
    expect(scan.failures).toHaveLength(1);
    expect(scan.complete).toBe(true);
  });

  it("취소하면 수집 결과를 완료로 보지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    const scan = await scanDirectory(memoryDirectory([{ kind: "file", name: "a.txt" }]), { signal: controller.signal });
    expect(scan.stoppedReason).toBe("cancelled");
    expect(scan.files).toHaveLength(0);
  });

  it("디렉터리 입력의 빈 목록과 한글 경로를 구분한다", () => {
    const empty = scanFileList([]);
    expect(empty.files).toHaveLength(0);
    expect(empty.rootName).toBe("");
    const file = new File(["내용"], "메모.txt", { type: "text/plain" });
    Object.defineProperty(file, "webkitRelativePath", { value: "다른 자료/메모.txt" });
    const named = new File(["내용"], "메모.txt", { type: "text/plain" });
    Object.defineProperty(named, "webkitRelativePath", { value: "자료집/메모.txt" });
    const first = scanFileList([file]);
    const second = scanFileList([named]);
    expect(first.rootName).toBe("다른 자료");
    expect(second.rootName).toBe("자료집");
    expect(first.files[0]?.relativePath).toBe("메모.txt");
    expect(second.files[0]?.relativePath).toBe("메모.txt");
    expect(first.rootName).not.toBe(second.rootName);
  });
});

describe("연결 확정", () => {
  it("취소와 빈 디렉터리 입력은 저장하지 않고 같은 이름만으로 합치지 않는다", () => {
    expect(canSaveNewProject({
      confirmed: false,
      sourceMode: "handle",
      fileCount: 3,
      failureCount: 0,
      cancelled: false,
      sameHandleProjectId: null,
    }).ok).toBe(false);
    expect(canSaveNewProject({
      confirmed: true,
      sourceMode: "input",
      fileCount: 0,
      failureCount: 0,
      cancelled: false,
      sameHandleProjectId: null,
    })).toEqual({ ok: false, reason: "empty-input" });
    expect(canSaveNewProject({
      confirmed: true,
      sourceMode: "handle",
      fileCount: 0,
      failureCount: 0,
      cancelled: false,
      sameHandleProjectId: null,
    }).ok).toBe(true);
    expect(sameNameWarning("input", 1)).toContain("같은 폴더로 연결하지 않습니다");
    expect(sameNameWarning("handle", 2)).toBeNull();
  });
});

function nest(depth: number, fileName: string): MemoryNode {
  if (depth === 0) return { kind: "file", name: fileName, size: 3 };
  return { kind: "directory", name: `단계${depth}`, children: [nest(depth - 1, fileName)] };
}
