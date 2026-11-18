import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const { copyBetween } = await import("../gateways/mover");

describe("다른 방으로 복제", () => {
  beforeEach(() => invoke.mockReset());
  it("원래 방 안 파일을 받을 방 폴더 맨 위로만 넘겨요", async () => {
    invoke.mockResolvedValueOnce(undefined);
    expect(await copyBetween("/Users/me/방1", "참고/시안.psd", "/Users/me/방2", "시안 (2).psd")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("copy_file", { from: "/Users/me/방1/참고/시안.psd", to: "/Users/me/방2/시안 (2).psd" });
  });
  it("방 밖·하위 경로·숨김·정리 상자 안 파일은 넘기기 전에 막아요", async () => {
    for (const [from, to] of [["../밖.txt", "밖.txt"], ["시안.psd", "하위/시안.psd"], ["시안.psd", ".env"], ["_Folduct 정리상자/시안.psd", "시안.psd"]]) {
      expect((await copyBetween("/Users/me/방1", from, "/Users/me/방2", to)).ok).toBe(false);
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it("같은 이름이 있다는 OS 거절은 덮어쓰지 않고 '자리에 있음'으로 알려요", async () => {
    invoke.mockRejectedValueOnce("File exists (os error 17)");
    expect(await copyBetween("/Users/me/방1", "시안.psd", "/Users/me/방2", "시안.psd")).toMatchObject({ ok: false, reason: "occupied" });
  });
});
