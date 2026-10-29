/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from "vitest";
import { boxPathCandidate, budgetLevel, budgetNoticeDue, careStage, defaultCardSize, defaultCare, GB, iconScale, localDay, normalizeCare, roomUsage, sizeStep, suggestBudget, sweepCandidates, touchedCardIds } from "../domain/care";
import { formatByteSize } from "../domain/preview";
import { placeCard } from "../domain/workspaceEdit";
import { createId } from "../domain/ids";
import type { Asset, Card, RootRecord, Workspace } from "../domain/models";
import { createInitialWorkspace } from "../domain/workspaceFactory";
import { fileExists, freeBoxPath, moveFile, type MoveDirectory, type MoveFile } from "../gateways/boxMover";
import { openStorage, type FolductStorage } from "../services/storage";

const day = 24 * 60 * 60 * 1000;
const start = new Date(2026, 9, 5, 12).getTime();

function card(patch: Partial<Card> = {}): Card {
  return { id: createId(), assetId: null, title: "카드", note: "", zoneId: null, x: 100, y: 100, width: 240, height: 180, zIndex: 1, ...patch };
}

function asset(patch: Partial<Asset> = {}): Asset {
  return { id: createId(), projectId: createId(), relativePath: "참고/a.png", displayName: "a.png", kind: "image", size: 10, lastModified: 0, availability: "available", ...patch };
}

function workspaceWith(cards: Card[]): Workspace {
  return { ...createInitialWorkspace(createId(), start), cards };
}

const care = defaultCare(createId());

describe("손댄 시각", () => {
  it("이동·크기·메모·선택은 손댄 것으로 세고, 보기 위치·겹침 순서는 세지 않는다", () => {
    const a = card();
    const b = card();
    const before = workspaceWith([a, b]);
    expect(touchedCardIds(before, { ...before, viewport: { x: 50, y: 50, scale: 1.2 } })).toEqual([]);
    expect(touchedCardIds(before, { ...before, cards: [{ ...a, zIndex: 9 }, b] })).toEqual([]);
    expect(touchedCardIds(before, { ...before, cards: [{ ...a, x: 140 }, b] })).toEqual([a.id]);
    expect(touchedCardIds(before, { ...before, cards: [a, { ...b, note: "왜 골랐나" }] })).toEqual([b.id]);
    expect(touchedCardIds(before, { ...before, selectedCardId: b.id })).toEqual([b.id]);
  });
});

describe("방치 판정", () => {
  const base = { touchedAt: start, care, pinned: false };

  it("방을 쓴 날이 없으면 오래돼도 쓰러지지 않는다", () => {
    expect(careStage({ ...base, now: start + 14 * day, workDays: [] }).stage).toBe("normal");
    expect(careStage({ ...base, now: start + 14 * day, workDays: [localDay(start)] }).stage).toBe("normal");
  });

  it("그 사이 방을 쓴 날이 있으면 3일에 기울고 7일에 쓰러진다", () => {
    const workDays = [localDay(start + day)];
    expect(careStage({ ...base, now: start + 2 * day, workDays }).stage).toBe("normal");
    expect(careStage({ ...base, now: start + 3 * day, workDays })).toEqual({ stage: "tilted", days: 3 });
    expect(careStage({ ...base, now: start + 7 * day, workDays })).toEqual({ stage: "fallen", days: 7 });
  });

  it("고정·쉬는 중·누락·원본이 나중에 수정된 파일은 쓰러지지 않는다", () => {
    const input = { ...base, now: start + 9 * day, workDays: [localDay(start + day)] };
    expect(careStage({ ...input, pinned: true }).stage).toBe("normal");
    expect(careStage({ ...input, care: { ...care, resting: true } }).stage).toBe("normal");
    expect(careStage({ ...input, availability: "missing" }).stage).toBe("normal");
    expect(careStage({ ...input, lastModified: start + 2 * day }).stage).toBe("normal");
    expect(careStage({ ...input, touchedAt: undefined }).stage).toBe("normal");
  });
});

describe("주간 정리 후보", () => {
  it("같은 파일을 쓰는 카드가 모두 쓰러졌을 때만, 파일 카드만 후보가 된다", () => {
    const shared = asset();
    const alone = asset({ relativePath: "참고/b.png", displayName: "b.png" });
    const oldA = card({ assetId: shared.id, note: "\n  표지 색감 참고  \n둘째 줄" });
    const freshA = card({ assetId: shared.id });
    const oldB = card({ assetId: alone.id });
    const memo = card();
    const now = start + 8 * day;
    const record = { ...care, touched: { [oldA.id]: start, [freshA.id]: now - day, [oldB.id]: start, [memo.id]: start } };
    const workDays = [localDay(start + day)];
    const only = sweepCandidates(workspaceWith([oldA, freshA, oldB, memo]), [shared, alone], record, workDays, now);
    expect(only.map((item) => item.asset.id)).toEqual([alone.id]);

    const both = sweepCandidates(workspaceWith([oldA, oldB]), [shared, alone], record, workDays, now);
    expect(both.find((item) => item.asset.id === shared.id)?.note).toBe("표지 색감 참고");
    expect(sweepCandidates(workspaceWith([oldA, oldB]), [shared, alone], { ...record, boxed: { [alone.id]: { state: "boxed", fromPath: "x", boxPath: "y", at: 0 } } }, workDays, now)).toHaveLength(1);
  });

  it("상자 안 경로는 원래 하위 폴더를 유지하고 겹치면 번호를 붙인다", () => {
    expect(boxPathCandidate("참고/색/시안.psd", 1)).toBe("_Folduct 정리상자/참고/색/시안.psd");
    expect(boxPathCandidate("시안.psd", 2)).toBe("_Folduct 정리상자/시안 (2).psd");
    expect(boxPathCandidate("README", 3)).toBe("_Folduct 정리상자/README (3)");
  });
});

// 실제 폴더 대신 쓰는 메모리 폴더입니다. move()는 Chrome의 FileSystemFileHandle.move와 같은 모양입니다.
type MemoryDir = { dirs: Map<string, MemoryDir>; files: Map<string, string> };

function memoryDir(): MemoryDir {
  return { dirs: new Map(), files: new Map() };
}

function notFound(): DOMException {
  return new DOMException("없음", "NotFoundError");
}

function view(dir: MemoryDir, withMove = true): MoveDirectory & { raw: MemoryDir } {
  return {
    raw: dir,
    async getDirectoryHandle(name, options) {
      let child = dir.dirs.get(name);
      if (!child) {
        if (!options?.create) throw notFound();
        child = memoryDir();
        dir.dirs.set(name, child);
      }
      return view(child, withMove);
    },
    async getFileHandle(name) {
      if (!dir.files.has(name)) throw notFound();
      const handle: MoveFile = {};
      if (withMove) {
        handle.move = async (destination, newName) => {
          const target = (destination as MoveDirectory & { raw: MemoryDir }).raw;
          const content = dir.files.get(name)!;
          dir.files.delete(name);
          target.files.set(newName, content);
        };
      }
      return handle;
    },
  };
}

function seed(): MemoryDir {
  const root = memoryDir();
  const ref = memoryDir();
  ref.files.set("시안.psd", "원본");
  root.dirs.set("참고", ref);
  return root;
}

describe("상자 폴더 이동", () => {
  it("파일을 상자로 옮기고 원래 자리로 되돌린다", async () => {
    const root = view(seed());
    const boxPath = await freeBoxPath(root, "참고/시안.psd");
    expect(boxPath).toBe("_Folduct 정리상자/참고/시안.psd");
    expect(await moveFile(root, "참고/시안.psd", boxPath!)).toEqual({ ok: true });
    expect(await fileExists(root, "참고/시안.psd")).toBe(false);
    expect(await fileExists(root, boxPath!)).toBe(true);
    expect(await moveFile(root, boxPath!, "참고/시안.psd")).toEqual({ ok: true });
    expect(await fileExists(root, "참고/시안.psd")).toBe(true);
  });

  it("상자 안에 같은 이름이 있으면 번호를 붙이고, 되돌릴 자리가 차 있으면 옮기지 않는다", async () => {
    const raw = seed();
    const root = view(raw);
    await moveFile(root, "참고/시안.psd", "_Folduct 정리상자/참고/시안.psd");
    raw.dirs.get("참고")!.files.set("시안.psd", "새 파일");
    expect(await freeBoxPath(root, "참고/시안.psd")).toBe("_Folduct 정리상자/참고/시안 (2).psd");
    const blocked = await moveFile(root, "_Folduct 정리상자/참고/시안.psd", "참고/시안.psd");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("occupied");
    expect(raw.dirs.get("참고")!.files.get("시안.psd")).toBe("새 파일");
  });

  it("상자 밖끼리의 이동, 위험한 경로, 이동을 못 하는 브라우저는 거절한다", async () => {
    const root = view(seed());
    expect((await moveFile(root, "참고/시안.psd", "다른곳/시안.psd")).ok).toBe(false);
    expect((await moveFile(root, "../밖/시안.psd", "_Folduct 정리상자/시안.psd")).ok).toBe(false);
    expect((await moveFile(root, "참고/없음.psd", "_Folduct 정리상자/없음.psd"))).toMatchObject({ ok: false, reason: "missing" });
    expect(await moveFile(view(seed(), false), "참고/시안.psd", "_Folduct 정리상자/시안.psd")).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("앱 소스는 원본 파일을 지우거나 고쳐 쓰는 API를 쓰지 않는다", () => {
    const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../tests/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const offenders = Object.entries(sources).filter(([, text]) => /\b(removeEntry|createWritable)\s*\(/.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

const opened: FolductStorage[] = [];
afterEach(() => {
  for (const storage of opened.splice(0)) storage.close();
});

describe("상자 기록 저장", () => {
  it("자료 경로와 상자 기록을 함께 바꾸고, 같은 경로가 있으면 거절한다", async () => {
    const result = await openStorage(`folduct-test-${createId()}`);
    if (!result.ok) throw new Error(result.error.message);
    const storage = result.value;
    opened.push(storage);
    const created = await storage.createProject({ name: "방", coverColor: "#36432a", deskPosition: { x: 0, y: 0 } });
    if (!created.ok) throw new Error(created.error.message);
    const projectId = created.value.project.id;
    const file = await storage.rememberAsset({ projectId, relativePath: "참고/시안.psd", displayName: "시안.psd", kind: "design", size: 5, lastModified: 0, availability: "available" });
    const other = await storage.rememberAsset({ projectId, relativePath: "참고/다른.psd", displayName: "다른.psd", kind: "design", size: 5, lastModified: 0, availability: "available" });
    if (!file.ok || !other.ok) throw new Error("자료 저장 실패");

    const entry = { state: "boxed" as const, fromPath: "참고/시안.psd", boxPath: "_Folduct 정리상자/참고/시안.psd", at: start };
    const moved = await storage.setBoxEntry(projectId, file.value.id, entry, entry.boxPath);
    expect(moved.ok).toBe(true);
    expect((await storage.getAsset(file.value.id))?.relativePath).toBe(entry.boxPath);
    expect((await storage.getCare(projectId)).boxed[file.value.id]?.state).toBe("boxed");

    const clash = await storage.setBoxEntry(projectId, other.value.id, null, entry.boxPath);
    expect(clash.ok).toBe(false);
    expect((await storage.getAsset(other.value.id))?.relativePath).toBe("참고/다른.psd");

    const back = await storage.setBoxEntry(projectId, file.value.id, null, "참고/시안.psd");
    expect(back.ok).toBe(true);
    expect((await storage.getCare(projectId)).boxed).toEqual({});
  });

  it("정리 전 안전 장면은 현재 작업을 바꾸지 않고, 처음 본 카드만 손댄 시각을 받는다", async () => {
    const result = await openStorage(`folduct-test-${createId()}`);
    if (!result.ok) throw new Error(result.error.message);
    const storage = result.value;
    opened.push(storage);
    const created = await storage.createProject({ name: "방", coverColor: "#36432a", deskPosition: { x: 0, y: 0 } });
    if (!created.ok) throw new Error(created.error.message);
    const projectId = created.value.project.id;
    const before = await storage.getWorkspace(projectId);
    const scene = await storage.captureSafetyScene(projectId, "주간 정리 전");
    expect(scene.ok && scene.value.type).toBe("safety");
    expect((await storage.getWorkspace(projectId))?.revision).toBe(before?.revision);

    await storage.noticeCards(projectId, ["a"], 100);
    await storage.noticeCards(projectId, ["a", "b"], 200);
    expect((await storage.getCare(projectId)).touched).toEqual({ a: 100, b: 200 });
  });
});

describe("물건 크기와 방 용량", () => {
  const MB = 1024 ** 2;
  const scanned = (complete: boolean, failed = 0): RootRecord => ({ id: "r", projectId: "p", sourceMode: "handle", rootName: "방", lastScanAt: start, scan: { complete, collected: 3, failed, stoppedReason: complete ? null : "file-limit" } });

  it("1MB·10MB·100MB·1GB 경계에서 한 단계씩 오른다", () => {
    expect([0, MB - 1, MB, 10 * MB - 1, 10 * MB, 100 * MB - 1, 100 * MB, GB - 1, GB, 40 * GB].map(sizeStep)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(iconScale(GB)).toBe(1.75);
    expect(defaultCardSize(null)).toEqual({ width: 240, height: 180 });
    expect(defaultCardSize(5 * GB)).toEqual({ width: 380, height: 285 });
    expect(formatByteSize(1.2 * GB)).toBe("1.2GB");
    expect(formatByteSize(5 * GB)).toBe("5GB");
  });

  it("새 카드만 용량 단계 크기를 받고, 이미 놓인 카드 크기는 그대로다", () => {
    const old = card({ width: 300, height: 140 });
    const placed = placeCard(workspaceWith([old]), { assetId: createId(), title: "영상.mov", at: { x: 400, y: 400 }, size: defaultCardSize(2 * GB) });
    if (!placed.ok) throw new Error(placed.message);
    expect(placed.workspace.cards[0]).toEqual(old);
    expect(placed.workspace.cards[1]).toMatchObject({ width: 380, height: 285 });
  });

  it("같은 자료는 한 번만 세고, 상자 안 파일은 합계에 넣어 따로 보여준다", () => {
    const a = asset({ size: 2 * GB });
    const boxed = asset({ size: GB, relativePath: "_Folduct 정리상자/참고/a.png" });
    const gone = asset({ size: 9 * GB, availability: "missing" });
    expect(roomUsage([a, a, boxed, gone], scanned(true), care)).toEqual({ totalBytes: 3 * GB, boxBytes: GB, exact: true });
  });

  it("부분 스캔은 최소값이라 방 크기를 넘어도 경고하지 않는다", () => {
    const big = [asset({ size: 9 * GB })];
    expect(budgetLevel(roomUsage(big, scanned(false), care), GB)).toBe("partial");
    expect(budgetLevel(roomUsage(big, scanned(true, 2), care), GB)).toBe("partial");
    expect(budgetLevel(roomUsage(big, null, care), GB)).toBe("partial");
    const full = roomUsage(big, scanned(true), care);
    expect(budgetLevel(full, null)).toBe("unset");
    expect(budgetLevel(full, 20 * GB)).toBe("ok");
    expect(budgetLevel(full, 11 * GB)).toBe("near");
    expect(budgetLevel(full, 5 * GB)).toBe("over");
  });

  it("넘친 방 배너는 주 1회, 제안값은 현재 × 1.5를 GB로 반올림한다", () => {
    const usage = roomUsage([asset({ size: 6 * GB })], scanned(true), care);
    const over = { ...care, budgetBytes: 5 * GB };
    expect(budgetNoticeDue(usage, over, start)).toBe(true);
    expect(budgetNoticeDue(usage, { ...over, budgetNoticeAt: start }, start + 6 * day)).toBe(false);
    expect(budgetNoticeDue(usage, { ...over, budgetNoticeAt: start }, start + 7 * day)).toBe(true);
    expect(suggestBudget(2.1 * GB)).toBe(3 * GB);
    expect(suggestBudget(100 * MB)).toBe(GB);
    expect(normalizeCare({ budgetBytes: -1, budgetNoticeAt: "x" }, "p")).toMatchObject({ budgetBytes: null, budgetNoticeAt: null });
  });

  it("방 크기는 care 기록에 저장된다", async () => {
    const result = await openStorage(`folduct-test-${createId()}`);
    if (!result.ok) throw new Error(result.error.message);
    const storage = result.value;
    opened.push(storage);
    const projectId = createId();
    expect((await storage.updateCare(projectId, { budgetBytes: 5 * GB })).ok).toBe(true);
    expect((await storage.getCare(projectId)).budgetBytes).toBe(5 * GB);
    await storage.updateCare(projectId, { budgetBytes: null });
    expect((await storage.getCare(projectId)).budgetBytes).toBeNull();
  });
});
