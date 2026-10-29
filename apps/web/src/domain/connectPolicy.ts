import type { SourceMode } from "./models";

export type SaveBlock = "cancelled" | "empty-input" | "same-handle";

export function canSaveNewProject(input: {
  confirmed: boolean;
  sourceMode: SourceMode;
  fileCount: number;
  failureCount: number;
  cancelled: boolean;
  sameHandleProjectId: string | null;
}): { ok: true } | { ok: false; reason: SaveBlock } {
  if (!input.confirmed || input.cancelled) return { ok: false, reason: "cancelled" };
  if (input.sameHandleProjectId) return { ok: false, reason: "same-handle" };
  if (input.sourceMode === "input" && input.fileCount === 0 && input.failureCount === 0) {
    return { ok: false, reason: "empty-input" };
  }
  return { ok: true };
}

export function sameNameWarning(sourceMode: SourceMode, sameRootNameCount: number): string | null {
  if (sourceMode !== "input" || sameRootNameCount < 1) return null;
  return "이름이 같은 폴더가 이미 있습니다. 폴더 이름이 같다고 같은 폴더로 연결하지 않습니다. 다른 폴더라면 새로 만들고, 이미 연결한 폴더라면 기존 프로젝트를 여세요.";
}
