const sessions = new Map<string, Map<string, File>>();

export function rememberSessionFiles(projectId: string, files: { relativePath: string; file: File | null }[]) {
  const map = new Map<string, File>();
  for (const file of files) {
    if (file.file) map.set(file.relativePath, file.file);
  }
  if (map.size > 0) sessions.set(projectId, map);
}

export function sessionHasFiles(projectId: string): boolean {
  return (sessions.get(projectId)?.size ?? 0) > 0;
}

export function sessionFile(projectId: string, relativePath: string): File | null {
  return sessions.get(projectId)?.get(relativePath) ?? null;
}
