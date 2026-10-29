import type { Asset, Scene, Workspace } from "../domain/models";
import { fail, ok, type Result } from "../domain/result";
import type { WorkspaceStore } from "./storage";

// 공유 API(apps/server). 원본 파일은 보내지 않고 작업면·장면·파일 목록(메타데이터)만 주고받습니다.
const tokenKey = "folduct-token";

export type Role = "owner" | "editor" | "viewer";
export type User = { id: string; email: string; name: string };
export type SharedProject = { id: string; name: string; coverColor: string; role: Role };
type ServerWorkspace = { id: string; revision: number; content: Record<string, unknown>; updatedAt: string };
type ServerScene = Omit<Scene, "createdAt" | "snapshot"> & { createdAt: string; snapshot: Record<string, unknown> };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(tokenKey, token);
    else localStorage.removeItem(tokenKey);
  } catch {
    // 저장소가 막혀 있으면 이번 화면에서만 로그인이 유지되지 않습니다.
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "공유 서버에 연결하지 못했습니다.");
  }
  if (response.status === 204) return undefined as T;
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, json.error?.message ?? `요청이 실패했습니다 (${response.status}).`);
  return json.data as T;
}

export async function login(email: string, password: string): Promise<User> {
  const data = await call<{ token: string; user: User }>("POST", "/auth/login", { email, password });
  setToken(data.token);
  return data.user;
}

export async function register(email: string, name: string, password: string): Promise<User> {
  const data = await call<{ token: string; user: User }>("POST", "/auth/register", { email, name, password });
  setToken(data.token);
  return data.user;
}

export async function logout() {
  await call("POST", "/auth/logout").catch(() => undefined);
  setToken(null);
}

export async function me(): Promise<User | null> {
  if (!getToken()) return null;
  try {
    return await call<User>("GET", "/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) setToken(null);
    return null;
  }
}

export const listSharedProjects = () => call<SharedProject[]>("GET", "/projects");
export const getSharedProject = (id: string) => call<SharedProject>("GET", `/projects/${id}`);
export const createShareLink = (id: string) => call<{ token: string; expiresAt: string }>("POST", `/projects/${id}/share-links`, { expiresInDays: 7 });
export const acceptShareLink = (token: string) => call<{ projectId: string; role: Role }>("POST", `/share-links/${encodeURIComponent(token)}/accept`);

// "공유하기": 로컬 프로젝트의 작업면과 파일 목록을 올립니다. 파일 내용(File, 폴더 핸들)은 Asset에 없습니다.
export async function shareProject(project: { name: string; coverColor: string }, workspace: Workspace, assets: Asset[]): Promise<string> {
  const data = await call<{ project: { id: string } }>("POST", "/projects", {
    name: project.name,
    coverColor: project.coverColor,
    workspace: { ...workspace, assets: assets.map(assetMetadata) },
  });
  return data.project.id;
}

function assetMetadata({ id, projectId, relativePath, displayName, kind, size, lastModified }: Asset): Asset {
  return { id, projectId, relativePath, displayName, kind, size, lastModified, availability: "permissionRequired" };
}

function toWorkspace(doc: ServerWorkspace): { workspace: Workspace; assets: Asset[] } {
  const { assets = [], ...content } = doc.content as Partial<Workspace> & { assets?: Asset[] };
  return {
    workspace: { ...(content as Workspace), projectId: doc.id, revision: doc.revision, updatedAt: Date.parse(doc.updatedAt) },
    assets,
  };
}

function toScene(scene: ServerScene): Scene {
  const { assets: _assets, ...snapshot } = scene.snapshot;
  return {
    ...scene,
    createdAt: Date.parse(scene.createdAt),
    snapshot: { ...(snapshot as unknown as Workspace), projectId: scene.projectId, revision: scene.sourceRevision },
  };
}

export async function loadSharedWorkspace(id: string) {
  const [project, workspace, scenes] = await Promise.all([
    getSharedProject(id),
    call<ServerWorkspace>("GET", `/projects/${id}/workspace`),
    call<ServerScene[]>("GET", `/projects/${id}/scenes`),
  ]);
  return { project, ...toWorkspace(workspace), scenes: scenes.map(toScene) };
}

function issue(error: unknown): Result<never> {
  if (error instanceof ApiError && error.status === 409) return fail("conflict", `${error.message} 위의 ‘최신 작업면 불러오기’를 누르세요.`);
  return fail("aborted", error instanceof Error ? error.message : "공유 서버에 저장하지 못했습니다.");
}

// WorkspaceEditor가 IndexedDB 대신 공유 서버에 저장하도록 같은 모양으로 감쌉니다.
export function remoteStore(assets: Asset[]): WorkspaceStore {
  async function save(projectId: string, expectedRevision: number, workspace: unknown) {
    const doc = await call<ServerWorkspace>("PUT", `/projects/${projectId}/workspace`, {
      expectedRevision,
      workspace: { ...(workspace as Workspace), assets: assets.map(assetMetadata) },
    });
    return toWorkspace(doc).workspace;
  }
  return {
    async saveWorkspace(projectId, expectedRevision, workspace) {
      try {
        return ok(await save(projectId, expectedRevision, workspace));
      } catch (error) {
        return issue(error);
      }
    },
    async captureScene(input) {
      try {
        const workspace = await save(input.projectId, input.expectedRevision, input.workspace);
        const scene = await call<ServerScene>("POST", `/projects/${input.projectId}/scenes`, {
          title: input.title,
          type: input.type,
          snapshot: workspace,
          assetManifest: assets.map((asset) => ({ assetId: asset.id, relativePath: asset.relativePath, displayName: asset.displayName, size: asset.size, lastModified: asset.lastModified })),
        });
        return ok({ scene: toScene(scene), workspace });
      } catch (error) {
        return issue(error);
      }
    },
    // shortcut: 서버에 "장면에서 이어가기" API가 없어 공유 프로젝트에서는 막음, 필요해지면 서버에 안전 장면+작업면 교체를 한 요청으로 추가할 것
    async continueFromScene() {
      return fail("invalid", "공유 프로젝트에서는 장면에서 이어가기를 아직 지원하지 않습니다.");
    },
  };
}
