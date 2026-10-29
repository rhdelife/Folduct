import { useEffect, useRef, useState, type ReactNode } from "react";
import { boxFolderName, cardStage, defaultCardSize, firstLine, iconScale, isBoxedCard, isInBox, touchedCardIds, type CareRecord, type CareSettings, type RoomUsage } from "../domain/care";
import { createId } from "../domain/ids";
import { absoluteOrigin } from "../domain/coordinates";
import { limits } from "../domain/limits";
import type { Asset, Card, Scene, Workspace, Zone } from "../domain/models";
import { formatByteSize } from "../domain/preview";
import {
  addZone,
  bringCard,
  deleteZone,
  focusViewport,
  matchesQuery,
  moveCard,
  moveCardToZone,
  moveZone,
  nudgeCard,
  placeCard,
  pointerDeltaToLogical,
  removeCard,
  renameZone,
  resizeCard,
  restoreCard,
  setCardText,
  setMediaPosition,
  setNextAction,
  setViewport,
} from "../domain/workspaceEdit";
import { useAutosave } from "../hooks/useAutosave";
import { useLayoutMode } from "../hooks/useLayoutMode";
import type { WorkspaceStore } from "../services/storage";
import { FilePreview } from "./FilePreview";
import { LimitedField } from "./LimitedField";
import { BudgetPicker, CapacityBar } from "./RoomCapacity";

type RemovedCard = { card: Card; absolute: { x: number; y: number } | null };

// 방 돌보기. 공유 프로젝트 화면처럼 넘기지 않으면 기울기·상자 없이 기존 화면 그대로입니다.
export type CareProps = {
  record: CareRecord;
  usage: RoomUsage;
  workDays: string[];
  now: number;
  onTouch: (cardIds: string[]) => void;
  onPin: (cardId: string, pinned: boolean) => Promise<void>;
  onSettings: (patch: Partial<CareSettings>) => Promise<void>;
  // 실패하면 사용자에게 보여줄 문구를, 성공하면 null을 돌려줍니다.
  onRestore: (assetId: string) => Promise<string | null>;
};

export function WorkspaceEditor({
  storage,
  projectId,
  projectName,
  demo,
  assets,
  initialWorkspace,
  initialScenes,
  lastPausedSceneId,
  directoryHandle,
  banner,
  readOnly = false,
  eyebrow,
  care,
  onBack,
}: {
  storage: WorkspaceStore;
  projectId: string;
  projectName: string;
  demo: boolean;
  assets: Asset[];
  initialWorkspace: Workspace;
  initialScenes: Scene[];
  lastPausedSceneId: string | null;
  directoryHandle: FileSystemDirectoryHandle | null;
  banner: ReactNode;
  // viewer: 보기(이동·확대·선택)만 되고 저장하거나 바꾸는 UI는 숨깁니다. 서버도 403으로 막습니다.
  readOnly?: boolean;
  eyebrow?: string;
  care?: CareProps;
  onBack: () => void;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [scenes, setScenes] = useState(initialScenes);
  const [pausedSceneId, setPausedSceneId] = useState(lastPausedSceneId);
  const [resumeOpen, setResumeOpen] = useState(Boolean(initialWorkspace.cards.length || initialWorkspace.nextAction || lastPausedSceneId));
  const [scenePanelOpen, setScenePanelOpen] = useState(false);
  const [reviewSceneId, setReviewSceneId] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState<"pause" | "manual" | null>(null);
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureAction, setCaptureAction] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const captureRequest = useRef<string | null>(null);
  const captureDialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [removed, setRemoved] = useState<RemovedCard[]>([]);
  const [panToken, setPanToken] = useState(0);
  const [pane, setPane] = useState<"board" | "files" | "notes">("board");
  const [filesOpen, setFilesOpen] = useState(false);
  const [carePanelOpen, setCarePanelOpen] = useState(false);
  const [careBusy, setCareBusy] = useState<string | null>(null);
  const layout = useLayoutMode();
  const latest = useRef(workspace);
  const scroller = useRef<HTMLDivElement>(null);
  const ignoreScroll = useRef(false);
  const save = useAutosave({ storage, projectId, revision: initialWorkspace.revision });
  latest.current = workspace;

  useEffect(() => {
    if (!captureMode) return;
    const dialog = captureDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [captureMode]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    ignoreScroll.current = true;
    el.scrollLeft = latest.current.viewport.x * latest.current.viewport.scale;
    el.scrollTop = latest.current.viewport.y * latest.current.viewport.scale;
    const frame = window.requestAnimationFrame(() => {
      ignoreScroll.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [panToken, workspace.viewport.scale]);

  function apply(next: Workspace, immediate = false) {
    if (care && !readOnly) {
      const touched = touchedCardIds(latest.current, next);
      if (touched.length > 0) care.onTouch(touched);
    }
    latest.current = next;
    setWorkspace(next);
    if (readOnly) return;
    if (immediate) save.flush(next);
    else save.schedule(next);
  }

  function edit(result: { ok: true; workspace: Workspace } | { ok: false; message: string }, immediate = false) {
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setNotice(null);
    apply(result.workspace, immediate);
  }

  function zoom(delta: number) {
    edit(setViewport(latest.current, { ...latest.current.viewport, scale: latest.current.viewport.scale + delta }));
    setPanToken((value) => value + 1);
  }

  function fitBoard() {
    const el = scroller.current;
    if (!el) return;
    const fit = Math.min(el.clientWidth / limits.workspaceWidth, el.clientHeight / limits.workspaceHeight);
    const scale = Math.min(limits.maxZoom, Math.max(limits.minZoom, fit));
    edit(setViewport(latest.current, { x: 0, y: 0, scale }));
    setPanToken((value) => value + 1);
  }

  function placeAsset(asset: Asset, at = dropPoint()) {
    edit(placeCard(latest.current, { assetId: asset.id, title: asset.displayName, at, size: defaultCardSize(asset.size) }));
    if (layout === "compact") setPane("board");
  }

  function placeMemo() {
    edit(placeCard(latest.current, { assetId: null, title: "메모", at: dropPoint() }));
    if (layout === "compact") setPane("board");
  }

  function dropPoint() {
    const stagger = (latest.current.cards.length % 6) * 28;
    const el = scroller.current;
    const origin = el
      ? { x: el.scrollLeft / latest.current.viewport.scale, y: el.scrollTop / latest.current.viewport.scale }
      : { x: latest.current.viewport.x, y: latest.current.viewport.y };
    return { x: origin.x + 72 + stagger, y: origin.y + 72 + stagger };
  }

  function focusCard(cardId: string) {
    const viewport = focusViewport(latest.current, cardId);
    if (!viewport) return;
    const next = setViewport({ ...latest.current, selectedCardId: cardId }, viewport);
    if (!next.ok) return;
    apply({ ...next.workspace, selectedCardId: cardId });
    setPanToken((value) => value + 1);
    if (layout === "compact") setPane("board");
  }

  function openCapture(mode: "pause" | "manual") {
    captureRequest.current = createId();
    setCaptureMode(mode);
    setCaptureTitle(defaultSceneTitle());
    setCaptureAction(latest.current.nextAction);
    setCaptureError(null);
  }

  function defaultSceneTitle() {
    return `${projectName} · ${new Date().toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`.slice(0, limits.sceneTitle);
  }

  async function capture() {
    if (!captureMode || busyRef.current) return;
    busyRef.current = true;
    setCaptureBusy(true);
    setCaptureError(null);
    const mode = captureMode;
    const pendingWorkspace = { ...latest.current, nextAction: captureAction };
    try {
      const committed = await save.commitNow(latest.current);
      if (!committed.ok) { setCaptureError(committed.message); return; }
      const result = await storage.captureScene({
        projectId, expectedRevision: committed.revision, workspace: pendingWorkspace,
        title: captureTitle.trim() || defaultSceneTitle(), type: mode, requestId: captureRequest.current ?? createId(),
      });
      if (!result.ok) { setCaptureError(result.error.message); return; }
      save.advanceRevision(result.value.workspace.revision);
      latest.current = result.value.workspace;
      setWorkspace(result.value.workspace);
      setScenes((current) => [result.value.scene, ...current.filter((scene) => scene.id !== result.value.scene.id)]);
      if (mode === "pause") setPausedSceneId(result.value.scene.id);
      captureRequest.current = null;
      setCaptureMode(null);
      setNotice(mode === "manual" ? "현재 장면을 남겼습니다." : null);
      if (mode === "pause") onBack();
    } finally {
      busyRef.current = false;
      setCaptureBusy(false);
    }
  }

  async function continueScene(scene: Scene) {
    if (busyRef.current) return;
    busyRef.current = true;
    setCaptureBusy(true);
    setCaptureError(null);
    try {
      const committed = await save.commitNow(latest.current);
      if (!committed.ok) { setCaptureError(committed.message); return; }
      const result = await storage.continueFromScene(projectId, scene.id, committed.revision);
      if (!result.ok) { setCaptureError(result.error.message); return; }
      save.advanceRevision(result.value.workspace.revision);
      latest.current = result.value.workspace;
      setWorkspace(result.value.workspace);
      setScenes((current) => [result.value.safety, ...current]);
      setReviewSceneId(null);
      setScenePanelOpen(false);
      setResumeOpen(true);
      setPanToken((value) => value + 1);
      setNotice("이전 장면에서 이어갑니다. 전환 직전 작업은 안전 장면에 남았습니다.");
    } finally {
      busyRef.current = false;
      setCaptureBusy(false);
    }
  }

  const careRecord = care?.record ?? null;
  const boardCards = workspace.cards.filter((card) => !isBoxedCard(card, careRecord));
  const selected = boardCards.find((card) => card.id === workspace.selectedCardId) ?? null;
  const boxEntries = careRecord ? Object.entries(careRecord.boxed) : [];
  const stageOf = (card: Card) => (care ? cardStage(card, assets.find((asset) => asset.id === card.assetId), care.record, care.workDays, care.now) : { stage: "normal" as const, days: 0 });

  async function restoreBoxed(assetId: string) {
    if (!care || careBusy) return;
    setCareBusy(assetId);
    try {
      const message = await care.onRestore(assetId);
      if (message) {
        setNotice(message);
        return;
      }
      care.onTouch(latest.current.cards.filter((card) => card.assetId === assetId).map((card) => card.id));
      setNotice("제자리로 돌려놓았어요.");
    } finally {
      setCareBusy(null);
    }
  }

  function removeBoxedCards(assetId: string) {
    const cards = latest.current.cards.filter((card) => card.assetId === assetId);
    if (cards.some((card) => card.note.trim()) && !window.confirm("이유 메모가 있는 카드예요. 카드를 빼도 파일은 상자 폴더에 남아요. 뺄까요?")) return;
    let next: Workspace = latest.current;
    for (const card of cards) {
      const result = removeCard(next, card.id);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      next = result.workspace;
    }
    apply(next, true);
  }
  const pausedScene = scenes.find((scene) => scene.id === pausedSceneId) ?? null;
  const resumeCard = workspace.cards.find((card) => card.id === workspace.selectedCardId) ?? null;
  const resumeAsset = assets.find((asset) => asset.id === resumeCard?.assetId) ?? null;
  const reviewed = scenes.find((scene) => scene.id === reviewSceneId) ?? null;
  const showFiles = layout === "wide" || (layout === "overlay" && filesOpen) || (layout === "compact" && pane === "files");
  const showBoard = layout !== "compact" || pane === "board";
  const showNotes = (layout === "wide" && Boolean(selected)) || (layout === "overlay" && Boolean(selected) && !filesOpen) || (layout === "compact" && pane === "notes");
  const visibleAssets = assets.filter((asset) => matchesQuery(query, [asset.displayName, asset.relativePath]));
  const visibleCards = workspace.cards.filter((card) => {
    const asset = assets.find((item) => item.id === card.assetId);
    return matchesQuery(query, [card.title, card.note, asset?.displayName ?? "", asset?.relativePath ?? ""]);
  });

  return (
    <main className={`project-page ${layout}`}>
      <header className="project-bar">
        <button type="button" onClick={onBack}>책상</button>
        <div className="project-title">
          <p className="eyebrow">{eyebrow ?? (demo ? "샘플 체험" : "내 프로젝트")}</p>
          <h1>{projectName}</h1>
        </div>
        {care && <CapacityBar usage={care.usage} budgetBytes={care.record.budgetBytes} />}
        <p className={save.status === "error" ? "save-state error" : "save-state"} role="status">
          {readOnly ? "읽기 전용" : save.status === "saving" ? "저장 중" : save.status === "error" ? "저장 실패" : "저장됨"}
        </p>
        <div className="bar-actions">
          <button type="button" onClick={() => zoom(-0.1)}>축소</button>
          <span>{Math.round(workspace.viewport.scale * 100)}%</span>
          <button type="button" onClick={() => zoom(0.1)}>확대</button>
          <button type="button" onClick={fitBoard}>전체 보기</button>
          {layout === "overlay" && (
            <button type="button" aria-pressed={filesOpen} onClick={() => setFilesOpen((open) => !open)}>{filesOpen ? "자료 닫기" : "자료"}</button>
          )}
          {!readOnly && <button type="button" onClick={placeMemo}>메모 카드</button>}
          {!readOnly && <button type="button" onClick={() => edit(addZone(workspace, "새 영역"))}>영역 추가</button>}
          <button type="button" onClick={() => setResumeOpen((open) => !open)}>재개 요약</button>
          <button type="button" aria-expanded={scenePanelOpen} onClick={() => setScenePanelOpen((open) => !open)}>장면 {scenes.length}</button>
          {care && !readOnly && <button type="button" aria-expanded={carePanelOpen} onClick={() => setCarePanelOpen((open) => !open)}>정리 상자 {boxEntries.length}</button>}
          {!readOnly && <button type="button" onClick={() => openCapture("manual")}>현재 장면 남기기</button>}
          {!readOnly && <button type="button" className="primary" onClick={() => openCapture("pause")}>여기서 멈추기</button>}
        </div>
      </header>
      {layout === "compact" && (
        <div className="pane-tabs" role="tablist" aria-label="작업 화면">
          <button type="button" role="tab" aria-selected={pane === "board"} onClick={() => setPane("board")}>작업면</button>
          <button type="button" role="tab" aria-selected={pane === "files"} onClick={() => setPane("files")}>자료</button>
          <button type="button" role="tab" aria-selected={pane === "notes"} onClick={() => setPane("notes")}>메모</button>
        </div>
      )}
      {banner}
      {resumeOpen && (
        <section className="resume-summary" aria-label="재개 요약">
          <div className="sheet-actions"><h2>이어서 시작</h2><button type="button" onClick={() => setResumeOpen(false)}>요약 닫기</button></div>
          <p className="resume-meta">{pausedScene ? `마지막 중단 ${new Date(pausedScene.createdAt).toLocaleString("ko-KR")}` : "자동 저장된 현재 작업"}{pausedScene && workspace.revision > pausedScene.sourceRevision ? " · 중단 이후 변경 있음" : ""}</p>
          <div className="resume-grid">
            <div><span>마지막 선택</span><strong>{resumeCard?.title || "선택한 카드 없음"}</strong>{resumeCard && isBoxedCard(resumeCard, careRecord) && <small>정리 상자로 옮겨진 카드</small>}{resumeAsset && <small>{directoryHandle ? "현재 폴더 접근 가능" : "파일 접근 확인 필요"}{resumeAsset.availability === "changed" ? " · 변경 신호 있음" : ""}</small>}</div>
            <div><span>고른 이유</span><strong>{resumeCard?.note || "작성한 이유 메모 없음"}</strong></div>
            <div><span>다음 행동</span><strong>{workspace.nextAction || "작성한 다음 행동 없음"}</strong></div>
          </div>
          {resumeCard && <button type="button" onClick={() => { focusCard(resumeCard.id); setResumeOpen(false); }}>마지막 카드로 이동</button>}
        </section>
      )}
      {scenePanelOpen && (
        <section className="scene-panel" aria-label="저장된 장면">
          <div className="sheet-actions"><h2>남긴 장면</h2><button type="button" onClick={() => { setScenePanelOpen(false); setReviewSceneId(null); }}>닫기</button></div>
          {scenes.length === 0 ? <p>아직 남긴 장면이 없습니다.</p> : <ul>
            {scenes.map((scene) => <li key={scene.id}><button type="button" onClick={() => setReviewSceneId(scene.id)}>{scene.title}</button> <span>{scene.type === "pause" ? "중단" : scene.type === "manual" ? "수동" : "안전"} · {new Date(scene.createdAt).toLocaleString("ko-KR")}</span></li>)}
          </ul>}
          {reviewed && <div className="scene-review">
            <h3>{reviewed.title} · 읽기 전용</h3>
            <p>당시 배치와 메모의 기록입니다. 파일 내용은 과거 버전으로 복원되지 않습니다.</p>
            <p><strong>다음 행동:</strong> {reviewed.snapshot.nextAction || "없음"}</p>
            <div className="scene-map" role="img" aria-label={`저장 당시 카드 ${reviewed.snapshot.cards.length}개의 배치` }>
              <div className="scene-map-plane">
                {reviewed.snapshot.zones.map((zone) => <div key={zone.id} className="scene-map-zone" style={{ left: zone.x, top: zone.y, width: zone.width, height: zone.height }}><strong>{zone.title}</strong></div>)}
                {reviewed.snapshot.cards.map((card) => {
                  const origin = absoluteOrigin(card, reviewed.snapshot.zones);
                  return origin ? <div key={card.id} className="scene-map-card" style={{ left: origin.x, top: origin.y, width: card.width, height: card.height, zIndex: card.zIndex }}>{card.title || "제목 없음"}</div> : null;
                })}
              </div>
            </div>
            <ul>{reviewed.snapshot.cards.map((card) => <li key={card.id}><strong>{card.title || "제목 없음"}</strong> · {card.note || "이유 메모 없음"}</li>)}</ul>
            <div className="sheet-actions"><button type="button" onClick={() => setReviewSceneId(null)}>현재 작업으로 돌아가기</button>{!readOnly && <button type="button" className="primary" disabled={captureBusy} onClick={() => void continueScene(reviewed)}>이 장면에서 이어가기</button>}</div>
          </div>}
          {captureError && <p className="error" role="alert">{captureError}</p>}
        </section>
      )}
      {care && carePanelOpen && !readOnly && (
        <section className="care-panel" aria-label="방 돌보기와 정리 상자">
          <div className="sheet-actions"><h2>방 돌보기</h2><button type="button" onClick={() => setCarePanelOpen(false)}>닫기</button></div>
          <div className="care-settings">
            <label><input type="checkbox" checked={care.record.enabled} onChange={(event) => void care.onSettings({ enabled: event.target.checked })} /> 손대지 않은 카드를 기울이고 주간 정리에 넣기</label>
            <label><input type="checkbox" checked={care.record.resting} onChange={(event) => void care.onSettings({ resting: event.target.checked })} /> 쉬는 중 (판정 멈춤)</label>
            <label>기울어짐 <input type="number" min={0} max={365} value={care.record.tiltAfterDays} onChange={(event) => void care.onSettings({ tiltAfterDays: clampDays(event.target.value) })} />일</label>
            <label>쓰러짐 <input type="number" min={0} max={365} value={care.record.fallAfterDays} onChange={(event) => void care.onSettings({ fallAfterDays: clampDays(event.target.value) })} />일</label>
          </div>
          <p className="care-explain">기간은 이 방을 쓴 날이 있었는데 그 카드만 그대로였을 때 셉니다. 방을 아예 열지 않은 기간은 세지 않아요.</p>
          <BudgetPicker totalBytes={care.usage.totalBytes} value={care.record.budgetBytes} onChange={(budgetBytes) => void care.onSettings({ budgetBytes, budgetNoticeAt: null })} />
          <h3>정리 상자 {boxEntries.length}</h3>
          {boxEntries.length === 0 ? <p>상자가 비어 있어요. 주간 정리 때 쉬고 있던 파일이 이곳에 모여요.</p> : <ul className="box-list">
            {boxEntries.map(([assetId, entry]) => {
              const asset = assets.find((item) => item.id === assetId);
              const cards = workspace.cards.filter((card) => card.assetId === assetId);
              const note = firstLine(cards.find((card) => card.note.trim())?.note ?? "");
              return (
                <li key={assetId}>
                  <div>
                    <strong>{asset?.displayName ?? entry.fromPath.split("/").pop()}</strong>
                    <span>{asset ? formatByteSize(asset.size) : "크기 미확인"} · {new Date(entry.at).toLocaleDateString("ko-KR")} 상자에 넣음{cards.length === 0 ? " · 카드 없음" : ""}</span>
                    {note && <span className="sweep-note">“{note}”</span>}
                    <span className="path">{entry.state === "virtual" ? "Folduct 안에서만 정리됨 · 실제 파일은 그대로" : entry.state === "boxed" ? entry.boxPath : "옮기던 중이에요. 폴더 접근을 허용하면 실제 위치를 확인해요."}</span>
                  </div>
                  <div className="sheet-actions">
                    <button type="button" className="primary" disabled={careBusy !== null || entry.state === "moving-in" || entry.state === "moving-out"} onClick={() => void restoreBoxed(assetId)}>{careBusy === assetId ? "옮기는 중" : "제자리로"}</button>
                    {entry.state === "boxed" && <button type="button" onClick={() => void navigator.clipboard?.writeText(entry.boxPath).then(() => setNotice("상자 안 경로를 복사했어요."))}>경로 복사</button>}
                    {cards.length > 0 && <button type="button" onClick={() => removeBoxedCards(assetId)}>카드 빼기</button>}
                  </div>
                </li>
              );
            })}
          </ul>}
          <p className="care-explain">Folduct는 파일을 지우지 않아요. 필요 없으면 Finder에서 ‘{boxFolderName}’ 폴더를 비워 주세요.</p>
        </section>
      )}
      {captureMode && <dialog ref={captureDialog} className="sheet" aria-labelledby="capture-title" onCancel={(event) => { if (captureBusy) event.preventDefault(); else setCaptureMode(null); }}>
        <div className="panel">
          <h2 id="capture-title">{captureMode === "pause" ? "여기서 멈추기" : "현재 장면 남기기"}</h2>
          <p>현재 배치와 이유 메모, 다음 행동을 장면으로 남깁니다.</p>
          <label>장면 이름 <input autoFocus value={captureTitle} maxLength={limits.sceneTitle} onChange={(event) => setCaptureTitle(event.target.value)} /></label>
          <label>다음 행동 <textarea value={captureAction} maxLength={limits.nextAction} onChange={(event) => setCaptureAction(event.target.value)} /></label>
          {captureError && <p className="error" role="alert">{captureError}</p>}
          <div className="sheet-actions"><button type="button" disabled={captureBusy} onClick={() => setCaptureMode(null)}>취소</button><button type="button" className="primary" disabled={captureBusy} onClick={() => void capture()}>{captureBusy ? "저장 중" : "장면 저장"}</button></div>
        </div>
      </dialog>}
      {save.error && <p className="error" role="alert">저장하지 못했습니다. {save.error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {(layout !== "compact" || pane === "notes") && (
        <div className="next-action">
          {readOnly ? <p><strong>다음 행동</strong> {workspace.nextAction || "없음"}</p> : <LimitedField
            label="다음 행동"
            value={workspace.nextAction}
            max={limits.nextAction}
            onCommit={(value) => edit(setNextAction(latest.current, value))}
          />}
        </div>
      )}
      <div className={layout === "wide" && selected ? "workspace-shell with-inspector" : "workspace-shell"}>
        {showFiles && <aside className="asset-rail">
          {layout === "overlay" && (
            <div className="sheet-actions">
              <h2>자료</h2>
              <button type="button" onClick={() => setFilesOpen(false)}>닫기</button>
            </div>
          )}
          <label>
            검색
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일, 경로, 메모" />
          </label>
          {query && visibleAssets.length === 0 && visibleCards.length === 0 && (
            <p>‘{query}’와 맞는 파일이나 카드가 없습니다. <button type="button" onClick={() => setQuery("")}>검색 지우기</button></p>
          )}
          <h2>파일 {visibleAssets.length}</h2>
          <ul className="file-list">
            {visibleAssets.map((asset) => (
              <li key={asset.id} draggable={!readOnly} onDragStart={(event) => {
                event.dataTransfer.setData("application/x-folduct-asset", asset.id);
                event.dataTransfer.setData("text/plain", asset.displayName);
              }}>
                <span>{asset.displayName}{(isInBox(asset.relativePath) || careRecord?.boxed[asset.id]) && <em className="box-tag"> 정리 상자</em>}</span>
                <span>{asset.relativePath}</span>
                {!readOnly && <button type="button" onClick={() => placeAsset(asset)}>작업면에 놓기</button>}
              </li>
            ))}
          </ul>
          {query && (
            <>
              <h2>카드 {visibleCards.length}</h2>
              <ul className="file-list">
                {visibleCards.map((card) => (
                  <li key={card.id}>
                    <span>{card.title || "제목 없음"}</span>
                    <span>{card.note}</span>
                    <button type="button" onClick={() => focusCard(card.id)}>카드로 이동</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>}
        {showBoard && <div
          className="board-scroll"
          ref={scroller}
          onScroll={(event) => {
            if (ignoreScroll.current) return;
            const el = event.currentTarget;
            const next = setViewport(latest.current, {
              ...latest.current.viewport,
              x: el.scrollLeft / latest.current.viewport.scale,
              y: el.scrollTop / latest.current.viewport.scale,
            });
            if (next.ok) apply(next.workspace);
          }}
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer.types).includes("application/x-folduct-asset")) event.preventDefault();
          }}
          onDrop={(event) => {
            const assetId = event.dataTransfer.getData("application/x-folduct-asset");
            const asset = assets.find((item) => item.id === assetId);
            const rect = event.currentTarget.getBoundingClientRect();
            if (!asset) return;
            event.preventDefault();
            const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            const logical = {
              x: latest.current.viewport.x + screen.x / latest.current.viewport.scale,
              y: latest.current.viewport.y + screen.y / latest.current.viewport.scale,
            };
            placeAsset(asset, logical);
          }}
        >
          <div
            className="board-surface"
            style={{ width: limits.workspaceWidth * workspace.viewport.scale, height: limits.workspaceHeight * workspace.viewport.scale }}
          >
            <div className="board-plane" style={{ width: limits.workspaceWidth, height: limits.workspaceHeight, transform: `scale(${workspace.viewport.scale})` }}>
              {workspace.zones.map((zone) => (
                <ZoneView
                  key={zone.id}
                  zone={zone}
                  readOnly={readOnly}
                  onRename={(title) => edit(renameZone(latest.current, zone.id, title))}
                  onMove={(dx, dy, immediate) => {
                    const delta = pointerDeltaToLogical(dx, dy, latest.current.viewport.scale);
                    edit(moveZone(latest.current, zone.id, delta.x, delta.y), immediate);
                  }}
                  onDelete={() => edit(deleteZone(latest.current, zone.id), true)}
                />
              ))}
              {[...boardCards].sort((a, b) => a.zIndex - b.zIndex).map((card) => {
                const origin = absoluteOrigin(card, workspace.zones);
                if (!origin) return null;
                const condition = stageOf(card);
                const cardAsset = card.assetId ? assets.find((asset) => asset.id === card.assetId) : undefined;
                return (
                  <article
                    key={card.id}
                    className={`work-card${card.id === workspace.selectedCardId ? " selected" : ""}${condition.stage === "normal" ? "" : ` care-${condition.stage}`}`}
                    style={{ left: origin.x, top: origin.y, width: card.width, height: card.height, zIndex: card.zIndex }}
                    tabIndex={0}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      if ((event.target as HTMLElement).closest("button")) return;
                      event.currentTarget.focus();
                      if (readOnly) return;
                      const start = { x: event.clientX, y: event.clientY, origin };
                      const move = (pointer: PointerEvent) => {
                        const delta = pointerDeltaToLogical(pointer.clientX - start.x, pointer.clientY - start.y, latest.current.viewport.scale);
                        edit(moveCard(latest.current, card.id, { x: start.origin.x + delta.x, y: start.origin.y + delta.y }));
                      };
                      const up = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                        save.flush(latest.current);
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", up);
                    }}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 32 : 8;
                      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
                      if (!delta || readOnly) return;
                      event.preventDefault();
                      edit(nudgeCard(latest.current, card.id, delta[0], delta[1]), true);
                    }}
                    onClick={() => apply({ ...latest.current, selectedCardId: card.id })}
                  >
                    <h3>{card.title || "제목 없음"}</h3>
                    {cardAsset && <p className="card-size"><span className="size-icon" style={{ width: 14 * iconScale(cardAsset.size), height: 18 * iconScale(cardAsset.size) }} aria-hidden="true" />{formatByteSize(cardAsset.size)}</p>}
                    <p>{card.note || "이유 메모 없음"}</p>
                    {condition.stage !== "normal" && <p className="care-label">{condition.days}일째 그대로{condition.stage === "fallen" ? " · 다음 정리 때 상자로" : ""}</p>}
                    {!readOnly && <button
                      type="button"
                      className="resize-handle"
                      aria-label="카드 크기 조절"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        const start = { x: event.clientX, y: event.clientY, width: card.width, height: card.height };
                        const move = (pointer: PointerEvent) => {
                          const delta = pointerDeltaToLogical(pointer.clientX - start.x, pointer.clientY - start.y, latest.current.viewport.scale);
                          edit(resizeCard(latest.current, card.id, { width: start.width + delta.x, height: start.height + delta.y }));
                        };
                        const up = () => {
                          window.removeEventListener("pointermove", move);
                          window.removeEventListener("pointerup", up);
                          save.flush(latest.current);
                        };
                        window.addEventListener("pointermove", move);
                        window.addEventListener("pointerup", up);
                      }}
                    />}
                  </article>
                );
              })}
            </div>
          </div>
        </div>}
        {showNotes && (
          <aside className="inspector">
            <div className="sheet-actions">
              <h2>메모</h2>
              <button type="button" onClick={() => { apply({ ...latest.current, selectedCardId: null }); if (layout === "compact") setPane("board"); }}>닫기</button>
            </div>
            {!selected && <p>작업면에서 카드를 고르면 이유 메모가 열립니다.</p>}
            {selected && <>
            <p>{selected.assetId ? assets.find((asset) => asset.id === selected.assetId)?.relativePath ?? "연결된 파일을 찾지 못했습니다" : "파일 없는 메모"}</p>
            {care && !readOnly && <CareLine card={selected} asset={assets.find((asset) => asset.id === selected.assetId)} care={care} days={stageOf(selected).days} />}
            <FilePreview
              key={selected.assetId ?? `memo:${selected.id}`}
              projectId={projectId}
              target={previewTarget(selected, assets)}
              directoryHandle={directoryHandle}
              savedSeconds={selected.assetId ? workspace.mediaPositions.find((item) => item.assetId === selected.assetId)?.seconds ?? null : null}
              onMediaPosition={(assetId, seconds) => edit(setMediaPosition(latest.current, assetId, seconds), true)}
            />
            {readOnly ? <><h3>{selected.title || "제목 없음"}</h3><p>{selected.note || "이유 메모 없음"}</p></> : <>
            <LimitedField key={`${selected.id}:title`} label="제목" value={selected.title} max={limits.cardTitle} onCommit={(value) => edit(setCardText(latest.current, selected.id, { title: value }))} />
            <LimitedField key={`${selected.id}:note`} label="이유 메모" value={selected.note} max={limits.note} multiline onCommit={(value) => edit(setCardText(latest.current, selected.id, { note: value }))} />
            <label>
              영역으로 이동
              <select
                value={selected.zoneId ?? ""}
                onChange={(event) => edit(moveCardToZone(latest.current, selected.id, event.target.value || null), true)}
              >
                <option value="">작업면</option>
                {workspace.zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>{zone.title}</option>
                ))}
              </select>
            </label>
            <div className="sheet-actions">
              <button type="button" onClick={() => edit(bringCard(latest.current, selected.id, "front"), true)}>앞으로</button>
              <button type="button" onClick={() => edit(bringCard(latest.current, selected.id, "back"), true)}>뒤로</button>
            </div>
            <button
              type="button"
              onClick={() => {
                const origin = absoluteOrigin(selected, latest.current.zones);
                const result = removeCard(latest.current, selected.id);
                if (!result.ok) {
                  setNotice(result.message);
                  return;
                }
                setRemoved((stack) => [...stack, { card: selected, absolute: origin }]);
                edit(result, true);
              }}
            >
              작업면에서 빼기
            </button>
            <p>원본 파일은 지워지지 않습니다. 이 화면을 닫기 전에는 되돌릴 수 있습니다.</p>
            </>}
            </>}
          </aside>
        )}
      </div>
      {layout === "compact" && selected && pane === "board" && (
        <button type="button" className="selection-bar" onClick={() => setPane("notes")}>{selected.title || "제목 없음"} 메모 열기</button>
      )}
      {removed.length > 0 && !readOnly && (
        <button
          type="button"
          className="undo-card"
          onClick={() => {
            const last = removed[removed.length - 1];
            const result = restoreCard(latest.current, last.card, last.absolute);
            if (!result.ok) {
              setNotice(result.message);
              return;
            }
            setRemoved((stack) => stack.slice(0, -1));
            edit(result, true);
          }}
        >
          빼낸 카드 되돌리기
        </button>
      )}
    </main>
  );
}

function CareLine({ card, asset, care, days }: { card: Card; asset: Asset | undefined; care: CareProps; days: number }) {
  const pinned = care.record.pinned.includes(card.id);
  const sourceDays = asset ? Math.max(0, Math.floor((care.now - asset.lastModified) / (24 * 60 * 60 * 1000))) : null;
  return (
    <div className="care-line">
      <p>Folduct에서 {days === 0 ? "오늘 손댐" : `${days}일째 그대로`}{sourceDays !== null ? ` · 원본은 ${sourceDays === 0 ? "오늘" : `${sourceDays}일 전`} 수정됨` : ""}</p>
      <button type="button" aria-pressed={pinned} onClick={() => void care.onPin(card.id, !pinned)}>{pinned ? "고정 풀기" : "고정 (쓰러지지 않음)"}</button>
    </div>
  );
}

function clampDays(value: string): number {
  const days = Math.round(Number(value));
  return Number.isFinite(days) ? Math.min(365, Math.max(0, days)) : 0;
}

function previewTarget(card: Card, assets: Asset[]) {
  if (!card.assetId) return { kind: "memo" as const };
  const asset = assets.find((item) => item.id === card.assetId);
  if (!asset) return { kind: "missing" as const };
  return { kind: "file" as const, asset };
}

function ZoneView({
  zone,
  readOnly,
  onRename,
  onMove,
  onDelete,
}: {
  zone: Zone;
  readOnly: boolean;
  onRename: (title: string) => void;
  onMove: (dx: number, dy: number, immediate: boolean) => void;
  onDelete: () => void;
}) {
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <section className="zone" style={{ left: zone.x, top: zone.y, width: zone.width, height: zone.height }}>
      {readOnly ? <header><strong>{zone.title}</strong></header> : <header
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button, input, textarea")) return;
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
          const move = (pointer: PointerEvent) => {
            if (!drag.current) return;
            onMove(pointer.clientX - drag.current.x, pointer.clientY - drag.current.y, false);
            drag.current = { x: pointer.clientX, y: pointer.clientY, moved: true };
          };
          const up = () => {
            const moved = drag.current?.moved ?? false;
            drag.current = null;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (moved) onMove(0, 0, true);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <LimitedField label="영역 이름" value={zone.title} max={limits.zoneTitle} onCommit={onRename} />
        <button type="button" onClick={onDelete}>영역 지우기</button>
      </header>}
    </section>
  );
}
