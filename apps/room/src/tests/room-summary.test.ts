import { describe, expect, it } from "vitest";
import type { Room, Thing } from "../domain/model";
import { roomSummary } from "../domain/roomSummary";
import type { RoomStat } from "../domain/sky";

const thing = (id: string, kind: Thing["kind"], size: number, extra: Partial<Thing> = {}): Thing => ({ id, path: `${id}`, name: id, kind, size, lastModified: 0, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...extra });
const room = (things: Thing[]) => ({ name: "Codex", things } as unknown as Room);
const stat = (stale: number, recent: number): RoomStat => ({ usage: { totalBytes: 3 * 1024 ** 2, boxBytes: 0, exact: true }, stale, progress: { lastActivityAt: null, recentCount: recent } });

describe("방 요약 말풍선", () => {
  it("파일 수·용량·가장 큰 형식·안 쓴 파일·그해 일한 시간을 반말로 말해요", () => {
    const lines = roomSummary(room([thing("a", "video", 2 * 1024 ** 2), thing("b", "image", 1024 ** 2), thing("c", "pdf", 10, { box: { state: "boxed", fromPath: "c", boxPath: "_b/c", at: 0 } })]), stat(4, 2), 90 * 60_000, 2026);
    expect(lines[0]).toBe("Codex 방에는 파일 2개, 3.0MB가 있어. 제일 큰 건 영상이야.");
    expect(lines[1]).toBe("이번 주에 2개를 썼고, 안 쓴 파일 4개는 정리해도 돼.");
    expect(lines[2]).toBe("2026년에 이 방에서 1시간 30분 일했어.");
  });
  it("받침 없는 형식은 '야', 일한 기록이 없으면 시간 문장은 빼요", () => {
    const lines = roomSummary(room([thing("a", "image", 10)]), stat(0, 0), 0, 2026);
    expect(lines).toEqual(["Codex 방에는 파일 1개, 3.0MB가 있어. 제일 큰 건 이미지야.", "안 쓴 파일은 없어."]);
  });
  it("빈 방은 비어 있다고만 해요", () => {
    expect(roomSummary(room([]), stat(0, 0), 0, 2026)).toEqual(["Codex 방은 아직 비어 있어."]);
  });
});
