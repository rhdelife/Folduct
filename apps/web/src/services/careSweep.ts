import { sweepCandidates, type BoxEntry, type CareRecord, type SweepCandidate } from "../domain/care";
import type { Asset, Project } from "../domain/models";
import { fail, ok, type Result } from "../domain/result";
import { asMoveDirectory, canMoveFiles, fileExists, freeBoxPath, moveFile } from "../gateways/boxMover";
import { askPermission, readPermission } from "../gateways/fileGateway";
import type { FolductStorage } from "./storage";

export type SweepPlan = {
  project: Project;
  // virtual: 폴더 입력 방식이거나 브라우저가 이동을 못 하면 Folduct 안에서만 상자로 옮깁니다.
  mode: "real" | "virtual";
  handle: FileSystemDirectoryHandle | null;
  candidates: SweepCandidate[];
};

export type SweepOutcome = {
  projectId: string;
  projectName: string;
  mode: "real" | "virtual";
  moved: number;
  movedBytes: number;
  failures: { name: string; message: string }[];
  skipped: string | null;
};

export async function planSweep(storage: FolductStorage, now = Date.now()): Promise<SweepPlan[]> {
  const plans: SweepPlan[] = [];
  for (const project of await storage.listProjects()) {
    const [root, handle, workspace] = await Promise.all([
      project.rootRefId ? storage.getRoot(project.rootRefId) : Promise.resolve(null),
      project.rootRefId ? storage.getDirectoryHandle(project.rootRefId) : Promise.resolve(null),
      storage.getWorkspace(project.id),
    ]);
    if (!workspace) continue;
    if (handle && (await readPermission(handle)) === "granted") await reconcileBox(storage, project.id, handle);
    const [assets, care, workDays] = await Promise.all([storage.listAssets(project.id), storage.getCare(project.id), storage.getWorkDayList(project.id)]);
    const candidates = sweepCandidates(workspace, assets, care, workDays, now);
    if (candidates.length === 0) continue;
    const real = root?.sourceMode === "handle" && handle !== null && canMoveFiles();
    plans.push({ project, mode: real ? "real" : "virtual", handle: real ? handle : null, candidates });
  }
  return plans;
}

// 사용자가 '정리하기'를 누른 클릭 안에서 불러야 합니다. 쓰기 권한 요청에 사용자 동작이 필요합니다.
export async function runSweep(storage: FolductStorage, plans: SweepPlan[], selected: Set<string>, now = Date.now()): Promise<SweepOutcome[]> {
  const picked = plans
    .map((plan) => ({ plan, items: plan.candidates.filter((item) => selected.has(item.asset.id)) }))
    .filter((entry) => entry.items.length > 0);
  // 권한부터 모두 받아 둡니다. 다른 비동기 작업 뒤에는 클릭의 사용자 동작이 만료될 수 있습니다.
  const granted = new Map<string, boolean>();
  for (const { plan } of picked) {
    if (plan.mode !== "real" || !plan.handle) continue;
    const state = (await readPermission(plan.handle, "readwrite")) === "granted" ? "granted" : await askPermission(plan.handle, "readwrite");
    granted.set(plan.project.id, state === "granted");
  }

  const outcomes: SweepOutcome[] = [];
  for (const { plan, items } of picked) {
    const outcome: SweepOutcome = { projectId: plan.project.id, projectName: plan.project.name, mode: plan.mode, moved: 0, movedBytes: 0, failures: [], skipped: null };
    outcomes.push(outcome);
    if (plan.mode === "real" && !granted.get(plan.project.id)) {
      outcome.skipped = "폴더 수정 권한을 받지 못해 아무것도 옮기지 않았어요.";
      continue;
    }
    const safety = await storage.captureSafetyScene(plan.project.id, `주간 정리 전 ${new Date(now).toLocaleDateString("ko-KR")}`);
    if (!safety.ok) {
      outcome.skipped = `정리 전 상태를 남기지 못해 옮기지 않았어요. ${safety.error.message}`;
      continue;
    }
    for (const item of items) {
      const moved = plan.mode === "real" && plan.handle ? await boxOne(storage, plan.project.id, plan.handle, item.asset, now) : await boxVirtual(storage, plan.project.id, item.asset, now);
      if (moved.ok) {
        outcome.moved += 1;
        outcome.movedBytes += item.asset.size;
      } else {
        outcome.failures.push({ name: item.asset.displayName, message: moved.error.message });
      }
    }
  }
  await storage.setLastSweepAt(now);
  return outcomes;
}

async function boxOne(storage: FolductStorage, projectId: string, handle: FileSystemDirectoryHandle, asset: Asset, now: number): Promise<Result<unknown>> {
  const root = asMoveDirectory(handle);
  const boxPath = await freeBoxPath(root, asset.relativePath).catch(() => null);
  if (!boxPath) return fail("invalid", "상자 안에 둘 이름을 정하지 못했어요.");
  const entry: BoxEntry = { state: "moving-in", fromPath: asset.relativePath, boxPath, at: now };
  const journal = await storage.setBoxEntry(projectId, asset.id, entry);
  if (!journal.ok) return journal;
  const moved = await moveFile(root, asset.relativePath, boxPath);
  if (!moved.ok) {
    await storage.setBoxEntry(projectId, asset.id, null);
    return fail("aborted", moved.message);
  }
  // 이 기록이 실패해도 moving-in 기록이 남아 다음 방문 때 reconcileBox가 맞춥니다.
  await storage.setBoxEntry(projectId, asset.id, { ...entry, state: "boxed" }, boxPath);
  return ok(null);
}

function boxVirtual(storage: FolductStorage, projectId: string, asset: Asset, now: number) {
  return storage.setBoxEntry(projectId, asset.id, { state: "virtual", fromPath: asset.relativePath, boxPath: asset.relativePath, at: now });
}

// 이동 도중 앱이 꺼졌다면 파일이 실제로 있는 쪽에 기록을 맞춥니다.
export async function reconcileBox(storage: FolductStorage, projectId: string, handle: FileSystemDirectoryHandle): Promise<CareRecord> {
  const root = asMoveDirectory(handle);
  const care = await storage.getCare(projectId);
  for (const [assetId, entry] of Object.entries(care.boxed)) {
    if (entry.state !== "moving-in" && entry.state !== "moving-out") continue;
    try {
      const inBox = await fileExists(root, entry.boxPath);
      const atHome = await fileExists(root, entry.fromPath);
      if (entry.state === "moving-in") {
        await storage.setBoxEntry(projectId, assetId, inBox ? { ...entry, state: "boxed" } : null, inBox ? entry.boxPath : undefined);
      } else if (atHome) {
        await storage.setBoxEntry(projectId, assetId, null, entry.fromPath);
      } else {
        await storage.setBoxEntry(projectId, assetId, inBox ? { ...entry, state: "boxed" } : null);
      }
    } catch {
      // 권한이 없으면 다음 방문 때 다시 맞춥니다.
    }
  }
  return storage.getCare(projectId);
}

// '제자리로': 상자 폴더의 파일을 원래 경로로 되돌립니다. 버튼 클릭 안에서 불러야 합니다.
export async function restoreFromBox(
  storage: FolductStorage,
  projectId: string,
  handle: FileSystemDirectoryHandle | null,
  assetId: string,
): Promise<Result<{ care: CareRecord; asset: Asset }>> {
  const care = await storage.getCare(projectId);
  const entry = care.boxed[assetId];
  if (!entry) return fail("not-found", "상자에 없는 자료예요.");
  if (entry.state === "virtual") return storage.setBoxEntry(projectId, assetId, null);
  if (!handle) return fail("invalid", "폴더 접근이 있어야 파일을 제자리로 옮길 수 있어요.");
  const state = (await readPermission(handle, "readwrite")) === "granted" ? "granted" : await askPermission(handle, "readwrite");
  if (state !== "granted") return fail("invalid", "폴더 수정 권한을 받지 못해 옮기지 않았어요.");
  const root = asMoveDirectory(handle);
  if (await fileExists(root, entry.fromPath)) return fail("conflict", "원래 자리에 같은 이름의 파일이 있어요. Finder에서 확인해 주세요.");
  const journal = await storage.setBoxEntry(projectId, assetId, { ...entry, state: "moving-out" });
  if (!journal.ok) return journal;
  const moved = await moveFile(root, entry.boxPath, entry.fromPath);
  if (!moved.ok) {
    await storage.setBoxEntry(projectId, assetId, { ...entry, state: "boxed" });
    return fail("aborted", moved.message);
  }
  return storage.setBoxEntry(projectId, assetId, null, entry.fromPath);
}
