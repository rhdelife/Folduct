import { useEffect, useRef, useState } from "react";
import { BudgetBanner } from "../components/RoomCapacity";
import { WorkspaceEditor, type CareProps } from "../components/WorkspaceEditor";
import { budgetNoticeDue, roomUsage, type CareRecord, type CareSettings } from "../domain/care";
import { askPermission, readPermission } from "../gateways/fileGateway";
import { sessionHasFiles } from "../gateways/sessionFiles";
import type { Asset, Project, RootRecord, Scene, Workspace } from "../domain/models";
import { reconcileBox, restoreFromBox } from "../services/careSweep";
import { attachDemoFiles } from "../services/demoDesk";
import type { FolductStorage } from "../services/storage";

export function ProjectPage({
  storage,
  projectId,
  demo,
  onBack,
}: {
  storage: FolductStorage;
  projectId: string;
  demo: boolean;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "missing" | "ready">("loading");
  const [project, setProject] = useState<Project | null>(null);
  const [root, setRoot] = useState<RootRecord | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [permission, setPermission] = useState<"granted" | "prompt" | "denied" | "unknown" | "none">("none");
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [sessionFiles, setSessionFiles] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [care, setCare] = useState<CareRecord | null>(null);
  const [workDays, setWorkDays] = useState<string[]>([]);
  const [now] = useState(() => Date.now());
  const [budgetBanner, setBudgetBanner] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const pendingTouch = useRef(new Set<string>());
  const touchTimer = useRef<number | null>(null);

  // 드래그 중에는 손댄 카드만 모아 두었다가 한 번에 저장합니다.
  function flushTouch() {
    if (touchTimer.current) window.clearTimeout(touchTimer.current);
    touchTimer.current = null;
    const ids = [...pendingTouch.current];
    pendingTouch.current.clear();
    if (ids.length > 0) void storage.touchCards(projectId, ids);
  }

  useEffect(() => () => flushTouch(), [projectId, storage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      const found = await storage.getProject(projectId);
      if (cancelled) return;
      if (!found) {
        setStatus("missing");
        return;
      }
      const [foundRoot, foundAssets, foundHandle, foundWorkspace, foundScenes] = await Promise.all([
        found.rootRefId ? storage.getRoot(found.rootRefId) : Promise.resolve(null),
        storage.listAssets(projectId),
        found.rootRefId ? storage.getDirectoryHandle(found.rootRefId) : Promise.resolve(null),
        storage.getWorkspace(projectId),
        storage.listScenes(projectId),
      ]);
      if (cancelled) return;
      if (!foundWorkspace) {
        setStatus("missing");
        return;
      }
      if (demo && foundRoot?.sourceMode === "input" && foundRoot.rootName === "샘플") attachDemoFiles(found.id);
      setProject(found);
      setRoot(foundRoot);
      setAssets(foundAssets);
      setWorkspace(foundWorkspace);
      setScenes(foundScenes);
      setHandle(foundHandle);
      setSessionFiles(sessionHasFiles(projectId));
      const access = foundHandle ? await readPermission(foundHandle) : "none";
      setPermission(access);
      // 이동 도중 꺼졌던 기록이 있으면 실제 파일 위치에 맞춘 뒤 보여줍니다.
      if (foundHandle && access === "granted") await reconcileBox(storage, projectId, foundHandle);
      const noticed = await storage.noticeCards(projectId, foundWorkspace.cards.map((card) => card.id));
      const [foundCare, foundDays, freshAssets] = await Promise.all([
        noticed.ok ? Promise.resolve(noticed.value) : storage.getCare(projectId),
        storage.getWorkDayList(projectId),
        storage.listAssets(projectId),
      ]);
      if (cancelled) return;
      setCare(foundCare);
      setWorkDays(foundDays);
      setAssets(freshAssets);
      // 방 크기를 넘은 방은 주 1회만 배너를 띄웁니다. 띄운 시각을 남겨 이번 주에는 다시 묻지 않습니다.
      if (budgetNoticeDue(roomUsage(freshAssets, foundRoot, foundCare), foundCare, now)) {
        setBudgetBanner(true);
        void storage.updateCare(projectId, { budgetNoticeAt: now });
      }
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, projectId, storage]);

  async function allowFolder() {
    if (!handle) return;
    setPermissionError(null);
    const next = await askPermission(handle);
    setPermission(next);
    if (next !== "granted") {
      setPermissionError("폴더 접근이 허용되지 않았습니다. 파일 이름과 배치는 그대로 남아 있습니다.");
      return;
    }
    setCare(await reconcileBox(storage, projectId, handle));
    setAssets(await storage.listAssets(projectId));
  }

  async function changeCare(patch: Partial<CareSettings>) {
    const result = await storage.updateCare(projectId, patch);
    if (result.ok) setCare(result.value);
  }

  const usage = roomUsage(assets, root, care);
  const careProps: CareProps | undefined = care ? {
    record: care,
    usage,
    workDays,
    now,
    onTouch(ids) {
      const at = Date.now();
      setCare((current) => current && { ...current, touched: { ...current.touched, ...Object.fromEntries(ids.map((id) => [id, at])) } });
      for (const id of ids) pendingTouch.current.add(id);
      if (!touchTimer.current) touchTimer.current = window.setTimeout(flushTouch, 1000);
    },
    async onPin(cardId, pinned) {
      const result = await storage.setPinned(projectId, cardId, pinned);
      if (result.ok) setCare(result.value);
    },
    onSettings: changeCare,
    async onRestore(assetId) {
      flushTouch();
      const result = await restoreFromBox(storage, projectId, handle, assetId);
      if (!result.ok) return result.error.message;
      setCare(result.value.care);
      setAssets((current) => current.map((asset) => (asset.id === assetId ? result.value.asset : asset)));
      return null;
    },
  } : undefined;

  if (status === "loading") return <main className="page-status"><p>프로젝트를 불러오는 중</p></main>;
  if (status === "missing" || !project || !workspace) {
    return (
      <main className="page-status">
        <h1>프로젝트를 찾지 못했습니다</h1>
        <p>주소의 프로젝트가 이 브라우저 저장소에 없습니다.</p>
        <button type="button" className="primary" onClick={onBack}>책상으로 돌아가기</button>
      </main>
    );
  }

  return (
    <WorkspaceEditor
      key={project.id}
      storage={storage}
      projectId={project.id}
      projectName={project.name}
      demo={demo}
      assets={assets}
      initialWorkspace={workspace}
      initialScenes={scenes}
      lastPausedSceneId={project.lastPausedSceneId}
      directoryHandle={permission === "granted" ? handle : null}
      care={careProps}
      onBack={() => { flushTouch(); onBack(); }}
      banner={
        <>
          <section className="access-banner" aria-live="polite">
            <AccessCopy root={root} permission={permission} sessionFiles={sessionFiles} demo={demo} />
            {handle && permission !== "granted" && (
              <button type="button" className="primary" onClick={() => void allowFolder()}>폴더 접근 허용</button>
            )}
            {permissionError && <p className="error" role="alert">{permissionError}</p>}
          </section>
          {budgetBanner && (
            <BudgetBanner
              assets={assets}
              usage={usage}
              copied={copied}
              onCopy={(path) => void navigator.clipboard?.writeText(path).then(() => setCopied(path))}
              onGrow={(budgetBytes) => { setBudgetBanner(false); void changeCare({ budgetBytes }); }}
              onHide={() => setBudgetBanner(false)}
            />
          )}
          {root?.scan && !root.scan.complete && (
            <p className="scan-banner">
              {root.scan.stoppedReason === "file-limit"
                ? "파일 1,000개까지만 연결되어 있습니다."
                : "일부 폴더는 깊이 제한으로 포함되지 않았습니다."}
              {root.scan.failed > 0 ? ` 읽지 못한 항목 ${root.scan.failed.toLocaleString("ko-KR")}개가 있습니다.` : ""}
            </p>
          )}
        </>
      }
    />
  );
}

function AccessCopy({
  root,
  permission,
  sessionFiles,
  demo,
}: {
  root: RootRecord | null;
  permission: "granted" | "prompt" | "denied" | "unknown" | "none";
  sessionFiles: boolean;
  demo: boolean;
}) {
  if (demo && root?.rootName === "샘플") {
    return <p>샘플 자료입니다. 배치와 메모는 이 브라우저에 저장되고, 고른 카드에서 내용을 미리볼 수 있습니다.</p>;
  }
  if (root?.sourceMode === "input" && !sessionFiles) {
    return <p>폴더를 다시 선택하기 전에는 파일 내용을 열 수 없습니다. 이름, 배치, 메모는 저장되어 있습니다.</p>;
  }
  if (sessionFiles) {
    return <p>이 세션에서 고른 파일 내용을 미리볼 수 있습니다. 브라우저를 닫으면 폴더를 다시 선택해야 합니다.</p>;
  }
  if (permission === "granted") return <p>폴더 접근이 허용되어 있어 파일 내용을 미리볼 수 있습니다.</p>;
  if (permission === "denied" || permission === "prompt") {
    return <p>폴더 접근이 없으면 파일 내용을 열 수 없습니다. 저장된 이름과 경로는 남아 있습니다.</p>;
  }
  return <p>파일 내용을 열려면 폴더 접근이 필요합니다. 저장된 목록은 먼저 보여 줍니다.</p>;
}
