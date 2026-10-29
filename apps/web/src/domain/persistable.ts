const blockedKeys = new Set(["file", "objectUrl", "blobUrl", "previewUrl", "directoryHandle"]);

function isHandle(value: unknown): boolean {
  const ctor = (globalThis as { FileSystemHandle?: new () => object }).FileSystemHandle;
  return typeof ctor === "function" && value instanceof ctor;
}

export function ephemeralPath(value: unknown, path = "$"): string | null {
  if (typeof File !== "undefined" && value instanceof File) return path;
  if (typeof Blob !== "undefined" && value instanceof Blob) return path;
  if (isHandle(value)) return path;
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = ephemeralPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (blockedKeys.has(key)) return `${path}.${key}`;
    const found = ephemeralPath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}
