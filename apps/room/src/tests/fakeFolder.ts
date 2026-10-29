import type { MoveDirectory, MoveFile } from "../gateways/mover";

// 테스트용 메모리 폴더. 브라우저 move()처럼 옮기기만 하고, 지우거나 고쳐 쓰는 손은 없습니다.
export type MemoryDir = { dirs: Map<string, MemoryDir>; files: Map<string, string> };
export const memoryDir = (): MemoryDir => ({ dirs: new Map(), files: new Map() });
const notFound = () => new DOMException("없음", "NotFoundError");

export function view(dir: MemoryDir, withMove = true): MoveDirectory & { raw: MemoryDir } {
  return {
    raw: dir,
    async getDirectoryHandle(name, options) {
      let child = dir.dirs.get(name);
      if (!child) {
        if (!options?.create) throw notFound();
        child = memoryDir();
        dir.dirs.set(name, child);
      }
      return view(child, withMove);
    },
    async getFileHandle(name) {
      if (!dir.files.has(name)) throw notFound();
      const handle: MoveFile = {};
      if (withMove) {
        handle.move = async (destination, newName) => {
          const target = (destination as MoveDirectory & { raw: MemoryDir }).raw;
          target.files.set(newName, dir.files.get(name)!);
          dir.files.delete(name);
        };
      }
      return handle;
    },
  };
}

// 하위 경로("a/b/c.txt")에 파일을 둡니다. 중간 폴더는 만듭니다.
export function put(root: MemoryDir, path: string, data: string): void {
  const parts = path.split("/");
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    if (!dir.dirs.has(part)) dir.dirs.set(part, memoryDir());
    dir = dir.dirs.get(part)!;
  }
  dir.files.set(parts[parts.length - 1], data);
}

export function seed(files: Record<string, string> = { "참고/시안.psd": "원본" }): MemoryDir {
  const root = memoryDir();
  for (const [path, data] of Object.entries(files)) put(root, path, data);
  return root;
}
