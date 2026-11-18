import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const { isNotFound, restoreTrashed, trashFile } = await import("../gateways/mover");

describe("휴지통으로 보내기", () => {
  beforeEach(() => invoke.mockReset());
  it("방 폴더 안 파일 하나만 Tauri에 넘겨요", async () => {
    await trashFile("/Users/me/방", "참고/시안.psd");
    expect(invoke).toHaveBeenCalledWith("trash_file", { path: "/Users/me/방/참고/시안.psd" });
  });
  it("방 밖·숨김·시스템 파일 이름은 보내기 전에 막아요", async () => {
    for (const path of ["../밖.txt", "/etc/hosts", ".env", "참고/.DS_Store", "Thumbs.db", ""]) {
      await expect(trashFile("/Users/me/방", path)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it("되돌리기는 받은 휴지통 자리에서 방 안 원래 자리로만 옮겨요", async () => {
    await restoreTrashed("/Users/me/방", "참고/시안.psd", "/Users/me/.Trash/시안.psd");
    expect(invoke).toHaveBeenCalledWith("restore_trashed", { from: "/Users/me/.Trash/시안.psd", to: "/Users/me/방/참고/시안.psd" });
    await expect(restoreTrashed("/Users/me/방", "../밖.psd", "/Users/me/.Trash/시안.psd")).rejects.toThrow();
  });
  it("이미 없는 파일(os error 2)은 '없음'으로 알아봐 기록에서만 뺄 수 있어요. 권한 오류는 아니에요", async () => {
    invoke.mockRejectedValueOnce("No such file or directory (os error 2)");
    const error = await trashFile("/Users/me/방", "~ai-1_.tmp").catch((failure: unknown) => failure);
    expect(isNotFound(error)).toBe(true);
    expect(isNotFound("Operation not permitted (os error 1)")).toBe(false);
  });
});
