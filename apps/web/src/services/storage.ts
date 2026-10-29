import type { FolductRepository, RepositoryOptions } from "../repositories/folductRepository";
import { FolductRepository as Repository } from "../repositories/folductRepository";
import { openDatabase } from "../repositories/openDatabase";
import { DATABASE_NAME, DEMO_DATABASE_NAME } from "../repositories/schema";
import type { Result } from "../domain/result";

export type { RepositoryOptions, WriteOperation } from "../repositories/folductRepository";
export type FolductStorage = FolductRepository;
// 작업 화면이 쓰는 저장 기능. 공유 프로젝트는 services/api.ts의 remoteStore가 같은 모양을 채웁니다.
export type WorkspaceStore = Pick<FolductRepository, "saveWorkspace" | "captureScene" | "continueFromScene">;

export { DEMO_DATABASE_NAME };

export function deleteStorage(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("저장소를 지우지 못했습니다."));
    request.onblocked = () => resolve();
  });
}

export async function openStorage(databaseName = DATABASE_NAME, options: RepositoryOptions = {}): Promise<Result<FolductStorage>> {
  const opened = await openDatabase(databaseName);
  if (!opened.ok) return opened;
  return { ok: true, value: new Repository(opened.value, options) };
}
