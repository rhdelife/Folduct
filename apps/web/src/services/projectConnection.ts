import { canSaveNewProject } from "../domain/connectPolicy";
import { fail, type Result } from "../domain/result";
import type { CreatedProject, Project } from "../domain/models";
import type { FolderDraft } from "../gateways/fileGateway";
import { rememberSessionFiles } from "../gateways/sessionFiles";
import type { FolductStorage } from "./storage";

export async function findProjectForHandle(storage: FolductStorage, handle: FileSystemDirectoryHandle): Promise<Project | null> {
  const projects = await storage.listProjects();
  for (const project of projects) {
    if (!project.rootRefId) continue;
    const root = await storage.getRoot(project.rootRefId);
    if (!root || root.sourceMode !== "handle") continue;
    const saved = await storage.getDirectoryHandle(root.id);
    if (!saved || typeof saved.isSameEntry !== "function") continue;
    try {
      if (await saved.isSameEntry(handle)) return project;
    } catch {
      // 비교할 수 없으면 같은 폴더로 단정하지 않습니다.
    }
  }
  return null;
}

export async function saveConfirmedFolder(
  storage: FolductStorage,
  input: {
    confirmed: boolean;
    draft: FolderDraft;
    name: string;
    coverColor: string;
    deskPosition: { x: number; y: number };
    coverRelativePath: string | null;
    sameHandleProjectId: string | null;
  },
): Promise<Result<CreatedProject & { assets: { id: string }[] }>> {
  const decision = canSaveNewProject({
    confirmed: input.confirmed,
    sourceMode: input.draft.sourceMode,
    fileCount: input.draft.scan.files.length,
    failureCount: input.draft.scan.failures.length,
    cancelled: input.draft.scan.stoppedReason === "cancelled",
    sameHandleProjectId: input.sameHandleProjectId,
  });
  if (!decision.ok) {
    if (decision.reason === "empty-input") {
      return fail("invalid", "디렉터리 입력으로는 빈 폴더를 확인할 수 없어 프로젝트를 만들지 않았습니다.");
    }
    if (decision.reason === "same-handle") {
      return fail("invalid", "이미 연결된 폴더입니다. 새 프로젝트를 만들지 않았습니다.");
    }
    return fail("invalid", "폴더 연결을 확정하지 않아 프로젝트를 만들지 않았습니다.");
  }
  const created = await storage.createConnectedProject({
    name: input.name,
    coverColor: input.coverColor,
    deskPosition: input.deskPosition,
    root: {
      sourceMode: input.draft.sourceMode,
      rootName: input.draft.rootName,
      directoryHandle: input.draft.handle,
    },
    files: input.draft.scan.files.map((file) => ({
      relativePath: file.relativePath,
      displayName: file.displayName,
      kind: file.kind,
      size: file.size,
      lastModified: file.lastModified,
      availability: "available",
    })),
    scan: {
      complete: input.draft.scan.complete,
      collected: input.draft.scan.files.length,
      failed: input.draft.scan.failures.length,
      stoppedReason: input.draft.scan.stoppedReason,
    },
    coverRelativePath: input.coverRelativePath,
  });
  if (!created.ok) return created;
  rememberSessionFiles(created.value.project.id, input.draft.scan.files);
  return created;
}
