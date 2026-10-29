import { afterEach, describe, expect, it } from "vitest";
import { limitText } from "../domain/composedText";
import { createId } from "../domain/ids";
import { absoluteOrigin } from "../domain/coordinates";
import { createInitialWorkspace } from "../domain/workspaceFactory";
import {
  deleteZone,
  matchesQuery,
  moveCard,
  placeCard,
  pointerDeltaToLogical,
  setCardText,
} from "../domain/workspaceEdit";
import type { Workspace } from "../domain/models";
import { fail, ok } from "../domain/result";
import { openStorage, type FolductStorage } from "../services/storage";
import { createSaveQueue } from "../services/saveQueue";

const opened: FolductStorage[] = [];

afterEach(() => {
  for (const storage of opened.splice(0)) storage.close();
});

describe("작업면 편집", () => {
  it("같은 자료의 두 카드는 서로 다른 메모를 유지한 채 다시 읽힌다", async () => {
    const name = `folduct-test-${createId()}`;
    const openedStorage = await openStorage(name);
    if (!openedStorage.ok) throw new Error(openedStorage.error.message);
    opened.push(openedStorage.value);
    const created = await openedStorage.value.createProject({
      name: "작업",
      coverColor: "#1f5a44",
      deskPosition: { x: 10, y: 10 },
    });
    if (!created.ok) throw new Error(created.error.message);
    const asset = await openedStorage.value.rememberAsset({
      projectId: created.value.project.id,
      relativePath: "자료/메모.txt",
      displayName: "메모.txt",
      kind: "text",
      size: 12,
      lastModified: 4,
      availability: "available",
    });
    if (!asset.ok) throw new Error(asset.error.message);
    const first = placeCard(created.value.workspace, { assetId: asset.value.id, title: "첫 카드", at: { x: 80, y: 80 } });
    if (!first.ok) throw new Error(first.message);
    const second = placeCard(first.workspace, { assetId: asset.value.id, title: "둘째 카드", at: { x: 860, y: 80 } });
    if (!second.ok) throw new Error(second.message);
    const noted = setCardText(second.workspace, second.workspace.cards[0].id, { note: "도입부를 줄이기" });
    if (!noted.ok) throw new Error(noted.message);
    const saved = await openedStorage.value.saveWorkspace(created.value.project.id, 1, noted.workspace);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    openedStorage.value.close();
    const again = await openStorage(name);
    if (!again.ok) throw new Error(again.error.message);
    opened.push(again.value);
    const workspace = await again.value.getWorkspace(created.value.project.id);
    expect(workspace?.cards).toHaveLength(2);
    expect(workspace?.cards.map((card) => card.assetId)).toEqual([asset.value.id, asset.value.id]);
    expect(new Set(workspace?.cards.map((card) => card.id)).size).toBe(2);
    expect(workspace?.cards.map((card) => card.note).sort()).toEqual(["", "도입부를 줄이기"]);
  });

  it("영역을 지워도 카드의 절대 위치는 유지된다", () => {
    const workspace = createInitialWorkspace(createId(), 1);
    const zone = workspace.zones[0];
    const placed = placeCard(workspace, { assetId: null, title: "메모", at: { x: zone.x + 30, y: zone.y + 40 } });
    if (!placed.ok) throw new Error(placed.message);
    const card = placed.workspace.cards[0];
    const before = absoluteOrigin(card, placed.workspace.zones);
    const removed = deleteZone(placed.workspace, zone.id);
    if (!removed.ok) throw new Error(removed.message);
    expect(removed.workspace.cards[0]).toMatchObject({ zoneId: null, x: before?.x, y: before?.y });
  });

  it("확대율이 달라도 화면 이동량은 논리 좌표로 나뉜다", () => {
    expect(pointerDeltaToLogical(20, 10, 0.5)).toEqual({ x: 40, y: 20 });
    expect(pointerDeltaToLogical(30, 15, 1.5)).toEqual({ x: 20, y: 10 });
    const workspace = createInitialWorkspace(createId(), 1);
    const placed = placeCard(workspace, { assetId: null, title: "이동", at: { x: 80, y: 90 } });
    if (!placed.ok) throw new Error(placed.message);
    const card = placed.workspace.cards[0];
    const origin = absoluteOrigin(card, placed.workspace.zones);
    const delta = pointerDeltaToLogical(20, 10, 0.5);
    const moved = moveCard(placed.workspace, card.id, { x: (origin?.x ?? 0) + delta.x, y: (origin?.y ?? 0) + delta.y });
    if (!moved.ok) throw new Error(moved.message);
    expect(absoluteOrigin(moved.workspace.cards[0], moved.workspace.zones)).toEqual({
      x: (origin?.x ?? 0) + 40,
      y: (origin?.y ?? 0) + 20,
    });
  });

  it("검색은 경로와 메모의 띄어 쓴 단어를 함께 찾는다", () => {
    expect(matchesQuery("리서치 메모", ["리서치/메모.txt", ""])).toBe(true);
    expect(matchesQuery("도입부", ["메모.txt", "도입부를 줄이기"])).toBe(true);
    expect(matchesQuery("없는말", ["메모.txt", "도입부"])).toBe(false);
  });
});

describe("한글 입력 한계", () => {
  it("조합 중에는 글을 자르지 않고 조합이 끝난 뒤에만 확정한다", () => {
    const composing = limitText("한글입력중", 4, true);
    expect(composing.commit).toBe(false);
    expect(composing.value).toBe("한글입력중");
    const committed = limitText("한글입력중", 4, false);
    expect(committed.commit).toBe(true);
    expect(committed.value).toBe("한글입력");
  });
});

describe("자동 저장 순서", () => {
  it("먼저 시작한 저장이 끝난 뒤의 개정 번호로 다음 내용을 저장하고 실패를 성공으로 두지 않는다", async () => {
    let revision = 1;
    const calls: { expected: number; note: string }[] = [];
    let releaseFirst = () => {};
    const firstSave = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const statuses: string[] = [];
    const queue = createSaveQueue({
      initialRevision: 1,
      onChange: (status) => statuses.push(status),
      save: async (expected, workspace) => {
        calls.push({ expected, note: workspace.nextAction });
        if (calls.length === 1) await firstSave;
        if (expected !== revision) return fail("conflict", "다른 저장이 먼저 반영되었습니다.");
        revision += 1;
        return ok({ ...workspace, revision });
      },
    });
    const first = queue.enqueue(workspaceWith("하나"));
    const second = queue.enqueue(workspaceWith("둘"));
    releaseFirst();
    await Promise.all([first, second]);
    expect(calls.map((call) => call.expected)).toEqual([1, 2]);
    expect(calls.at(-1)?.note).toBe("둘");
    expect(statuses.at(-1)).toBe("saved");

    const failing = createSaveQueue({
      initialRevision: 2,
      save: async () => fail("aborted", "저장하지 못했습니다."),
    });
    await failing.enqueue(workspaceWith("실패"));
    expect(failing.status()).toBe("error");
  });
});

function workspaceWith(nextAction: string): Workspace {
  return { ...createInitialWorkspace(createId(), 1), nextAction };
}
