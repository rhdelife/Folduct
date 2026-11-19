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

describe("웹에서 끌어 온 주소 내려받기", () => {
  beforeEach(() => invoke.mockReset());
  it("주소 끝 이름을 쓰고, 못 쓰는 이름이면 기본 이름이에요", async () => {
    const { downloadName } = await import("../gateways/mover");
    expect(downloadName("https://example.com/img/%EC%8B%9C%EC%95%88.png?x=1")).toBe("시안.png");
    expect(downloadName("https://example.com/")).toBe("내려받은 파일");
    expect(downloadName("https://example.com/..%2F..%2Fetc")).toBe("etc");
    expect(downloadName("https://example.com/.zshrc")).toBe("zshrc");
    expect(downloadName("not a url")).toBe("내려받은 파일");
  });

  it("http·https 주소와 맨 위 이름만 Tauri에 넘기고, 같은 이름은 덮어쓰지 않아요", async () => {
    const { saveDownload } = await import("../gateways/mover");
    invoke.mockResolvedValueOnce(undefined);
    expect(await saveDownload("/Users/me/방", "a.png", "https://example.com/a.png")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("save_download", { room: "/Users/me/방", name: "a.png", url: "https://example.com/a.png" });
    for (const [name, url] of [["a.png", "file:///etc/hosts"], ["../a.png", "https://x.com/a"], ["sub/a.png", "https://x.com/a"], [".env", "https://x.com/a"]]) {
      expect((await saveDownload("/Users/me/방", name, url)).ok).toBe(false);
    }
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockRejectedValueOnce("File exists (os error 17)");
    expect(await saveDownload("/Users/me/방", "a.png", "https://example.com/a.png")).toMatchObject({ ok: false, reason: "occupied" });
  });
});

describe("퀵 메모 저장", () => {
  beforeEach(() => invoke.mockReset());
  it("이름에 .txt를 붙이고 못 쓰는 글자는 빼요", async () => {
    const { memoName } = await import("../gateways/mover");
    expect(memoName("2026-11-19 졸업 memo")).toBe("2026-11-19 졸업 memo.txt");
    expect(memoName("회의.txt")).toBe("회의.txt");
    expect(memoName("a/b:c")).toBe("a b c.txt");
    expect(memoName("..hidden")).toBe("hidden.txt");
    expect(memoName("  ")).toBe("memo.txt");
  });

  it(".txt 맨 위 이름만 Tauri에 넘기고, 같은 이름은 덮어쓰지 않아요", async () => {
    const { saveMemo } = await import("../gateways/mover");
    invoke.mockResolvedValueOnce(undefined);
    expect(await saveMemo("/Users/me/방", "메모.txt", "할 일")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("save_memo", { room: "/Users/me/방", name: "메모.txt", text: "할 일" });
    for (const name of ["메모.sh", "../메모.txt", "sub/메모.txt", ".txt"]) expect((await saveMemo("/Users/me/방", name, "x")).ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockRejectedValueOnce("File exists (os error 17)");
    expect(await saveMemo("/Users/me/방", "메모.txt", "x")).toMatchObject({ ok: false, reason: "occupied" });
  });
});
