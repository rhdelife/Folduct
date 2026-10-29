import { afterEach, describe, expect, it } from "vitest";
import { createId, isUuid } from "../domain/ids";
import { limits } from "../domain/limits";
import type { Scene, Workspace } from "../domain/models";
import { stores } from "../repositories/schema";
import { openStorage, type FolductStorage, type WriteOperation } from "../services/storage";

const opened: { name: string; storage: FolductStorage }[] = [];

afterEach(async () => {
  for (const item of opened.splice(0)) item.storage.close();
});

async function useStorage(options?: { now?: () => number; onBeforeCommit?: (operation: WriteOperation) => void }) {
  const name = `folduct-test-${createId()}`;
  const result = await openStorage(name, options);
  if (!result.ok) throw new Error(result.error.message);
  opened.push({ name, storage: result.value });
  return { name, storage: result.value };
}

async function rawGet<T>(name: string, store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const tx = db.transaction(store, "readonly");
    const value = await new Promise<T | undefined>((resolve, reject) => {
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
    return value;
  } finally {
    db.close();
  }
}

function workspaceWithCard(workspace: Workspace, assetId: string, note: string): Workspace {
  const zone = workspace.zones[0];
  return {
    ...workspace,
    cards: [
      {
        id: createId(),
        assetId,
        title: "도입부",
        note,
        zoneId: zone.id,
        x: 24,
        y: 24,
        width: 240,
        height: 180,
        zIndex: 1,
      },
    ],
    selectedCardId: null,
  };
}

describe("저장소", () => {
  it("샘플을 저장한 뒤 다시 열어도 같은 프로젝트, 자료, 작업면, 장면이 읽힌다", async () => {
    let clock = 1_700_000_000_000;
    const { name, storage } = await useStorage({ now: () => clock });
    const created = await storage.createProject({
      name: "  영상 과제  ",
      coverColor: "#1f5a44",
      deskPosition: { x: 120, y: 80 },
      root: { sourceMode: "input", rootName: "영상", directoryHandle: null },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.project.name).toBe("영상 과제");
    expect(isUuid(created.value.project.id)).toBe(true);

    const asset = await storage.rememberAsset({
      projectId: created.value.project.id,
      relativePath: "참고/도입부.mp4",
      displayName: "도입부.mp4",
      kind: "video",
      size: 1200,
      lastModified: 10,
      availability: "available",
    });
    expect(asset.ok).toBe(true);
    if (!asset.ok) return;
    expect(isUuid(asset.value.id)).toBe(true);
    expect(asset.value.id).not.toContain("도입부");

    clock += 1000;
    const first = workspaceWithCard(created.value.workspace, asset.value.id, "도입부를 줄이기");
    const secondCard = {
      ...first.cards[0],
      id: createId(),
      note: "색만 비교",
      x: 280,
    };
    const saved = await storage.saveWorkspace(created.value.project.id, 1, { ...first, cards: [first.cards[0], secondCard] });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.revision).toBe(2);
    expect(saved.value.cards.map((card) => card.note)).toEqual(["도입부를 줄이기", "색만 비교"]);
    expect(new Set(saved.value.cards.map((card) => card.id)).size).toBe(2);
    expect(saved.value.cards.every((card) => card.assetId === asset.value.id)).toBe(true);

    const scene: Scene = {
      id: createId(),
      projectId: created.value.project.id,
      title: "중간 확인",
      type: "manual",
      createdAt: clock,
      sourceRevision: saved.value.revision,
      snapshot: structuredClone(saved.value),
      assetManifest: [
        {
          assetId: asset.value.id,
          relativePath: asset.value.relativePath,
          displayName: asset.value.displayName,
          size: asset.value.size,
          lastModified: asset.value.lastModified,
        },
      ],
    };
    const storedScene = await storage.putScene(scene);
    expect(storedScene.ok).toBe(true);
    scene.snapshot.cards[0].note = "저장 후 바꾼 메모";

    storage.close();
    const reopened = await openStorage(name);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    opened.push({ name, storage: reopened.value });
    const project = await reopened.value.getProject(created.value.project.id);
    const workspace = await reopened.value.getWorkspace(created.value.project.id);
    const again = await reopened.value.getAsset(asset.value.id);
    const sceneAgain = await reopened.value.getScene(scene.id);
    expect(project).toMatchObject({ name: "영상 과제", deskPosition: { x: 120, y: 80 }, updatedAt: clock });
    expect(workspace).toEqual(saved.value);
    expect(again).toEqual(asset.value);
    expect(sceneAgain?.snapshot.cards[0].note).toBe("도입부를 줄이기");
    expect(sceneAgain?.snapshot).not.toBe(workspace);
  });

  it("같은 경로의 자료는 수정 시각이 바뀌어도 ID를 유지하고 다른 경로는 새 ID를 만든다", async () => {
    const { storage } = await useStorage();
    const created = await storage.createProject({ name: "문서", coverColor: "#335544", deskPosition: { x: 0, y: 0 } });
    if (!created.ok) throw new Error(created.error.message);
    const other = await storage.createProject({ name: "다른 문서", coverColor: "#335544", deskPosition: { x: 10, y: 10 } });
    if (!other.ok) throw new Error(other.error.message);
    const first = await storage.rememberAsset({
      projectId: created.value.project.id,
      relativePath: "노트/초안.txt",
      displayName: "초안.txt",
      kind: "text",
      size: 4,
      lastModified: 111,
      availability: "available",
    });
    if (!first.ok) throw new Error(first.error.message);
    const changed = await storage.rememberAsset({
      projectId: created.value.project.id,
      relativePath: "노트/초안.txt",
      displayName: "초안.txt",
      kind: "text",
      size: 9,
      lastModified: 999,
      availability: "changed",
    });
    if (!changed.ok) throw new Error(changed.error.message);
    const moved = await storage.rememberAsset({
      projectId: created.value.project.id,
      relativePath: "노트/수정.txt",
      displayName: "수정.txt",
      kind: "text",
      size: 9,
      lastModified: 999,
      availability: "available",
    });
    if (!moved.ok) throw new Error(moved.error.message);
    const elsewhere = await storage.rememberAsset({
      projectId: other.value.project.id,
      relativePath: "노트/초안.txt",
      displayName: "초안.txt",
      kind: "text",
      size: 4,
      lastModified: 111,
      availability: "available",
    });
    if (!elsewhere.ok) throw new Error(elsewhere.error.message);
    expect(changed.value.id).toBe(first.value.id);
    expect(changed.value.size).toBe(9);
    expect(changed.value.lastModified).toBe(999);
    expect(moved.value.id).not.toBe(first.value.id);
    expect(elsewhere.value.id).not.toBe(first.value.id);
    expect(await storage.listAssets(created.value.project.id)).toHaveLength(2);
  });

  it("잘못된 입력은 거절하고 기존 작업면을 바꾸지 않는다", async () => {
    const { storage } = await useStorage();
    const created = await storage.createProject({ name: "검증", coverColor: "#112233", deskPosition: { x: 1, y: 1 } });
    if (!created.ok) throw new Error(created.error.message);
    const tooLong = await storage.createProject({ name: "가".repeat(81), coverColor: "#112233", deskPosition: { x: 1, y: 1 } });
    expect(tooLong.ok).toBe(false);
    const outside = await storage.createProject({ name: "밖", coverColor: "#112233", deskPosition: { x: 1441, y: 0 } });
    expect(outside.ok).toBe(false);
    const parentPath = await storage.rememberAsset({
      projectId: created.value.project.id,
      relativePath: "../secret.txt",
      displayName: "secret.txt",
      kind: "text",
      size: 1,
      lastModified: 1,
      availability: "available",
    });
    expect(parentPath.ok).toBe(false);
    const asset = await storage.rememberAsset({
      projectId: created.value.project.id,
      relativePath: "메모.txt",
      displayName: "메모.txt",
      kind: "text",
      size: 1,
      lastModified: 1,
      availability: "available",
    });
    if (!asset.ok) throw new Error(asset.error.message);
    const invalid = workspaceWithCard(created.value.workspace, asset.value.id, "가".repeat(limits.note + 1));
    const rejected = await storage.saveWorkspace(created.value.project.id, 1, invalid);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe("invalid");
    const leaked = await storage.saveWorkspace(created.value.project.id, 1, {
      ...workspaceWithCard(created.value.workspace, asset.value.id, "정상"),
      file: new File(["원본"], "메모.txt"),
    });
    expect(leaked.ok).toBe(false);
    const current = await storage.getWorkspace(created.value.project.id);
    expect(current).toEqual(created.value.workspace);
    expect(await storage.listProjects()).toHaveLength(1);
  });

  it("개정 번호가 다르면 충돌로 거절하고 저장된 내용을 유지한다", async () => {
    const { storage } = await useStorage();
    const created = await storage.createProject({ name: "충돌", coverColor: "#445566", deskPosition: { x: 8, y: 8 } });
    if (!created.ok) throw new Error(created.error.message);
    const asset = await storage.rememberAsset({
      projectId: created.value.project.id,
      relativePath: "a.txt",
      displayName: "a.txt",
      kind: "text",
      size: 1,
      lastModified: 1,
      availability: "available",
    });
    if (!asset.ok) throw new Error(asset.error.message);
    const saved = await storage.saveWorkspace(
      created.value.project.id,
      1,
      workspaceWithCard(created.value.workspace, asset.value.id, "먼저 저장"),
    );
    if (!saved.ok) throw new Error(saved.error.message);
    const conflict = await storage.saveWorkspace(
      created.value.project.id,
      1,
      workspaceWithCard(saved.value, asset.value.id, "늦게 도착"),
    );
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error.code).toBe("conflict");
    const current = await storage.getWorkspace(created.value.project.id);
    expect(current?.revision).toBe(2);
    expect(current?.cards[0].note).toBe("먼저 저장");
  });

  it("트랜잭션이 실패하면 앞서 저장된 프로젝트가 남는다", async () => {
    let writes = 0;
    const { storage } = await useStorage({
      onBeforeCommit: () => {
        writes += 1;
        if (writes > 1) throw new Error("디스크 공간 부족");
      },
    });
    const first = await storage.createProject({ name: "남길 프로젝트", coverColor: "#101010", deskPosition: { x: 4, y: 4 } });
    expect(first.ok).toBe(true);
    const second = await storage.createProject({ name: "실패할 프로젝트", coverColor: "#101010", deskPosition: { x: 8, y: 8 } });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("aborted");
    const projects = await storage.listProjects();
    expect(projects.map((project) => project.name)).toEqual(["남길 프로젝트"]);
    if (!first.ok) return;
    const saved = await storage.saveWorkspace(first.value.project.id, 1, {
      ...first.value.workspace,
      nextAction: "이 문장은 저장되면 안 됩니다",
    });
    expect(saved.ok).toBe(false);
    const workspace = await storage.getWorkspace(first.value.project.id);
    expect(workspace?.nextAction).toBe("");
    expect(workspace?.revision).toBe(1);
  });

  it("폴더 핸들은 루트 메타데이터와 다른 저장소에 둔다", async () => {
    const handle = { name: "과제 폴더" } as FileSystemDirectoryHandle;
    const { name, storage } = await useStorage();
    const created = await storage.createProject({
      name: "핸들",
      coverColor: "#222222",
      deskPosition: { x: 12, y: 12 },
      root: { sourceMode: "handle", rootName: "과제 폴더", directoryHandle: handle },
    });
    if (!created.ok || !created.value.root) throw new Error("root missing");
    storage.close();
    const root = await rawGet<Record<string, unknown>>(name, stores.roots, created.value.root.id);
    const storedHandle = await rawGet<{ directoryHandle: { name: string } }>(name, stores.rootHandles, created.value.root.id);
    const project = await rawGet<Record<string, unknown>>(name, stores.projects, created.value.project.id);
    expect(root && "directoryHandle" in root).toBe(false);
    expect(storedHandle?.directoryHandle.name).toBe("과제 폴더");
    expect(JSON.stringify(project)).not.toContain("과제 폴더");
    expect(JSON.stringify(project)).not.toContain("directoryHandle");
  });

  it("프로젝트 12개와 장면 200개를 넘기면 기존 기록을 유지한 채 거절한다", async () => {
    const { storage } = await useStorage();
    for (let index = 0; index < limits.projects; index += 1) {
      const created = await storage.createProject({
        name: `과제 ${index + 1}`,
        coverColor: "#333333",
        deskPosition: { x: index * 10, y: 0 },
      });
      expect(created.ok).toBe(true);
    }
    const overflow = await storage.createProject({ name: "열세 번째", coverColor: "#333333", deskPosition: { x: 0, y: 20 } });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.code).toBe("limit");
    expect(await storage.listProjects()).toHaveLength(limits.projects);

    const projects = await storage.listProjects();
    const projectId = projects[0].id;
    const workspace = await storage.getWorkspace(projectId);
    if (!workspace) throw new Error("workspace missing");
    for (let index = 0; index < limits.scenes; index += 1) {
      const scene = await storage.putScene({
        id: createId(),
        projectId,
        title: `장면 ${index + 1}`,
        type: "manual",
        createdAt: index + 1,
        sourceRevision: 1,
        snapshot: workspace,
        assetManifest: [],
      });
      expect(scene.ok).toBe(true);
    }
    const extra = await storage.putScene({
      id: createId(),
      projectId,
      title: "한도 초과",
      type: "manual",
      createdAt: 999,
      sourceRevision: 1,
      snapshot: workspace,
      assetManifest: [],
    });
    expect(extra.ok).toBe(false);
    if (extra.ok) return;
    expect(extra.error.code).toBe("limit");
    const kept = await storage.getWorkspace(projectId);
    expect(kept).toEqual(workspace);
  });

  it("저장된 장면은 같은 ID로 다시 쓰지 않는다", async () => {
    const { storage } = await useStorage();
    const created = await storage.createProject({ name: "장면", coverColor: "#444444", deskPosition: { x: 0, y: 0 } });
    if (!created.ok) throw new Error(created.error.message);
    const scene = {
      id: createId(),
      projectId: created.value.project.id,
      title: "처음",
      type: "pause" as const,
      createdAt: 5,
      sourceRevision: 1,
      snapshot: created.value.workspace,
      assetManifest: [],
    };
    expect((await storage.putScene(scene)).ok).toBe(true);
    expect((await storage.putScene({ ...scene, title: "바뀐 이름" })).ok).toBe(false);
    expect((await storage.getScene(scene.id))?.title).toBe("처음");
  });
});

describe("폴더 연결 저장", () => {
  it("프로젝트 두 개의 자료는 섞이지 않고 책상 위치는 다시 열어도 유지된다", async () => {
    const { name, storage } = await useStorage();
    const first = await storage.createConnectedProject(connectedInput("영상 폴더", "영상/메모.txt", { x: 40, y: 50 }));
    const second = await storage.createConnectedProject(connectedInput("문서 폴더", "문서/메모.txt", { x: 300, y: 50 }));
    if (!first.ok || !second.ok) throw new Error("연결 생성 실패");
    const moved = await storage.updateProject({
      projectId: first.value.project.id,
      deskPosition: { x: 18, y: 220 },
      deskPlacedByUser: true,
    });
    if (!moved.ok) throw new Error(moved.error.message);
    storage.close();
    const reopened = await openStorage(name);
    if (!reopened.ok) throw new Error(reopened.error.message);
    opened.push({ name, storage: reopened.value });
    const projects = await reopened.value.listProjects();
    expect(projects.map((project) => project.name).sort()).toEqual(["문서 폴더", "영상 폴더"]);
    expect(projects.find((project) => project.id === first.value.project.id)?.deskPosition).toEqual({ x: 18, y: 220 });
    expect(projects.find((project) => project.id === first.value.project.id)?.deskPlacedByUser).toBe(true);
    const firstAssets = await reopened.value.listAssets(first.value.project.id);
    const secondAssets = await reopened.value.listAssets(second.value.project.id);
    expect(firstAssets.map((asset) => asset.relativePath)).toEqual(["영상/메모.txt"]);
    expect(secondAssets.map((asset) => asset.relativePath)).toEqual(["문서/메모.txt"]);
  });

  it("연결 저장이 커밋 전에 실패하면 프로젝트와 자료가 남지 않는다", async () => {
    const { storage } = await useStorage({
      onBeforeCommit: (operation) => {
        if (operation === "createConnectedProject") throw new Error("디스크 실패");
      },
    });
    const created = await storage.createConnectedProject(connectedInput("실패", "a.txt", { x: 0, y: 0 }));
    expect(created.ok).toBe(false);
    expect(await storage.listProjects()).toEqual([]);
    expect(await storage.listAssets("00000000-0000-4000-8000-000000000000")).toEqual([]);
  });
});

function connectedInput(name: string, relativePath: string, deskPosition: { x: number; y: number }) {
  return {
    name,
    coverColor: "#1f5a44",
    deskPosition,
    root: { sourceMode: "input" as const, rootName: name, directoryHandle: null },
    files: [
      {
        relativePath,
        displayName: relativePath.split("/").pop() ?? relativePath,
        kind: "text" as const,
        size: 4,
        lastModified: 10,
        availability: "available" as const,
      },
    ],
    scan: { complete: true, collected: 1, failed: 0, stoppedReason: null },
    coverRelativePath: null,
  };
}

describe("스키마가 다를 때", () => {
  it("더 높은 버전과 빠진 저장소는 지우지 않고 거절한다", async () => {
    const deleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
    let deletions = 0;
    indexedDB.deleteDatabase = ((name: string) => {
      deletions += 1;
      return deleteDatabase(name);
    }) as IDBFactory["deleteDatabase"];

    try {
      const higher = `folduct-higher-${createId()}`;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(higher, 2);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("kept", { keyPath: "id" });
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("kept", "readwrite");
          tx.objectStore("kept").put({ id: "keep-me", note: "남겨 둠" });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
      const opened = await openStorage(higher);
      expect(opened.ok).toBe(false);
      if (opened.ok) return;
      expect(opened.error.code).toBe("schema-mismatch");
      expect(await rawGet<{ note: string }>(higher, "kept", "keep-me")).toEqual({ id: "keep-me", note: "남겨 둠" });

      const partial = `folduct-partial-${createId()}`;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(partial, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("projects", { keyPath: "id" });
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("projects", "readwrite");
          tx.objectStore("projects").put({ id: "legacy", name: "이전 기록" });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
      const mismatched = await openStorage(partial);
      expect(mismatched.ok).toBe(false);
      if (mismatched.ok) return;
      expect(mismatched.error.code).toBe("schema-mismatch");
      expect(await rawGet<{ name: string }>(partial, "projects", "legacy")).toMatchObject({ name: "이전 기록" });
      expect(deletions).toBe(0);
    } finally {
      indexedDB.deleteDatabase = deleteDatabase;
    }
  });
});
