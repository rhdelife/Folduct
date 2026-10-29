import { afterEach, describe, expect, it } from "vitest";
import { createId } from "../domain/ids";
import { openStorage, type FolductStorage, type WriteOperation } from "../services/storage";

const opened: FolductStorage[] = [];
afterEach(() => { for (const storage of opened.splice(0)) storage.close(); });

async function setup(options?: { onBeforeCommit?: (operation: WriteOperation) => void }) {
  const result = await openStorage(`scenes-${createId()}`, options);
  if (!result.ok) throw new Error(result.error.message);
  opened.push(result.value);
  const created = await result.value.createProject({ name: "작업", coverColor: "#335544", deskPosition: { x: 0, y: 0 } });
  if (!created.ok) throw new Error(created.error.message);
  return { storage: result.value, project: created.value.project, workspace: created.value.workspace };
}

describe("장면과 작업 재개", () => {
  it("중단 저장은 현재 작업과 장면을 함께 저장하고 같은 요청을 다시 보내도 장면이 하나다", async () => {
    const { storage, project, workspace } = await setup();
    const requestId = createId();
    const input = { projectId: project.id, expectedRevision: 1, workspace: { ...workspace, nextAction: "표지 색 결정" }, title: "오늘 여기까지", type: "pause" as const, requestId };
    const first = await storage.captureScene(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = await storage.captureScene(input);
    expect(again.ok).toBe(true);
    expect(await storage.listScenes(project.id)).toHaveLength(1);
    expect((await storage.getProject(project.id))?.lastPausedSceneId).toBe(requestId);
    expect((await storage.getWorkspace(project.id))?.nextAction).toBe("표지 색 결정");
    expect(first.value.scene.snapshot).toEqual(first.value.workspace);
    expect(first.value.scene.id).toBe(requestId);
  });

  it("이전 장면으로 전환하면 현재 작업이 안전 장면에 남고 원본 장면은 불변이다", async () => {
    const { storage, project, workspace } = await setup();
    const first = await storage.captureScene({ projectId: project.id, expectedRevision: 1, workspace: { ...workspace, nextAction: "첫 선택" }, title: "처음", type: "pause", requestId: createId() });
    if (!first.ok) throw new Error(first.error.message);
    const changed = await storage.saveWorkspace(project.id, first.value.workspace.revision, { ...first.value.workspace, nextAction: "두 번째 선택" });
    if (!changed.ok) throw new Error(changed.error.message);
    const resumed = await storage.continueFromScene(project.id, first.value.scene.id, changed.value.revision);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.workspace.nextAction).toBe("첫 선택");
    expect(resumed.value.safety.snapshot.nextAction).toBe("두 번째 선택");
    expect((await storage.getScene(first.value.scene.id))?.snapshot.nextAction).toBe("첫 선택");
    const back = await storage.continueFromScene(project.id, resumed.value.safety.id, resumed.value.workspace.revision);
    expect(back.ok && back.value.workspace.nextAction).toBe("두 번째 선택");
  });

  it("저장 직전 오류와 개정 충돌은 장면과 작업면을 함께 보존한다", async () => {
    let rejectCapture = false;
    const { storage, project, workspace } = await setup({ onBeforeCommit: (operation) => { if (rejectCapture && operation === "captureScene") throw new Error("강제 실패"); } });
    rejectCapture = true;
    const failed = await storage.captureScene({ projectId: project.id, expectedRevision: 1, workspace: { ...workspace, nextAction: "저장되지 않아야 함" }, title: "실패", type: "pause", requestId: createId() });
    expect(failed.ok).toBe(false);
    expect(await storage.listScenes(project.id)).toHaveLength(0);
    expect((await storage.getWorkspace(project.id))?.nextAction).toBe("");
    expect((await storage.getProject(project.id))?.lastPausedSceneId).toBe(null);
    rejectCapture = false;
    const successful = await storage.captureScene({ projectId: project.id, expectedRevision: 1, workspace, title: "성공", type: "manual", requestId: createId() });
    expect(successful.ok).toBe(true);
    const conflict = await storage.continueFromScene(project.id, successful.ok ? successful.value.scene.id : createId(), 1);
    expect(conflict.ok).toBe(false);
    expect(await storage.listScenes(project.id)).toHaveLength(1);
  });

  it("작업한 날짜만 세고 보기 위치 변경이나 단순 열람은 세지 않는다", async () => {
    const { storage, project, workspace } = await setup();
    expect(await storage.getRecentWorkDays(project.id)).toBe(null);
    await storage.getWorkspace(project.id);
    expect(await storage.getRecentWorkDays(project.id)).toBe(null);
    const viewed = await storage.saveWorkspace(project.id, 1, { ...workspace, viewport: { ...workspace.viewport, x: 40 } });
    expect(viewed.ok).toBe(true);
    expect(await storage.getRecentWorkDays(project.id)).toBe(null);
    if (!viewed.ok) return;
    const edited = await storage.saveWorkspace(project.id, viewed.value.revision, { ...viewed.value, nextAction: "첫 작업" });
    expect(edited.ok).toBe(true);
    expect(await storage.getRecentWorkDays(project.id)).toBe(1);
  });

  it("안전 장면 쓰기 실패에서는 현재 작업 전환과 장면 추가가 모두 취소된다", async () => {
    let rejectContinue = false;
    const { storage, project, workspace } = await setup({ onBeforeCommit: (operation) => { if (rejectContinue && operation === "continueFromScene") throw new Error("강제 실패"); } });
    const saved = await storage.captureScene({ projectId: project.id, expectedRevision: 1, workspace: { ...workspace, nextAction: "과거" }, title: "과거", type: "pause", requestId: createId() });
    if (!saved.ok) throw new Error(saved.error.message);
    const edited = await storage.saveWorkspace(project.id, saved.value.workspace.revision, { ...saved.value.workspace, nextAction: "현재" });
    if (!edited.ok) throw new Error(edited.error.message);
    rejectContinue = true;
    const failed = await storage.continueFromScene(project.id, saved.value.scene.id, edited.value.revision);
    expect(failed.ok).toBe(false);
    expect(await storage.listScenes(project.id)).toHaveLength(1);
    expect((await storage.getWorkspace(project.id))?.nextAction).toBe("현재");
  });
});
