import { careKey, localDay, normalizeCare, type BoxEntry, type CareRecord, type CareSettings } from "../domain/care";
import { createId, isUuid } from "../domain/ids";
import { limits } from "../domain/limits";
import type {
  Asset,
  ConnectedFileInput,
  CreatedProject,
  CreateConnectedProjectInput,
  CreateProjectInput,
  Project,
  RememberAssetInput,
  RootHandleRecord,
  RootRecord,
  Scene,
  SceneType,
  UpdateProjectInput,
  Workspace,
} from "../domain/models";
import { fail, ok, type Result } from "../domain/result";
import { isSafeRelativePath, normalizeAssetFields, normalizeProjectFields, normalizeRootFields, normalizeScene, normalizeWorkspace } from "../domain/validation";
import { createInitialWorkspace } from "../domain/workspaceFactory";
import { stores } from "./schema";

export type WriteOperation = "createProject" | "createConnectedProject" | "updateProject" | "saveWorkspace" | "rememberAsset" | "putScene" | "captureScene" | "continueFromScene" | "updateCare" | "setBoxEntry" | "captureSafetyScene" | "setSweep";
export type SceneCaptureInput = {
  projectId: string;
  expectedRevision: number;
  workspace: Workspace;
  title: string;
  type: "pause" | "manual";
  requestId: string;
};
export type SceneCapture = { scene: Scene; workspace: Workspace };

export type RepositoryOptions = {
  now?: () => number;
  onBeforeCommit?: (operation: WriteOperation) => void;
};

function request<T>(made: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    made.onsuccess = () => resolve(made.result);
    made.onerror = () => reject(made.error ?? new Error("저장소 요청이 실패했습니다."));
  });
}

type ActivityRecord = { key: string; days: string[] };
type SweepRecord = { key: "care:sweep"; lastSweepAt: number | null };

function activityStart(now: number): string {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - 29);
  return localDay(date.getTime());
}

async function markActivity(tx: IDBTransaction, projectId: string, now: number) {
  const store = tx.objectStore(stores.settings);
  const key = `activity:${projectId}`;
  const previous = await request<ActivityRecord | undefined>(store.get(key));
  const days = new Set((previous?.days ?? []).filter((day) => day >= activityStart(now)));
  days.add(localDay(now));
  await request(store.put({ key, days: [...days].sort() }));
}

async function withWrite<T>(
  db: IDBDatabase,
  storeNames: string[],
  operation: WriteOperation,
  options: RepositoryOptions,
  run: (tx: IDBTransaction) => Promise<Result<T>>,
): Promise<Result<T>> {
  const tx = db.transaction(storeNames, "readwrite");
  let finished = false;
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      finished = true;
      resolve();
    };
    tx.onabort = () => {
      finished = true;
      reject(tx.error ?? new DOMException("쓰기 트랜잭션이 취소되었습니다.", "AbortError"));
    };
    tx.onerror = () => {
      finished = true;
      reject(tx.error ?? new Error("쓰기에 실패했습니다."));
    };
  });

  try {
    const result = await run(tx);
    if (result.ok) options.onBeforeCommit?.(operation);
    await completed;
    return result;
  } catch (error) {
    if (!finished) {
      try {
        tx.abort();
      } catch {
        // 이미 취소되었거나 끝난 트랜잭션입니다.
      }
      await completed.catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "저장이 취소되었습니다.";
    return fail("aborted", message);
  }
}

export class FolductRepository {
  constructor(
    private readonly db: IDBDatabase,
    private readonly options: RepositoryOptions = {},
  ) {}

  close() {
    this.db.close();
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  async listProjects(): Promise<Project[]> {
    const tx = this.db.transaction(stores.projects, "readonly");
    const projects = await request<Project[]>(tx.objectStore(stores.projects).getAll());
    return projects.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, "ko"));
  }

  async getProject(id: string): Promise<Project | null> {
    const tx = this.db.transaction(stores.projects, "readonly");
    const project = await request<Project | undefined>(tx.objectStore(stores.projects).get(id));
    return project ?? null;
  }

  async getWorkspace(projectId: string): Promise<Workspace | null> {
    const tx = this.db.transaction(stores.workspaces, "readonly");
    const workspace = await request<Workspace | undefined>(tx.objectStore(stores.workspaces).get(projectId));
    return workspace ?? null;
  }

  async getRoot(id: string): Promise<RootRecord | null> {
    const tx = this.db.transaction(stores.roots, "readonly");
    const root = await request<RootRecord | undefined>(tx.objectStore(stores.roots).get(id));
    return root ?? null;
  }

  async getDirectoryHandle(rootId: string): Promise<FileSystemDirectoryHandle | null> {
    const tx = this.db.transaction(stores.rootHandles, "readonly");
    const record = await request<RootHandleRecord | undefined>(tx.objectStore(stores.rootHandles).get(rootId));
    return record?.directoryHandle ?? null;
  }

  async getAsset(id: string): Promise<Asset | null> {
    const tx = this.db.transaction(stores.assets, "readonly");
    const asset = await request<Asset | undefined>(tx.objectStore(stores.assets).get(id));
    return asset ?? null;
  }

  async listAssets(projectId: string): Promise<Asset[]> {
    const tx = this.db.transaction(stores.assets, "readonly");
    const assets = await request<Asset[]>(tx.objectStore(stores.assets).index("projectId").getAll(projectId));
    return assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "ko"));
  }

  async getScene(id: string): Promise<Scene | null> {
    const tx = this.db.transaction(stores.scenes, "readonly");
    const scene = await request<Scene | undefined>(tx.objectStore(stores.scenes).get(id));
    return scene ?? null;
  }

  async listScenes(projectId: string): Promise<Scene[]> {
    const tx = this.db.transaction(stores.scenes, "readonly");
    const range = IDBKeyRange.bound([projectId, 0], [projectId, Number.MAX_SAFE_INTEGER]);
    const scenes = await request<Scene[]>(tx.objectStore(stores.scenes).index("projectCreated").getAll(range));
    return scenes.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getRecentWorkDays(projectId: string): Promise<number | null> {
    const tx = this.db.transaction(stores.settings, "readonly");
    const record = await request<ActivityRecord | undefined>(tx.objectStore(stores.settings).get(`activity:${projectId}`));
    if (!record || !Array.isArray(record.days)) return null;
    const start = activityStart(this.now());
    const today = localDay(this.now());
    return record.days.filter((day) => typeof day === "string" && day >= start && day <= today).length;
  }

  captureScene(input: SceneCaptureInput): Promise<Result<SceneCapture>> {
    if (!isUuid(input.projectId) || !isUuid(input.requestId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      return Promise.resolve(fail("invalid", "장면 저장 요청이 올바르지 않습니다."));
    }
    if (input.type !== "pause" && input.type !== "manual") return Promise.resolve(fail("invalid", "장면 유형이 올바르지 않습니다."));
    const normalized = normalizeWorkspace(input.workspace, input.projectId);
    if (!normalized.ok) return Promise.resolve(normalized);
    return withWrite(this.db, [stores.projects, stores.workspaces, stores.scenes, stores.assets, stores.settings], "captureScene", this.options, async (tx) => {
      const scenes = tx.objectStore(stores.scenes);
      const existing = await request<Scene | undefined>(scenes.get(input.requestId));
      if (existing) {
        if (existing.projectId !== input.projectId || existing.type !== input.type) return fail("invalid", "요청 ID가 다른 장면에 쓰였습니다.");
        const current = await request<Workspace | undefined>(tx.objectStore(stores.workspaces).get(input.projectId));
        return current ? ok({ scene: existing, workspace: current }) : fail("not-found", "작업면을 찾지 못했습니다.");
      }
      const projects = tx.objectStore(stores.projects);
      const project = await request<Project | undefined>(projects.get(input.projectId));
      const workspaces = tx.objectStore(stores.workspaces);
      const current = await request<Workspace | undefined>(workspaces.get(input.projectId));
      if (!project || !current) return fail("not-found", "프로젝트 작업면을 찾지 못했습니다.");
      if (current.revision !== input.expectedRevision) return fail("conflict", "다른 탭에서 작업면이 바뀌었습니다. 장면을 남기지 않았습니다.");
      const range = IDBKeyRange.bound([input.projectId, 0], [input.projectId, Number.MAX_SAFE_INTEGER]);
      if ((await request<number>(scenes.index("projectCreated").count(range))) >= limits.scenes) return fail("limit", "장면은 200개까지 남길 수 있습니다.");
      const assets = await request<Asset[]>(tx.objectStore(stores.assets).index("projectId").getAll(input.projectId));
      const assetById = new Map(assets.map((asset) => [asset.id, asset]));
      for (const card of normalized.value.cards) {
        if (card.assetId && !assetById.has(card.assetId)) return fail("invalid", "참조할 수 없는 자료가 있습니다.");
      }
      const now = this.now();
      const next: Workspace = { ...structuredClone(normalized.value), revision: current.revision + 1, updatedAt: now };
      const scene: Scene = {
        id: input.requestId,
        projectId: input.projectId,
        title: input.title,
        type: input.type as SceneType,
        createdAt: now,
        sourceRevision: next.revision,
        snapshot: structuredClone(next),
        assetManifest: assets.map((asset) => ({ assetId: asset.id, relativePath: asset.relativePath, displayName: asset.displayName, size: asset.size, lastModified: asset.lastModified })),
      };
      const checked = normalizeScene(scene);
      if (!checked.ok) return checked;
      await request(workspaces.put(next));
      await request(scenes.put(checked.value));
      await request(projects.put({ ...project, updatedAt: now, lastPausedSceneId: input.type === "pause" ? scene.id : project.lastPausedSceneId }));
      await markActivity(tx, input.projectId, now);
      return ok({ scene: checked.value, workspace: next });
    });
  }

  continueFromScene(projectId: string, sceneId: string, expectedRevision: number): Promise<Result<{ safety: Scene; workspace: Workspace }>> {
    if (!isUuid(projectId) || !isUuid(sceneId) || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return Promise.resolve(fail("invalid", "장면 이어가기 요청이 올바르지 않습니다."));
    }
    return withWrite(this.db, [stores.projects, stores.workspaces, stores.scenes, stores.assets, stores.settings], "continueFromScene", this.options, async (tx) => {
      const projects = tx.objectStore(stores.projects);
      const project = await request<Project | undefined>(projects.get(projectId));
      const workspaces = tx.objectStore(stores.workspaces);
      const current = await request<Workspace | undefined>(workspaces.get(projectId));
      const scenes = tx.objectStore(stores.scenes);
      const selected = await request<Scene | undefined>(scenes.get(sceneId));
      if (!project || !current || !selected || selected.projectId !== projectId) return fail("not-found", "장면이나 작업면을 찾지 못했습니다.");
      if (current.revision !== expectedRevision) return fail("conflict", "다른 탭에서 작업면이 바뀌었습니다. 전환하지 않았습니다.");
      const range = IDBKeyRange.bound([projectId, 0], [projectId, Number.MAX_SAFE_INTEGER]);
      if ((await request<number>(scenes.index("projectCreated").count(range))) >= limits.scenes) return fail("limit", "안전 장면을 남길 공간이 없어 전환하지 않았습니다.");
      const checked = normalizeScene(selected);
      if (!checked.ok) return checked;
      const assets = await request<Asset[]>(tx.objectStore(stores.assets).index("projectId").getAll(projectId));
      const assetIds = new Set(assets.map((asset) => asset.id));
      if (checked.value.snapshot.cards.some((card) => card.assetId && !assetIds.has(card.assetId))) {
        return fail("invalid", "장면의 자료 참조를 확인할 수 없어 전환하지 않았습니다.");
      }
      const now = this.now();
      const safety: Scene = {
        id: createId(), projectId, title: `전환 전 작업 ${new Date(now).toLocaleString("ko-KR")}`,
        type: "safety", createdAt: now, sourceRevision: current.revision,
        snapshot: structuredClone(current),
        assetManifest: assets.map((asset) => ({ assetId: asset.id, relativePath: asset.relativePath, displayName: asset.displayName, size: asset.size, lastModified: asset.lastModified })),
      };
      const validSafety = normalizeScene(safety);
      if (!validSafety.ok) return validSafety;
      const next: Workspace = { ...structuredClone(checked.value.snapshot), revision: current.revision + 1, updatedAt: now };
      await request(scenes.put(validSafety.value));
      await request(workspaces.put(next));
      await request(projects.put({ ...project, updatedAt: now }));
      await markActivity(tx, projectId, now);
      return ok({ safety: validSafety.value, workspace: next });
    });
  }

  createProject(input: CreateProjectInput): Promise<Result<CreatedProject>> {
    const fields = normalizeProjectFields(input);
    if (!fields.ok) return Promise.resolve(fields);
    const rootFields = input.root ? normalizeRootFields(input.root) : ok(null);
    if (!rootFields.ok) return Promise.resolve(rootFields);
    const handle = input.root?.directoryHandle ?? null;

    return withWrite(this.db, [stores.projects, stores.roots, stores.rootHandles, stores.workspaces], "createProject", this.options, async (tx) => {
      const count = await request<number>(tx.objectStore(stores.projects).count());
      if (count >= limits.projects) return fail("limit", "프로젝트는 12개까지 만들 수 있습니다.");
      const now = this.now();
      const projectId = createId();
      const root = rootFields.value
        ? {
            id: createId(),
            projectId,
            sourceMode: rootFields.value.sourceMode,
            rootName: rootFields.value.rootName,
            lastScanAt: null,
            scan: null,
          }
        : null;
      const project: Project = {
        id: projectId,
        name: fields.value.name,
        createdAt: now,
        updatedAt: now,
        coverAssetId: null,
        coverColor: fields.value.coverColor,
        deskPosition: fields.value.deskPosition,
        deskPlacedByUser: false,
        rootRefId: root?.id ?? null,
        lastPausedSceneId: null,
      };
      const workspace = createInitialWorkspace(projectId, now);
      await request(tx.objectStore(stores.projects).put(project));
      if (root) await request(tx.objectStore(stores.roots).put(root));
      if (root && handle) {
        await request(tx.objectStore(stores.rootHandles).put({ rootId: root.id, directoryHandle: handle }));
      }
      await request(tx.objectStore(stores.workspaces).put(workspace));
      return ok({ project, workspace, root });
    });
  }

  rememberAsset(input: RememberAssetInput): Promise<Result<Asset>> {
    const fields = normalizeAssetFields(input);
    if (!fields.ok) return Promise.resolve(fields);
    return withWrite(this.db, [stores.assets, stores.projects], "rememberAsset", this.options, async (tx) => {
      const project = await request<Project | undefined>(tx.objectStore(stores.projects).get(fields.value.projectId));
      if (!project) return fail("not-found", "프로젝트를 찾지 못했습니다.");
      const index = tx.objectStore(stores.assets).index("projectPath");
      const current = await request<Asset | undefined>(index.get([fields.value.projectId, fields.value.relativePath]));
      const asset: Asset = { ...fields.value, id: current?.id ?? createId() };
      await request(tx.objectStore(stores.assets).put(asset));
      return ok(asset);
    });
  }

  saveWorkspace(projectId: string, expectedRevision: number, workspace: unknown): Promise<Result<Workspace>> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return Promise.resolve(fail("invalid", "기대하는 개정 번호가 올바르지 않습니다."));
    }
    const normalized = normalizeWorkspace(workspace, projectId);
    if (!normalized.ok) return Promise.resolve(normalized);
    return withWrite(this.db, [stores.workspaces, stores.projects, stores.assets, stores.settings], "saveWorkspace", this.options, async (tx) => {
      const projects = tx.objectStore(stores.projects);
      const project = await request<Project | undefined>(projects.get(projectId));
      if (!project) return fail("not-found", "프로젝트를 찾지 못했습니다.");
      const workspaces = tx.objectStore(stores.workspaces);
      const current = await request<Workspace | undefined>(workspaces.get(projectId));
      if (!current) return fail("not-found", "작업면을 찾지 못했습니다.");
      if (current.revision !== expectedRevision) {
        return fail("conflict", "다른 탭에서 이미 저장했습니다. 현재 작업을 덮어쓰지 않았습니다.");
      }
      for (const card of normalized.value.cards) {
        if (!card.assetId) continue;
        const asset = await request<Asset | undefined>(tx.objectStore(stores.assets).get(card.assetId));
        if (!asset || asset.projectId !== projectId) return fail("invalid", "카드가 이 프로젝트의 자료를 가리키지 않습니다.");
      }
      for (const media of normalized.value.mediaPositions) {
        const asset = await request<Asset | undefined>(tx.objectStore(stores.assets).get(media.assetId));
        if (!asset || asset.projectId !== projectId) return fail("invalid", "재생 위치가 이 프로젝트의 자료를 가리키지 않습니다.");
      }
      const next: Workspace = {
        ...normalized.value,
        revision: expectedRevision + 1,
        updatedAt: this.now(),
      };
      await request(workspaces.put(next));
      await request(projects.put({ ...project, updatedAt: next.updatedAt }));
      if (JSON.stringify([current.cards, current.zones, current.nextAction]) !== JSON.stringify([next.cards, next.zones, next.nextAction])) {
        await markActivity(tx, projectId, next.updatedAt);
      }
      return ok(next);
    });
  }

  putScene(input: unknown): Promise<Result<Scene>> {
    const scene = normalizeScene(input);
    if (!scene.ok) return Promise.resolve(scene);
    return withWrite(this.db, [stores.scenes, stores.projects], "putScene", this.options, async (tx) => {
      const project = await request<Project | undefined>(tx.objectStore(stores.projects).get(scene.value.projectId));
      if (!project) return fail("not-found", "프로젝트를 찾지 못했습니다.");
      const sceneStore = tx.objectStore(stores.scenes);
      const existing = await request<Scene | undefined>(sceneStore.get(scene.value.id));
      if (existing) return fail("invalid", "이미 저장된 장면은 바꾸지 않습니다.");
      const range = IDBKeyRange.bound([scene.value.projectId, 0], [scene.value.projectId, Number.MAX_SAFE_INTEGER]);
      const count = await request<number>(sceneStore.index("projectCreated").count(range));
      if (count >= limits.scenes) return fail("limit", "장면은 200개까지 남길 수 있습니다.");
      const stored = structuredClone(scene.value);
      await request(sceneStore.put(stored));
      return ok(stored);
    });
  }

  async listRoots(): Promise<RootRecord[]> {
    const tx = this.db.transaction(stores.roots, "readonly");
    return request<RootRecord[]>(tx.objectStore(stores.roots).getAll());
  }

  updateProject(input: UpdateProjectInput): Promise<Result<Project>> {
    if (!isUuid(input.projectId)) return Promise.resolve(fail("invalid", "프로젝트 ID가 올바르지 않습니다."));
    return withWrite(this.db, [stores.projects, stores.assets], "updateProject", this.options, async (tx) => {
      const projects = tx.objectStore(stores.projects);
      const current = await request<Project | undefined>(projects.get(input.projectId));
      if (!current) return fail("not-found", "프로젝트를 찾지 못했습니다.");
      const next: Project = { ...current, updatedAt: this.now() };
      if (input.name !== undefined || input.coverColor !== undefined || input.deskPosition !== undefined) {
        const fields = normalizeProjectFields({
          name: input.name ?? current.name,
          coverColor: input.coverColor ?? current.coverColor,
          deskPosition: input.deskPosition ?? current.deskPosition,
        });
        if (!fields.ok) return fields;
        next.name = fields.value.name;
        next.coverColor = fields.value.coverColor;
        next.deskPosition = fields.value.deskPosition;
      }
      if (input.deskPlacedByUser !== undefined) {
        if (typeof input.deskPlacedByUser !== "boolean") return fail("invalid", "책상 배치 구분이 올바르지 않습니다.");
        next.deskPlacedByUser = input.deskPlacedByUser;
      }
      if (input.coverAssetId !== undefined) {
        if (input.coverAssetId !== null && !isUuid(input.coverAssetId)) return fail("invalid", "표지 자료 ID가 올바르지 않습니다.");
        if (input.coverAssetId) {
          const asset = await request<Asset | undefined>(tx.objectStore(stores.assets).get(input.coverAssetId));
          if (!asset || asset.projectId !== current.id) return fail("invalid", "표지는 이 프로젝트의 이미지여야 합니다.");
        }
        next.coverAssetId = input.coverAssetId;
      }
      await request(projects.put(next));
      return ok(next);
    });
  }

  createConnectedProject(input: CreateConnectedProjectInput): Promise<Result<CreatedProject & { assets: Asset[] }>> {
    const fields = normalizeProjectFields(input);
    if (!fields.ok) return Promise.resolve(fields);
    const rootFields = normalizeRootFields(input.root);
    if (!rootFields.ok) return Promise.resolve(rootFields);
    if (!isScanRecord(input.scan)) return Promise.resolve(fail("invalid", "폴더 수집 결과가 올바르지 않습니다."));
    if (input.files.length > limits.maxFiles) return Promise.resolve(fail("limit", "파일은 1,000개까지 저장할 수 있습니다."));
    const handle = input.root.directoryHandle ?? null;
    const normalizedFiles: ConnectedFileInput[] = [];
    const seenPaths = new Set<string>();
    for (const file of input.files) {
      const asset = normalizeAssetFields({ ...file, projectId: "00000000-0000-4000-8000-000000000000" });
      if (!asset.ok) return Promise.resolve(asset);
      if (seenPaths.has(asset.value.relativePath)) {
        return Promise.resolve(fail("invalid", "같은 경로가 두 번 들어 있습니다."));
      }
      seenPaths.add(asset.value.relativePath);
      normalizedFiles.push({
        relativePath: asset.value.relativePath,
        displayName: asset.value.displayName,
        kind: asset.value.kind,
        size: asset.value.size,
        lastModified: asset.value.lastModified,
        availability: asset.value.availability,
      });
    }

    return withWrite(
      this.db,
      [stores.projects, stores.roots, stores.rootHandles, stores.workspaces, stores.assets],
      "createConnectedProject",
      this.options,
      async (tx) => {
        const count = await request<number>(tx.objectStore(stores.projects).count());
        if (count >= limits.projects) return fail("limit", "프로젝트는 12개까지 만들 수 있습니다.");
        const now = this.now();
        const projectId = createId();
        const rootId = createId();
        const assets: Asset[] = normalizedFiles.map((file) => ({
          id: createId(),
          projectId,
          relativePath: file.relativePath,
          displayName: file.displayName,
          kind: file.kind,
          size: file.size,
          lastModified: file.lastModified,
          availability: file.availability,
        }));
        const cover = input.coverRelativePath
          ? assets.find((asset) => asset.relativePath === input.coverRelativePath && asset.kind === "image")
          : undefined;
        const project: Project = {
          id: projectId,
          name: fields.value.name,
          createdAt: now,
          updatedAt: now,
          coverAssetId: cover?.id ?? null,
          coverColor: fields.value.coverColor,
          deskPosition: fields.value.deskPosition,
          deskPlacedByUser: false,
          rootRefId: rootId,
          lastPausedSceneId: null,
        };
        const root: RootRecord = {
          id: rootId,
          projectId,
          sourceMode: rootFields.value.sourceMode,
          rootName: rootFields.value.rootName,
          lastScanAt: now,
          scan: input.scan,
        };
        const workspace = createInitialWorkspace(projectId, now);
        const projects = tx.objectStore(stores.projects);
        const assetStore = tx.objectStore(stores.assets);
        await request(projects.put(project));
        await request(tx.objectStore(stores.roots).put(root));
        if (handle) await request(tx.objectStore(stores.rootHandles).put({ rootId, directoryHandle: handle }));
        await request(tx.objectStore(stores.workspaces).put(workspace));
        for (const asset of assets) await request(assetStore.put(asset));
        return ok({ project, workspace, root, assets });
      },
    );
  }
  async getCare(projectId: string): Promise<CareRecord> {
    const tx = this.db.transaction(stores.settings, "readonly");
    return normalizeCare(await request<unknown>(tx.objectStore(stores.settings).get(careKey(projectId))), projectId);
  }

  async getWorkDayList(projectId: string): Promise<string[]> {
    const tx = this.db.transaction(stores.settings, "readonly");
    const record = await request<ActivityRecord | undefined>(tx.objectStore(stores.settings).get(`activity:${projectId}`));
    return Array.isArray(record?.days) ? record.days.filter((day): day is string => typeof day === "string") : [];
  }

  touchCards(projectId: string, cardIds: string[], at = this.now()): Promise<Result<CareRecord>> {
    return this.changeCare(projectId, (care) => {
      for (const id of cardIds) care.touched[id] = at;
    });
  }

  // 아직 기록이 없는 카드만 처음 본 시각으로 남깁니다. 기존 카드가 한꺼번에 쓰러지지 않게 합니다.
  noticeCards(projectId: string, cardIds: string[], at = this.now()): Promise<Result<CareRecord>> {
    return this.changeCare(projectId, (care) => {
      for (const id of cardIds) care.touched[id] ??= at;
    });
  }

  updateCare(projectId: string, patch: Partial<CareSettings>): Promise<Result<CareRecord>> {
    return this.changeCare(projectId, (care) => {
      if (typeof patch.enabled === "boolean") care.enabled = patch.enabled;
      if (typeof patch.resting === "boolean") care.resting = patch.resting;
      if (patch.tiltAfterDays !== undefined) care.tiltAfterDays = patch.tiltAfterDays;
      if (patch.fallAfterDays !== undefined) care.fallAfterDays = patch.fallAfterDays;
      if (patch.budgetBytes !== undefined) care.budgetBytes = patch.budgetBytes;
      if (patch.budgetNoticeAt !== undefined) care.budgetNoticeAt = patch.budgetNoticeAt;
      if (care.tiltAfterDays > care.fallAfterDays) care.tiltAfterDays = care.fallAfterDays;
    });
  }

  setPinned(projectId: string, cardId: string, pinned: boolean): Promise<Result<CareRecord>> {
    return this.changeCare(projectId, (care) => {
      care.pinned = care.pinned.filter((id) => id !== cardId);
      if (pinned) care.pinned.push(cardId);
    });
  }

  // 상자 기록과 자료 경로를 한 트랜잭션에서 바꿉니다. entry가 null이면 상자 기록을 지웁니다.
  setBoxEntry(projectId: string, assetId: string, entry: BoxEntry | null, relocateTo?: string): Promise<Result<{ care: CareRecord; asset: Asset }>> {
    if (!isUuid(projectId) || !isUuid(assetId)) return Promise.resolve(fail("invalid", "상자 기록 요청이 올바르지 않습니다."));
    if (entry && (!isSafeRelativePath(entry.fromPath) || !isSafeRelativePath(entry.boxPath))) return Promise.resolve(fail("invalid", "상자 경로가 올바르지 않습니다."));
    if (relocateTo !== undefined && !isSafeRelativePath(relocateTo)) return Promise.resolve(fail("invalid", "옮길 경로가 올바르지 않습니다."));
    return withWrite(this.db, [stores.settings, stores.assets], "setBoxEntry", this.options, async (tx) => {
      const assets = tx.objectStore(stores.assets);
      const asset = await request<Asset | undefined>(assets.get(assetId));
      if (!asset || asset.projectId !== projectId) return fail("not-found", "자료를 찾지 못했습니다.");
      let next = asset;
      if (relocateTo !== undefined && relocateTo !== asset.relativePath) {
        const taken = await request<Asset | undefined>(assets.index("projectPath").get([projectId, relocateTo]));
        if (taken && taken.id !== assetId) return fail("conflict", "같은 경로의 자료가 이미 있습니다.");
        next = { ...asset, relativePath: relocateTo, displayName: relocateTo.split("/").pop() ?? asset.displayName };
        await request(assets.put(next));
      }
      const settings = tx.objectStore(stores.settings);
      const care = normalizeCare(await request<unknown>(settings.get(careKey(projectId))), projectId);
      if (entry) care.boxed[assetId] = entry;
      else delete care.boxed[assetId];
      await request(settings.put(care));
      return ok({ care, asset: next });
    });
  }

  // 주간 정리 직전 상태를 남깁니다. 현재 작업은 바꾸지 않습니다.
  captureSafetyScene(projectId: string, title: string): Promise<Result<Scene>> {
    if (!isUuid(projectId)) return Promise.resolve(fail("invalid", "프로젝트 ID가 올바르지 않습니다."));
    return withWrite(this.db, [stores.workspaces, stores.scenes, stores.assets], "captureSafetyScene", this.options, async (tx) => {
      const current = await request<Workspace | undefined>(tx.objectStore(stores.workspaces).get(projectId));
      if (!current) return fail("not-found", "작업면을 찾지 못했습니다.");
      const scenes = tx.objectStore(stores.scenes);
      const range = IDBKeyRange.bound([projectId, 0], [projectId, Number.MAX_SAFE_INTEGER]);
      if ((await request<number>(scenes.index("projectCreated").count(range))) >= limits.scenes) return fail("limit", "안전 장면을 남길 공간이 없습니다.");
      const assets = await request<Asset[]>(tx.objectStore(stores.assets).index("projectId").getAll(projectId));
      const now = this.now();
      const scene = normalizeScene({
        id: createId(), projectId, title: title.slice(0, limits.sceneTitle), type: "safety", createdAt: now, sourceRevision: current.revision,
        snapshot: structuredClone(current),
        assetManifest: assets.map((asset) => ({ assetId: asset.id, relativePath: asset.relativePath, displayName: asset.displayName, size: asset.size, lastModified: asset.lastModified })),
      });
      if (!scene.ok) return scene;
      await request(scenes.put(scene.value));
      return ok(scene.value);
    });
  }

  async getLastSweepAt(): Promise<number | null> {
    const tx = this.db.transaction(stores.settings, "readonly");
    const record = await request<SweepRecord | undefined>(tx.objectStore(stores.settings).get("care:sweep"));
    return typeof record?.lastSweepAt === "number" ? record.lastSweepAt : null;
  }

  setLastSweepAt(at = this.now()): Promise<Result<number>> {
    return withWrite(this.db, [stores.settings], "setSweep", this.options, async (tx) => {
      await request(tx.objectStore(stores.settings).put({ key: "care:sweep", lastSweepAt: at } satisfies SweepRecord));
      return ok(at);
    });
  }

  private changeCare(projectId: string, change: (care: CareRecord) => void): Promise<Result<CareRecord>> {
    if (!isUuid(projectId)) return Promise.resolve(fail("invalid", "프로젝트 ID가 올바르지 않습니다."));
    return withWrite(this.db, [stores.settings], "updateCare", this.options, async (tx) => {
      const settings = tx.objectStore(stores.settings);
      const care = normalizeCare(await request<unknown>(settings.get(careKey(projectId))), projectId);
      change(care);
      const checked = normalizeCare(care, projectId);
      await request(settings.put(checked));
      return ok(checked);
    });
  }
}

function isScanRecord(value: CreateConnectedProjectInput["scan"]): boolean {
  if (!value || typeof value !== "object") return false;
  const reason = value.stoppedReason;
  return (
    typeof value.complete === "boolean" &&
    Number.isInteger(value.collected) &&
    value.collected >= 0 &&
    Number.isInteger(value.failed) &&
    value.failed >= 0 &&
    (reason === null || reason === "file-limit" || reason === "depth-limit" || reason === "cancelled")
  );
}
