import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AddProjectDialog } from "../components/AddProjectDialog";
import { ProjectCard } from "../components/ProjectCard";
import { CapacityBar } from "../components/RoomCapacity";
import { WeeklySweepDialog } from "../components/WeeklySweepDialog";
import { roomUsage, sweepDue, type RoomUsage } from "../domain/care";
import { firstActionLine, firstOpenDeskPosition } from "../domain/deskLayout";
import { limits } from "../domain/limits";
import { formatByteSize } from "../domain/preview";
import type { DeskPosition, Project, RootRecord, Scene } from "../domain/models";
import { canUseDirectoryPicker, draftFromFileList, pickDirectory, readPermission, type FolderDraft } from "../gateways/fileGateway";
import { planSweep, type SweepPlan } from "../services/careSweep";
import { findProjectForHandle } from "../services/projectConnection";
import type { FolductStorage } from "../services/storage";

type DeskRecord = {
  project: Project;
  root: RootRecord | null;
  nextAction: string;
  pausedAt: number | null;
  permission: "granted" | "prompt" | "denied" | "unknown" | "none";
  workDays: number | null;
  fileCount: number;
  totalBytes: number | null;
  countExact: boolean;
  usage: RoomUsage;
  budgetBytes: number | null;
};

type Wizard =
  | { step: "scanning"; collected: number; failed: number; currentPath: string }
  | { step: "denied"; message: string }
  | { step: "confirm"; draft: FolderDraft; sameHandle: { id: string; name: string } | null };

export function DeskPage({
  storage,
  demo,
  onOpenProject,
  onEnterDemo,
  onExitDemo,
  onResetDemo,
  onReseedDemo,
  onShareProject,
  onOpenShared,
}: {
  storage: FolductStorage;
  demo: boolean;
  onOpenProject: (projectId: string) => void;
  onEnterDemo: () => void;
  onExitDemo: () => void;
  onResetDemo: () => void;
  onReseedDemo: () => void;
  onShareProject?: (projectId: string) => Promise<void>;
  onOpenShared?: () => void;
}) {
  const [records, setRecords] = useState<DeskRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<"desk" | "list">(() => (window.matchMedia("(max-width: 1023px)").matches ? "list" : "desk"));
  const [encoding, setEncoding] = useState<"none" | "work" | "files">("none");
  const [positions, setPositions] = useState<Record<string, DeskPosition>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [scale, setScale] = useState(1);
  const [sweepPlans, setSweepPlans] = useState<SweepPlan[] | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function share(projectId: string) {
    if (!onShareProject) return;
    setNotice("공유 서버에 작업면과 파일 목록을 올리는 중입니다.");
    try {
      await onShareProject(projectId);
    } catch (error) {
      setNotice(`공유하지 못했습니다. ${error instanceof Error ? error.message : ""}`);
    }
  }

  async function reload() {
    setLoadError(null);
    try {
      const projects = await storage.listProjects();
      const next = await Promise.all(projects.map((project) => loadRecord(storage, project)));
      setRecords(next);
      setPositions(Object.fromEntries(next.map((record) => [record.project.id, record.project.deskPosition])));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "책상을 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    void reload().then(() => checkWeeklySweep());
    return () => abortRef.current?.abort();
    // storage 인스턴스가 바뀌면 책상을 다시 읽습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      if (width <= 0 || height <= 0) return;
      setScale(Math.min(1, width / limits.deskWidth, height / limits.deskHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [records, view]);

  const occupied = useMemo(() => Object.values(positions), [positions]);
  const nextPosition = firstOpenDeskPosition(occupied) ?? { x: 48, y: 48 };

  async function beginPicker() {
    if ((records?.length ?? 0) >= limits.projects) {
      setNotice("프로젝트는 12개까지 책상에 둘 수 있습니다.");
      return;
    }
    setNotice(null);
    setSaveError(null);
    if (!canUseDirectoryPicker()) {
      inputRef.current?.click();
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setWizard({ step: "scanning", collected: 0, failed: 0, currentPath: "" });
    const picked = await pickDirectory({
      signal: controller.signal,
      onProgress: (progress) => setWizard({ step: "scanning", ...progress }),
    });
    abortRef.current = null;
    if (picked.status === "cancelled" || picked.status === "unavailable") {
      setWizard(null);
      return;
    }
    if (picked.status === "denied") {
      setWizard({ step: "denied", message: picked.message });
      return;
    }
    await openDraft(picked.draft);
  }

  async function onInput(event: ChangeEvent<HTMLInputElement>) {
    const list = event.target.files;
    event.target.value = "";
    if (!list || list.length === 0) {
      setNotice("선택한 항목이 없어 프로젝트를 만들지 않았습니다. 디렉터리 입력으로는 빈 폴더를 확인할 수 없습니다.");
      return;
    }
    const draft = draftFromFileList(list);
    if (!draft) {
      setNotice("가져올 파일이 없습니다. 숨김 파일, .git, node_modules는 제외되며, 이 입력 방식으로 빈 폴더가 확인되지 않으면 프로젝트를 만들지 않습니다.");
      return;
    }
    await openDraft(draft);
  }

  async function openDraft(draft: FolderDraft) {
    const sameHandle = draft.handle ? await findProjectForHandle(storage, draft.handle) : null;
    setWizard({
      step: "confirm",
      draft,
      sameHandle: sameHandle ? { id: sameHandle.id, name: sameHandle.name } : null,
    });
  }

  async function commitPosition(project: Project, position: DeskPosition) {
    setSaveError(null);
    const saved = await storage.updateProject({
      projectId: project.id,
      deskPosition: position,
      deskPlacedByUser: true,
    });
    if (!saved.ok) {
      setSaveError(saved.error.message);
      setPositions((current) => ({ ...current, [project.id]: project.deskPosition }));
      return;
    }
    setRecords((current) =>
      current?.map((record) => (record.project.id === project.id ? { ...record, project: saved.value } : record)) ?? current,
    );
  }

  // 앱이 꺼져 있을 때는 알릴 수 없으므로 책상을 열 때 이번 주 정리를 확인합니다.
  async function checkWeeklySweep() {
    const last = await storage.getLastSweepAt();
    if (last === null) {
      await storage.setLastSweepAt();
      return;
    }
    if (sweepDue(last, Date.now())) await openSweep();
  }

  async function openSweep() {
    const plans = await planSweep(storage);
    if (plans.length > 0) {
      setSweepPlans(plans);
      return;
    }
    await storage.setLastSweepAt();
    setNotice("이번 주는 치울 게 없었어요.");
  }

  function cancelWizard() {
    abortRef.current?.abort();
    abortRef.current = null;
    setWizard(null);
  }

  return (
    <main className="desk-page">
      <header className="desk-bar">
        <div>
          <p className="eyebrow">{demo ? "샘플 체험" : "개인 책상"}</p>
          <h1>Folduct</h1>
        </div>
        <div className="bar-actions">
          <button type="button" className="primary" onClick={() => void beginPicker()}>프로젝트 추가</button>
          <button type="button" onClick={() => void openSweep()}>주간 정리</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView((current) => (current === "desk" ? "list" : "desk"))}>
            {view === "desk" ? "목록으로 보기" : "책상으로 보기"}
          </button>
          {demo ? (
            <>
              <button type="button" onClick={onResetDemo}>데모 초기화</button>
              <button type="button" onClick={onExitDemo}>데모 종료</button>
            </>
          ) : (
            <button type="button" onClick={onEnterDemo}>샘플 체험</button>
          )}
          {onOpenShared && <button type="button" onClick={onOpenShared}>공유 프로젝트</button>}
        </div>
      </header>
      <div className="encoding-controls" role="group" aria-label="책상 데이터 보기">
        <span>책상 보기</span>
        <button type="button" aria-pressed={encoding === "none"} onClick={() => setEncoding("none")}>기본</button>
        <button type="button" aria-pressed={encoding === "work"} onClick={() => setEncoding("work")}>작업한 날</button>
        <button type="button" aria-pressed={encoding === "files"} onClick={() => setEncoding("files")}>자료 수</button>
        <span className="encoding-explain">{encoding === "work" ? "작은 띠의 채도는 최근 30일에 실제 작업한 날짜를 뜻합니다." : encoding === "files" ? "종이 층은 확인된 파일 수를 뜻합니다. 파일 용량과는 다릅니다." : "원래 표지와 책상 배치를 보여줍니다."}</span>
        {encoding === "work" && <span className="encoding-legend">채도 구간: 0일 · 1~2일 · 3~7일 · 8일 이상 · 기록 없음</span>}
        {encoding === "files" && <span className="encoding-legend">종이 층: 0개 · 1~9개 · 10~99개 · 100개 이상 · 미확인</span>}
      </div>
      <input
        ref={inputRef}
        className="picker-input"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void onInput(event)}
        {...{ webkitdirectory: "", directory: "" }}
      />
      {notice && <p className="notice" role="status">{notice}</p>}
      {saveError && <p className="error" role="alert">위치를 저장하지 못했습니다. {saveError}</p>}
      {loadError && <p className="error" role="alert">{loadError}</p>}
      <div className="desk-body">
      {records === null && !loadError && <p className="page-status">책상을 불러오는 중</p>}
      {records?.length === 0 && (
        <section className="empty-desk">
          <h2>아직 연결된 프로젝트가 없습니다</h2>
          <p>
            {demo
              ? "샘플 저장소가 비어 있습니다. 샘플 프로젝트를 다시 만들거나 폴더를 연결할 수 있습니다. 실제 프로젝트는 다른 저장소에 있습니다."
              : "내 폴더를 연결하거나 샘플 책상에서 흐름을 먼저 볼 수 있습니다. 샘플은 별도 저장 공간에 있으며 실제 프로젝트를 지우지 않습니다."}
          </p>
          <div className="sheet-actions">
            <button type="button" className="primary" onClick={() => void beginPicker()}>내 폴더 연결</button>
            {demo ? (
              <button type="button" onClick={onReseedDemo}>샘플 프로젝트 만들기</button>
            ) : (
              <button type="button" onClick={onEnterDemo}>샘플 체험</button>
            )}
          </div>
        </section>
      )}
      {records && records.length > 0 && view === "list" && (
        <ul className="project-list">
          {records.map((record) => (
            <li key={record.project.id}>
              <div>
                <h2>{record.project.name}</h2>
                <p>{connectionLabel(record)}</p>
                <p>{firstActionLine(record.nextAction) || "다음 행동은 아직 없습니다"}</p>
                <CapacityBar usage={record.usage} budgetBytes={record.budgetBytes} />
                {encoding === "work" && <p>{record.workDays === null ? "작업 날짜 기록 없음" : `최근 30일 작업한 날 ${record.workDays}일`}</p>}
                {encoding === "files" && <p>{!record.root?.scan ? "자료 수 미확인" : record.countExact ? `확인된 파일 ${record.fileCount}개${record.totalBytes === null ? "" : ` · 파일 정보 합계 ${formatByteSize(record.totalBytes)}`}` : `최소 ${record.fileCount}개 확인 · 전체 수 미확인`}{record.root?.lastScanAt ? ` · 마지막 확인 ${new Date(record.root.lastScanAt).toLocaleDateString("ko-KR")}` : ""}</p>}
              </div>
              <div className="sheet-actions">
                {onShareProject && <button type="button" onClick={() => void share(record.project.id)}>공유하기</button>}
                <button type="button" className="primary" onClick={() => onOpenProject(record.project.id)}>이어서 시작</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {records && records.length > 0 && view === "desk" && (
        <div className="desk-frame" ref={frameRef}>
          <div className="desk-scaler" style={{ width: limits.deskWidth * scale, height: limits.deskHeight * scale }}>
            <div className="desk-surface" style={{ width: limits.deskWidth, height: limits.deskHeight, transform: `scale(${scale})` }}>
              {records.map((record) => (
                <ProjectCard
                  key={record.project.id}
                  project={record.project}
                  root={record.root}
                  encoding={encoding}
                  workDays={record.workDays}
                  fileCount={record.fileCount}
                  totalBytes={record.totalBytes}
                  countExact={record.countExact}
                  usage={record.usage}
                  budgetBytes={record.budgetBytes}
                  nextAction={record.nextAction}
                  pausedAt={record.pausedAt}
                  connection={connectionLabel(record)}
                  scale={scale}
                  position={positions[record.project.id] ?? record.project.deskPosition}
                  onPosition={(position) => setPositions((current) => ({ ...current, [record.project.id]: position }))}
                  onCommit={(position) => void commitPosition(record.project, position)}
                  onOpen={() => onOpenProject(record.project.id)}
                  onShare={onShareProject && (() => void share(record.project.id))}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      </div>
      {sweepPlans && (
        <WeeklySweepDialog
          storage={storage}
          plans={sweepPlans}
          onDone={(changed) => {
            setSweepPlans(null);
            if (changed) void reload();
          }}
        />
      )}
      {wizard?.step === "scanning" && (
        <dialog className="sheet" open aria-labelledby="scan-title">
          <div className="panel">
            <h2 id="scan-title">폴더를 읽는 중</h2>
            <p>파일 {wizard.collected.toLocaleString("ko-KR")}개{wizard.failed > 0 ? `, 실패 ${wizard.failed.toLocaleString("ko-KR")}개` : ""}</p>
            {wizard.currentPath && <p className="path">{wizard.currentPath}</p>}
            <div className="sheet-actions">
              <button type="button" onClick={cancelWizard}>취소</button>
            </div>
          </div>
        </dialog>
      )}
      {wizard?.step === "denied" && (
        <dialog className="sheet" open aria-labelledby="denied-title">
          <div className="panel">
            <h2 id="denied-title">폴더를 연결하지 못했습니다</h2>
            <p>{wizard.message}</p>
            <div className="sheet-actions">
              <button type="button" onClick={cancelWizard}>닫기</button>
              <button type="button" onClick={() => { cancelWizard(); inputRef.current?.click(); }}>폴더 입력으로 선택</button>
              <button type="button" className="primary" onClick={() => void beginPicker()}>다시 시도</button>
            </div>
          </div>
        </dialog>
      )}
      {wizard?.step === "confirm" && (
        <AddProjectDialog
          storage={storage}
          draft={wizard.draft}
          projects={records?.map((record) => ({ id: record.project.id, name: record.project.name, rootName: record.root?.rootName ?? null })) ?? []}
          position={nextPosition}
          sameHandleProject={wizard.sameHandle}
          onCancel={cancelWizard}
          onOpenProject={(projectId) => {
            cancelWizard();
            onOpenProject(projectId);
          }}
          onCreated={(projectId) => {
            cancelWizard();
            onOpenProject(projectId);
          }}
        />
      )}
    </main>
  );
}

async function loadRecord(storage: FolductStorage, project: Project): Promise<DeskRecord> {
  const [root, workspace, handle, assets, workDays, care] = await Promise.all([
    project.rootRefId ? storage.getRoot(project.rootRefId) : Promise.resolve(null),
    storage.getWorkspace(project.id),
    project.rootRefId ? storage.getDirectoryHandle(project.rootRefId) : Promise.resolve(null),
    storage.listAssets(project.id),
    storage.getRecentWorkDays(project.id),
    storage.getCare(project.id),
  ]);
  let pausedAt: number | null = null;
  if (project.lastPausedSceneId) {
    const scene: Scene | null = await storage.getScene(project.lastPausedSceneId);
    pausedAt = scene?.createdAt ?? null;
  }
  return {
    project,
    root,
    nextAction: workspace?.nextAction ?? "",
    pausedAt,
    workDays,
    fileCount: root?.scan?.collected ?? assets.length,
    totalBytes: root?.scan?.complete && root.scan.failed === 0 && root.scan.collected === assets.length ? assets.reduce((sum, asset) => sum + asset.size, 0) : null,
    countExact: Boolean(root?.scan?.complete && root.scan.failed === 0),
    usage: roomUsage(assets, root, care),
    budgetBytes: care.budgetBytes,
    permission: handle ? await readPermission(handle) : "none",
  };
}

function connectionLabel(record: DeskRecord): string {
  if (!record.root) return "폴더 정보 없음";
  if (record.root.rootName === "샘플") return "샘플 자료";
  if (record.root.scan && !record.root.scan.complete) return "일부만 연결됨";
  if (record.root.sourceMode === "input") return "다시 선택하기 전에는 내용 제한";
  if (record.permission === "granted") return "폴더 연결됨";
  if (record.permission === "denied" || record.permission === "prompt") return "접근 권한 필요";
  return "연결 상태를 확인하지 못함";
}
