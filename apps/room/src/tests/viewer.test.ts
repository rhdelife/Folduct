/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { safeTabBlob } from "../components/FileViewer";

describe("새 탭으로 열기", () => {
  it("실제 파일 확장자의 허용 목록으로만 열고, 원본 File은 넘기지 않는다", () => {
    expect(safeTabBlob(new File(["<script>"], "index.html", { type: "text/html" }), "image")).toBeNull();
    const svg = safeTabBlob(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), "image");
    expect(svg === null || svg.type.startsWith("text/plain")).toBe(true);
    const video = new File(["v"], "a.mp4", { type: "text/html" });
    const blob = safeTabBlob(video, "video");
    expect(blob).not.toBe(video);
    expect(blob?.type).toBe("video/mp4");
    expect(safeTabBlob(new File(["p"], "a.pdf"), "pdf")?.type).toBe("application/pdf");
    expect(safeTabBlob(new File(["<b>"], "page.html", { type: "text/html" }), "text")?.type).toMatch(/^text\/plain/);
  });
});
