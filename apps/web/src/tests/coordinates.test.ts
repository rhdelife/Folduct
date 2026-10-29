import { describe, expect, it } from "vitest";
import { absoluteOrigin, logicalToScreen, releaseZone, screenToLogical, toZoneRelative, translateZone } from "../domain/coordinates";
import { createId } from "../domain/ids";
import { createInitialWorkspace } from "../domain/workspaceFactory";
import { normalizeWorkspace } from "../domain/validation";
import type { Card, Zone } from "../domain/models";

function card(partial: Partial<Card> & Pick<Card, "x" | "y" | "zoneId">): Card {
  return {
    id: createId(),
    assetId: null,
    title: "",
    note: "",
    width: 240,
    height: 180,
    zIndex: 1,
    ...partial,
  };
}

describe("좌표 변환", () => {
  it("영역 안 카드의 절대 좌표는 영역 원점에 상대 좌표를 더한다", () => {
    const zone: Zone = { id: createId(), title: "진행 중", x: 100, y: 40, width: 720, height: 400 };
    const placed = card({ zoneId: zone.id, x: 16, y: 24 });
    expect(absoluteOrigin(placed, [zone])).toEqual({ x: 116, y: 64 });
    expect(toZoneRelative({ x: 116, y: 64 }, zone)).toEqual({ x: 16, y: 24 });
  });

  it("영역을 옮겨도 카드의 상대 좌표는 유지되고 절대 위치만 따라간다", () => {
    const zone: Zone = { id: createId(), title: "참고 자료", x: 48, y: 48, width: 720, height: 400 };
    const placed = card({ zoneId: zone.id, x: 12, y: 8 });
    const moved = translateZone(zone, 30, 15);
    expect(placed.x).toBe(12);
    expect(placed.y).toBe(8);
    expect(absoluteOrigin(placed, [moved])).toEqual({ x: 90, y: 71 });
  });

  it("영역을 지우면 카드는 작업면 절대 좌표로 남는다", () => {
    const zone: Zone = { id: createId(), title: "검토 후보", x: 200, y: 80, width: 720, height: 400 };
    const inside = card({ zoneId: zone.id, x: 20, y: 10 });
    const outside = card({ zoneId: null, x: 30, y: 40 });
    const released = releaseZone([inside, outside], [zone], zone.id);
    expect(released.zones).toEqual([]);
    expect(released.cards[0]).toMatchObject({ zoneId: null, x: 220, y: 90 });
    expect(released.cards[1]).toMatchObject({ zoneId: null, x: 30, y: 40 });
    expect(inside.zoneId).toBe(zone.id);
  });

  it("화면 좌표 변환은 창 크기를 받지 않는다", () => {
    const viewport = { x: 10, y: 20, scale: 2 };
    const logical = screenToLogical({ x: 100, y: 50 }, viewport);
    expect(logical).toEqual({ x: 60, y: 45 });
    expect(logicalToScreen(logical, viewport)).toEqual({ x: 100, y: 50 });
    expect(screenToLogical({ x: 100, y: 50 }, viewport)).toEqual(logical);
  });

  it("처음 작업면의 기본 영역은 저장 규칙을 통과한다", () => {
    const projectId = createId();
    const workspace = createInitialWorkspace(projectId, 10);
    const normalized = normalizeWorkspace(workspace, projectId);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.zones.map((zone) => zone.title)).toEqual(["참고 자료", "진행 중", "검토 후보"]);
    expect(normalized.value.revision).toBe(1);
  });
});
