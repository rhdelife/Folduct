import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset, Workspace } from "../domain/models";
import { remoteStore, shareProject } from "../services/api";

const asset = { id: "a1", projectId: "p1", relativePath: "x/y.png", displayName: "y.png", kind: "image", size: 3, lastModified: 1, availability: "available", file: new Blob(["abc"]) } as Asset;
const workspace = { projectId: "p1", revision: 2, zones: [], cards: [], nextAction: "", viewport: { x: 0, y: 0, scale: 1 }, selectedCardId: null, mediaPositions: [], updatedAt: 0 } as Workspace;

function respond(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("공유 API", () => {
  it("공유하기는 파일 내용 없이 메타데이터만 보낸다", async () => {
    const fetch = respond(201, { data: { project: { id: "s1" } } });
    expect(await shareProject({ name: "n", coverColor: "#fff" }, workspace, [asset])).toBe("s1");
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.workspace.assets[0]).toEqual({ id: "a1", projectId: "p1", relativePath: "x/y.png", displayName: "y.png", kind: "image", size: 3, lastModified: 1, availability: "permissionRequired" });
  });

  it("다른 사람이 먼저 저장하면(409) conflict로 알려 준다", async () => {
    respond(409, { error: { message: "다른 사람이 먼저 저장했습니다.", currentRevision: 3 } });
    const result = await remoteStore([]).saveWorkspace("s1", 2, workspace);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflict");
      expect(result.error.message).toContain("최신 작업면 불러오기");
    }
  });

  it("저장하면 서버 revision을 쓰고 assets는 작업면에서 뺀다", async () => {
    respond(200, { data: { id: "s1", revision: 3, content: { ...workspace, assets: [asset] }, updatedAt: "2026-01-01T00:00:00Z" } });
    const result = await remoteStore([asset]).saveWorkspace("s1", 2, workspace);
    expect(result.ok && result.value).toMatchObject({ projectId: "s1", revision: 3 });
    expect(result.ok && "assets" in result.value).toBe(false);
  });
});
