import { coverPalette, defaultCoverPath, firstOpenDeskPosition } from "../domain/deskLayout";
import { rememberSessionFiles } from "../gateways/sessionFiles";
import { sampleFiles } from "../sampleData";
import type { FolductStorage } from "./storage";

export function sampleRelativePath(file: { path: string; name: string }): string {
  const parts = file.path.split("/").filter(Boolean);
  return parts.slice(1).join("/") || file.name;
}

export function attachDemoFiles(projectId: string) {
  rememberSessionFiles(
    projectId,
    sampleFiles.map((file) => ({ relativePath: sampleRelativePath(file), file: file.file })),
  );
}

let seeding: Promise<void> | null = null;

export function seedDemoIfEmpty(storage: FolductStorage): Promise<void> {
  if (seeding) return seeding;
  seeding = seedOnce(storage).finally(() => {
    seeding = null;
  });
  return seeding;
}

async function seedOnce(storage: FolductStorage): Promise<void> {
  const projects = await storage.listProjects();
  if (projects.length > 0) return;
  const files = sampleFiles.map((file) => {
    const relativePath = sampleRelativePath(file);
    return {
      relativePath,
      displayName: file.name,
      kind: file.kind,
      size: file.size,
      lastModified: file.modifiedAt,
      availability: "available" as const,
      file: file.file,
    };
  });
  const position = firstOpenDeskPosition([]);
  if (!position) return;
  const created = await storage.createConnectedProject({
    name: "샘플 책상",
    coverColor: coverPalette[0],
    deskPosition: position,
    root: { sourceMode: "input", rootName: "샘플", directoryHandle: null },
    files: files.map(({ file: _file, ...asset }) => asset),
    scan: { complete: true, collected: files.length, failed: 0, stoppedReason: null },
    coverRelativePath: defaultCoverPath(files),
  });
  if (!created.ok) return;
  attachDemoFiles(created.value.project.id);
}
