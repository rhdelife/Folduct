import { describe, expect, it } from "vitest";
import { pileKey, splitLane } from "../domain/pile";
import { scanFileList, scanFolder, scanLimits, type DirectorySource } from "../gateways/folder";
import { kindOf, type Thing } from "../domain/model";

const thing = (path: string, size = 1, patch: Partial<Thing> = {}): Thing => {
  const name = path.split("/").pop()!;
  return { id: path, path, name, kind: kindOf(name), size, lastModified: 0, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...patch };
};

// 실제 ChatGPT 프로젝트 폴더(2026-11-09 측정)에서 가져온 경로예요.
describe("자동 생성 파일 더미", () => {
  it("tmp·target·generated 아래 파일은 그 폴더부터 두 단계까지로 묶어요", () => {
    expect(pileKey("tmp/pdfs/rt89/page-001.png")).toBe("tmp/pdfs/rt89");
    expect(pileKey("tmp/pdfs/rt5_rt10/qa/a.png")).toBe("tmp/pdfs/rt5_rt10");
    expect(pileKey("tmp/pdfs/cover.png")).toBe("tmp/pdfs");
    expect(pileKey("memory-desk/apps/desktop/src-tauri/target/debug/deps/libx-ab12.rmeta")).toBe("memory-desk/apps/desktop/src-tauri/target/debug/deps");
    expect(pileKey("assets/generated/last-supper-v3-dramatic.png")).toBe("assets/generated");
    expect(pileKey("Build/out.txt")).toBe("Build");
  });

  it("보관 폴더(_archive·backup·old)는 그 안의 프로젝트 하나가 더미 하나예요", () => {
    expect(pileKey("_archive/memory-desk/apps/desktop/src/App.tsx")).toBe("_archive/memory-desk");
    expect(pileKey("_archive/memory-desk/apps/desktop/src-tauri/target/debug/deps/x.rmeta")).toBe("_archive/memory-desk");
    expect(pileKey("_archive/README.md")).toBe("_archive");
    expect(pileKey("Backup/2025/a.psd")).toBe("Backup/2025");
    expect(pileKey("docs/old/기획_v1.pdf")).toBe("docs/old");
    const { piles } = splitLane([thing("_archive/design-sprint/index.html"), thing("tmp/a.png")]);
    expect(piles.map((pile) => [pile.label, pile.archive]).sort()).toEqual([["_archive/design-sprint", true], ["tmp", false]]);
  });

  it("맨 위 결과물과 output·exports 폴더는 앞줄이에요", () => {
    for (const path of ["RT4_시험대비_강의노트.pdf", "README.md", "output/posters/x.png", "exports/instagram/post-01.png", "tmp.md", "notes/temporary/a.md", "archive.zip", "golden/a.png", "older-notes/a.md"]) expect(pileKey(path), path).toBeNull();
  });

  it("줄을 앞줄과 더미로 나누고, 고정한 파일은 더미 안에 있어도 앞줄에 나와요", () => {
    const things = [thing("tmp/pdfs/rt89/page-002.png", 50), thing("RT4_시험대비_강의노트.pdf", 40), thing("tmp/pdfs/rt89/page-001.png", 30), thing("tmp/pdfs/rt56_qa/shot.png", 90), thing("tmp/pdfs/rt89/page-003.png", 20, { pinned: true }), thing("README.md", 1)];
    const { front, piles } = splitLane(things);
    expect(front.map((item) => item.path)).toEqual(["RT4_시험대비_강의노트.pdf", "tmp/pdfs/rt89/page-003.png", "README.md"]);
    expect(piles.map((pile) => [pile.label, pile.things.length, pile.size])).toEqual([["tmp/pdfs/rt56_qa", 1, 90], ["tmp/pdfs/rt89", 2, 80]]);
    expect(piles[1].things.map((item) => item.path)).toEqual(["tmp/pdfs/rt89/page-002.png", "tmp/pdfs/rt89/page-001.png"]);
  });

  it("이름표는 자동 생성 폴더 바로 위 폴더부터 보여 줘요", () => {
    const { piles } = splitLane([thing("memory-desk/apps/desktop/src-tauri/target/debug/deps/a.rmeta"), thing("tools/target/debug/deps/b.rmeta")]);
    expect(piles.map((pile) => pile.label).sort()).toEqual(["src-tauri/target/debug/deps", "tools/target/debug/deps"]);
    expect(splitLane([thing("tmp/pdfs/rt89/p.png")]).piles[0].label).toBe("tmp/pdfs/rt89");
  });
});

describe("읽는 순서", () => {
  type Node = { name: string; children?: Node[] };
  const source = (nodes: Node[]): DirectorySource => ({
    async *list() {
      for (const node of nodes) yield { name: node.name, kind: node.children ? "directory" : "file" };
    },
    file: async () => ({ size: 1, lastModified: 0 }),
    directory: async (name) => source(nodes.find((node) => node.name === name)?.children ?? []),
  });

  it("tmp가 한도보다 많아도 맨 위 결과물과 보통 폴더를 먼저 읽어요", async () => {
    const pages = Array.from({ length: scanLimits.files + 200 }, (_, at) => ({ name: `page-${at}.png` }));
    const result = await scanFolder(source([{ name: "tmp", children: pages }, { name: "notes", children: [{ name: "a.md" }] }, { name: "RT4.pdf" }]));
    expect(result.files.slice(0, 2).map((file) => file.path)).toEqual(["RT4.pdf", "notes/a.md"]);
    expect(result.files).toHaveLength(scanLimits.files);
    expect(result.complete).toBe(false);
  });

  it("깊은 곳의 빌드 폴더(apps/…/target)도 맨 나중에 읽어, 옆 폴더 결과물이 한도 안에 들어와요", async () => {
    const deps = Array.from({ length: scanLimits.files + 50 }, (_, at) => ({ name: `lib${at}.rmeta` }));
    const result = await scanFolder(source([{ name: "apps", children: [{ name: "desk", children: [{ name: "target", children: [{ name: "debug", children: deps }] }, { name: "main.rs" }] }] }, { name: "docs", children: [{ name: "기획서.pdf" }] }]));
    expect(result.files.slice(0, 2).map((file) => file.path)).toEqual(["apps/desk/main.rs", "docs/기획서.pdf"]);
    expect(result.files[2].path).toBe("apps/desk/target/debug/lib0.rmeta");
    expect(result.complete).toBe(false);
  });

  it("폴더를 통째로 받는 브라우저 입력도 얕은 파일부터, 자동 생성 폴더는 나중에 읽어요", () => {
    const file = (path: string) => Object.assign(new File(["x"], path.split("/").pop()!), { webkitRelativePath: path });
    const list = [file("방/tmp/a.png"), file("방/deep/er/b.md"), file("방/RT4.pdf")] as unknown as FileList;
    expect(scanFileList(list).files.map((item) => item.path)).toEqual(["RT4.pdf", "deep/er/b.md", "tmp/a.png"]);
  });
});
