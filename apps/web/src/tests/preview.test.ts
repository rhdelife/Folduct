import { describe, expect, it } from "vitest";
import { createId } from "../domain/ids";
import {
  clampPlaybackSeconds,
  createPreviewTicket,
  planPreview,
  previewLimits,
  readUtf8Text,
} from "../domain/preview";
import { createInitialWorkspace } from "../domain/workspaceFactory";
import { setMediaPosition } from "../domain/workspaceEdit";
import { readProjectFile } from "../gateways/readProjectFile";
import { rememberSessionFiles } from "../gateways/sessionFiles";

describe("미리보기 계획", () => {
  it("PNG, JPEG, WebP는 이미지로 열고 SVG와 HTML과 Markdown은 텍스트로 연다", () => {
    expect(planPreview({ displayName: "a.png", kind: "image", size: 10 })).toMatchObject({ status: "show", mode: "image" });
    expect(planPreview({ displayName: "a.jpeg", kind: "image", size: 10 })).toMatchObject({ mode: "image" });
    expect(planPreview({ displayName: "a.webp", kind: "image", size: 10 })).toMatchObject({ mode: "image" });
    expect(planPreview({ displayName: "a.svg", kind: "image", size: 10 })).toMatchObject({ mode: "text" });
    expect(planPreview({ displayName: "a.html", kind: "text", size: 40 })).toMatchObject({ mode: "text" });
    expect(planPreview({ displayName: "a.md", kind: "text", size: 40 })).toMatchObject({ mode: "text" });
    expect(planPreview({ displayName: "표.csv", kind: "table", size: 40 })).toMatchObject({ mode: "text" });
  });

  it("오피스, 한글, 디자인, 표 계산 파일은 내용 대신 메타데이터로 구분한다", () => {
    expect(planPreview({ displayName: "제안.hwp", kind: "office", size: 20 })).toMatchObject({ block: "office" });
    expect(planPreview({ displayName: "시안.psd", kind: "design", size: 20 })).toMatchObject({ block: "design" });
    expect(planPreview({ displayName: "표.xlsx", kind: "table", size: 20 })).toMatchObject({ block: "spreadsheet" });
    expect(planPreview({ displayName: "묶음.zip", kind: "archive", size: 20 })).toMatchObject({ block: "archive" });
  });

  it("크기 한도를 넘으면 형식별로 미리보기를 막는다", () => {
    expect(planPreview({ displayName: "큰.png", kind: "image", size: previewLimits.imageBytes + 1 })).toMatchObject({ block: "image-size" });
    expect(planPreview({ displayName: "큰.txt", kind: "text", size: previewLimits.textBytes + 1 })).toMatchObject({ block: "text-size" });
    expect(planPreview({ displayName: "큰.mp4", kind: "video", size: previewLimits.mediaBytes + 1 })).toMatchObject({ block: "media-size" });
    expect(planPreview({ displayName: "큰.html", kind: "text", size: previewLimits.textBytes + 1 })).toMatchObject({ block: "text-size" });
  });

  it("악성 HTML 바이트는 실행 문자열이 아니라 UTF-8 텍스트로 남는다", () => {
    const source = "<script>alert(1)</script><svg onload=\"alert(1)\"></svg>";
    const decoded = readUtf8Text(new TextEncoder().encode(source));
    expect(decoded).toEqual({ ok: true, text: source });
    expect(readUtf8Text(new Uint8Array([0xff, 0xfe, 0xfd]))).toEqual({ ok: false, reason: "corrupt" });
  });

  it("짧아진 재생 길이를 넘긴 위치는 길이 안으로 보정한다", () => {
    expect(clampPlaybackSeconds(12.2, 30)).toBe(12.2);
    expect(clampPlaybackSeconds(100, 12.4)).toBe(12.4);
    expect(clampPlaybackSeconds(4, Number.NaN)).toBeNull();
    expect(clampPlaybackSeconds(-1, 10)).toBeNull();
  });

  it("이전 미리보기 요청은 다음 요청이 시작된 뒤 현재 요청이 아니다", () => {
    const ticket = createPreviewTicket();
    const first = ticket.next();
    const second = ticket.next();
    expect(ticket.isCurrent(first)).toBe(false);
    expect(ticket.isCurrent(second)).toBe(true);
  });

  it("같은 자료의 재생 위치는 하나만 저장한다", () => {
    const assetId = createId();
    const workspace = createInitialWorkspace(createId(), 1);
    const first = setMediaPosition(workspace, assetId, 12.5);
    if (!first.ok) throw new Error(first.message);
    const second = setMediaPosition(first.workspace, assetId, 3);
    if (!second.ok) throw new Error(second.message);
    expect(second.workspace.mediaPositions).toEqual([{ assetId, seconds: 3 }]);
    expect(setMediaPosition(second.workspace, assetId, Number.NaN).ok).toBe(false);
  });
});

describe("연결된 파일 읽기", () => {
  it("세션에 없는 경로는 폴더 핸들에서 읽고 상위 경로는 거절한다", async () => {
    const projectId = createId();
    const nested = new File(["본문"], "메모.txt", { type: "text/plain" });
    const handle = directory({
      리서치: directory({
        "메모.txt": nested,
      }),
    });
    const read = await readProjectFile(projectId, "리서치/메모.txt", handle);
    expect(read.ok && read.file).toBe(nested);
    expect(await readProjectFile(projectId, "../비밀.txt", handle)).toEqual({ ok: false, reason: "read-failed" });
    expect(await readProjectFile(projectId, "없는.txt", null)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("세션 파일이 있으면 핸들보다 먼저 사용한다", async () => {
    const projectId = createId();
    const session = new File(["세션"], "메모.txt", { type: "text/plain" });
    rememberSessionFiles(projectId, [{ relativePath: "메모.txt", file: session }]);
    const read = await readProjectFile(projectId, "메모.txt", directory({}));
    expect(read.ok && read.file).toBe(session);
  });
});

function directory(entries: Record<string, File | FileSystemDirectoryHandle>): FileSystemDirectoryHandle {
  return {
    async getDirectoryHandle(name: string) {
      const child = entries[name];
      if (!child || child instanceof File) throw new Error("missing");
      return child;
    },
    async getFileHandle(name: string) {
      const child = entries[name];
      if (!(child instanceof File)) throw new Error("missing");
      return { getFile: async () => child };
    },
  } as unknown as FileSystemDirectoryHandle;
}
