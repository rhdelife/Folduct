import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { Capacity } from "../components/Capacity";
import { FacePicker } from "../components/RoomFace";
import { FileViewer, previewLimit, previewMode, writeClipboard, type ViewerState } from "../components/FileViewer";
import { BrandMark, Icon } from "../components/Icon";
import { KindLegend, SizeKey } from "../components/KindLegend";
import { RoomScene } from "../components/RoomScene";
import { useToast } from "../components/Toast";
import { boxFolderName, firstLine, isInBox, lastActivity, markWorkDay, mergeScan, relativeDay, roomUsage, scanOverlap, thingAge } from "../domain/care";
import { clampSpot, freeSpot } from "../domain/plane";
import { formatBytes, kindLabels, type CareSettings, type Room, type Spot, type Thing } from "../domain/model";
import { fileManagerName, permissionHint, shortPath } from "../domain/platform";
import { canPickFolder, folderProblem, pickFolder, scanLimits, type Access } from "../gateways/folder";
import { askFolder, doorChanged, folderAccess, isNative, openInApp, pickRoomFolder, readFolderFile, revealInFinder, scanRoomFolder, type Folder } from "../gateways/native";
import { reconcileBox, restoreFromBox, roomFolder } from "../storage/box";
import { forgetRoom, getRoom, saveHandle, saveRoom } from "../storage/db";

const panels = ["thing", "shelf", "box", "settings"] as const;
type Panel = (typeof panels)[number];

// 데스크톱 보기 창은 파일을 통째로 메모리에 읽습니다. 이보다 크면 기본 앱으로 엽니다.
// 서랍의 이미지 미리보기도 통째로 읽으므로 더 작게 잡습니다.
const imageLimit = 30 * 1024 ** 2;
const folderIssues = {
  denied: "폴더 접근 권한이 없어요. 목록은 그대로예요.",
  gone: "폴더를 찾지 못했어요. 옮겼거나 드라이브가 빠졌는지 확인해 주세요. 목록은 그대로예요.",
  other: "폴더를 읽지 못했어요. 목록은 그대로예요.",
};
// 창이 좁아 서랍이 무대 아래로 쌓이는 폭(styles.css와 같은 값)
const stacked = "(max-width: 719.98px)";

// 누른 버튼이 사라질 때는 다음 그림이 그려진 뒤 이어서 볼 곳으로 포커스를 옮깁니다.
function focusSoon(selector: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
}
const thingSelector = (id: string) => `[data-thing-id="${id}"]`;

export function RoomPage({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [handle, setHandle] = useState<Folder | null>(null);
  const [access, setAccess] = useState<Access | "none">("none");
  const [folderIssue, setFolderIssue] = useState<keyof typeof folderIssues | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("shelf");
  // 지금 하고 있는 일(폴더 읽기, 옮기기)을 글자로 보여 줍니다. null이면 쉬는 중.
  const [busy, setBusy] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ thingId: string; state: ViewerState } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { toast, toastRegion } = useToast();
  const latest = useRef<Room | null>(null);
  const dirty = useRef(false);
  // 방을 지우는 중이거나 지운 뒤에는 저장하지 않습니다. 늦게 끝난 동기화가 지운 방을 되살리지 않게요.
  const forgetting = useRef(false);
  // 파일 열기 요청 번호. 창을 닫거나 다른 파일을 열면 늘어나서, 늦게 끝난 읽기는 버립니다.
  const viewerReq = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const side = useRef<HTMLElement>(null);

  // 고칠 때마다 상태를 바꾸고, 0.3초 뒤에 한 번에 저장합니다. 방을 떠나거나 창을 가릴 때도 남은 것을 저장합니다.
  // 저장이 실패하면 다시 '고칠 것 있음'으로 두고 배너로 알립니다. 화면의 내용은 그대로라 다시 저장할 수 있어요.
  function flush() {
    const snap = latest.current;
    if (forgetting.current || !dirty.current || !snap) return;
    dirty.current = false;
    saveRoom(snap).then(
      () => setSaveError(false),
      () => {
        dirty.current = true;
        setSaveError(true);
      },
    );
  }
  useEffect(() => {
    latest.current = room;
    if (!dirty.current) return;
    const timer = window.setTimeout(flush, 300);
    return () => window.clearTimeout(timer);
  }, [room]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      window.clearInterval(tick);
      flush();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await getRoom(roomId);
        if (cancelled) return;
        if (!found) {
          setMissing(true);
          return;
        }
        const foundHandle = await roomFolder(found);
        const state = foundHandle ? await folderAccess(foundHandle) : "none";
        if (cancelled) return;
        setHandle(foundHandle);
        setAccess(state);
        setRoom(found);
        // 방을 먼저 보여 주고, 상자 기록과 목록은 뒤에서 맞춥니다. 기다리지 않아요.
        if (foundHandle && state === "granted" && !cancelled) {
          latest.current = found;
          void syncFolder(foundHandle, true, () => cancelled);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, attempt]);

  // 방을 열어 둔 채 플로팅 창으로 파일을 넣거나 되돌리면 저장된 목록을 바로 가져옵니다. 들고 있는 고침부터 저장해 덮어쓰지 않아요.
  useEffect(() => {
    if (!isNative()) return;
    let left = false;
    let stop: (() => void) | undefined;
    void listen(doorChanged, () => {
      flush();
      getRoom(roomId).then(
        (saved) => {
          if (saved && !left) update((current) => ({ ...current, things: saved.things, scan: saved.scan }));
        },
        (error: unknown) => console.error(error),
      );
    }).then((unlisten) => {
      if (left) unlisten();
      else stop = unlisten;
    });
    return () => {
      left = true;
      stop?.();
    };
  }, [roomId]);

  // 방에 들어오면 제목으로 포커스를 옮겨, 화면 읽기 프로그램이 어느 방인지 읽게 합니다.
  useEffect(() => {
    heading.current?.focus();
  }, [room?.id]);
  useEffect(() => {
    if (room) document.title = `${room.name} · Folduct`;
  }, [room?.name]);

  // touch: 손댄 물건. 손댄 시각과 '방을 쓴 날'을 함께 남깁니다.
  function update(change: (room: Room) => Room, touch: string[] = []) {
    const at = Date.now();
    dirty.current = true;
    setRoom((current) => {
      if (!current) return current;
      const next = change(current);
      if (touch.length === 0) return next;
      return { ...next, workDays: markWorkDay(next.workDays, at), things: next.things.map((thing) => (touch.includes(thing.id) ? { ...thing, touchedAt: at } : thing)) };
    });
  }

  function patchThing(id: string, patch: Partial<Thing>, touch = true) {
    update((current) => ({ ...current, things: current.things.map((thing) => (thing.id === id ? { ...thing, ...patch } : thing)) }), touch ? [id] : []);
  }

  // reconcileBox가 맞춘 상자 기록(상자·경로·파일 없음)만 지금 상태로 가져옵니다. 기다리는 동안 쓴 메모·자리는 그대로 둡니다.
  function adoptBox(saved: Room) {
    const byId = new Map(saved.things.map((thing) => [thing.id, thing]));
    update((current) => ({
      ...current,
      things: current.things.map((thing) => {
        const found = byId.get(thing.id);
        const moving = thing.box?.state === "moving-in" || thing.box?.state === "moving-out";
        return found && moving ? { ...thing, box: found.box, path: found.path, missing: found.missing } : thing;
      }),
    }));
  }

  async function copy(path: string) {
    const ok = await writeClipboard(path);
    toast(ok ? "경로를 복사했어요." : `${navigator.clipboard ? "복사하지 못했어요" : "복사할 수 없는 환경이에요"}. 경로: ${path}`);
    return ok;
  }

  async function allowFolder() {
    if (!handle || !latest.current) return;
    const granted = await askFolder(handle);
    setAccess(granted ? "granted" : "denied");
    if (!granted) return toast("폴더 접근이 허용되지 않았어요. 방 배치는 그대로예요.");
    await syncFolder(handle, true);
  }

  // 실제 폴더에 목록을 맞춥니다. silent면 성공 알림을 띄우지 않아요. 손댄 것으로 세지 않습니다.
  // left: 기다리는 사이 방을 떠났는지. 떠났으면 늦게 온 결과는 버립니다.
  async function syncFolder(folder: Folder, silent: boolean, left = () => false) {
    setBusy("폴더를 다시 보는 중…");
    try {
      flush();
      // 옮기던 중 멈춘 상자 기록부터 실제 위치에 맞춘 뒤 목록을 합칩니다.
      if (latest.current) {
        const settled = await reconcileBox(latest.current, folder);
        if (left()) return;
        adoptBox(settled);
      }
      const scan = await scanRoomFolder(folder);
      if (left()) return;
      update((current) => mergeScan(current, scan.files, scan, Date.now()));
      setFolderIssue(null);
      if (!silent) toast(`폴더를 다시 봤어요. 파일 ${scan.files.length.toLocaleString("ko-KR")}개.`);
    } catch (error) {
      if (left()) return;
      const problem = folderProblem(error);
      setFolderIssue(problem);
      if (!silent && problem === "other") toast("폴더를 읽지 못했어요. 잠시 뒤 다시 해 주세요. 목록은 그대로예요.");
    } finally {
      if (!left()) setBusy(null);
    }
  }

  async function rescan() {
    if (!handle || !latest.current) return;
    // 상태에 남은 값 대신 지금 권한을 봅니다. 그사이 풀렸으면 '다시 시도'가 이 클릭에서 다시 물어요.
    if ((await folderAccess(handle)) !== "granted" && !(await askFolder(handle))) return toast("폴더 접근이 있어야 다시 볼 수 있어요.");
    setAccess("granted");
    await syncFolder(handle, false);
  }

  // 가져오기나 폴더 입력으로 만든 보기 전용 방에 실제 폴더를 이어 줍니다. 메모와 자리는 그대로 두고 목록만 다시 봅니다.
  // 알림은 부른 쪽이 보여 줍니다(보기 창 안이면 창 안에서). 그만두면 null.
  async function connectFolder(): Promise<{ folder: Folder } | { error: string } | null> {
    const current = latest.current;
    if (!current) return null;
    let picked: Folder | null;
    try {
      picked = isNative() ? await pickRoomFolder(current.origin) : await pickFolder();
    } catch {
      return { error: "폴더를 열지 못했어요. 다른 폴더를 골라 주세요." };
    }
    if (!picked) return null;
    const folder = picked;
    setBusy("폴더를 읽는 중…");
    try {
      flush();
      const scan = await scanRoomFolder(folder);
      // 이름 대신 내용으로 맞는 폴더인지 봅니다. 다 읽지 못한 스캔은 못 본 파일을 ‘파일 없음’으로 바꾸지 않으니 묻지 않아요.
      const { kept, total } = scanOverlap(latest.current ?? current, scan.files);
      // 데스크톱에서는 window.confirm이 Promise를 돌려줘서 await로 기다립니다(브라우저에서는 그대로 true/false).
      if (scan.complete && scan.failed === 0 && kept < total * 0.8 && !(await window.confirm(`이 방 파일 ${total}개 중 ${kept}개만 고른 폴더에 있어요. 연결하면 ${total - kept}개가 ‘파일 없음’으로 바뀌어요(메모·자리는 남아요).`))) return null;
      if (typeof folder !== "string") await saveHandle(current.id, folder);
      update((latestRoom) => ({ ...mergeScan(latestRoom, scan.files, scan, Date.now()), source: "handle", ...(typeof folder === "string" ? { origin: folder } : {}) }));
      setHandle(folder);
      setAccess("granted");
      setFolderIssue(null);
      return { folder };
    } catch {
      return { error: "폴더를 읽지 못했어요. 다른 폴더를 골라 주세요." };
    } finally {
      setBusy(null);
    }
  }

  async function connectFromPage() {
    const result = await connectFolder();
    if (result) toast("error" in result ? result.error : "폴더를 연결했어요. 이제 파일 열기, 다시 보기, 정리 상자 이동을 할 수 있어요.");
  }

  // 파일 안으로 들어가기. 폴더가 없으면 연결부터, 권한이 없으면 같은 클릭 안에서 묻습니다(읽기 권한만).
  async function openFile(thingId: string, folder: Folder | null = handle) {
    const req = ++viewerReq.current;
    const stale = () => viewerReq.current !== req;
    const current = latest.current;
    const thing = current?.things.find((item) => item.id === thingId);
    if (!current || !thing) return;
    if (current.source === "sample") return setViewer({ thingId, state: { status: "sample" } });
    if (!folder) return setViewer({ thingId, state: { status: "need-folder" } });
    if (typeof folder === "string" && (previewMode(thing) === "none" || thing.size > previewLimit)) {
      setViewer(null);
      const error = await openApp(thingId, folder);
      if (error) toast(error);
      return;
    }
    setViewer({ thingId, state: { status: "loading" } });
    // 기다리는 사이 창을 닫았거나 다른 파일을 열었으면 늦게 온 결과는 버립니다(손댄 것으로도 세지 않아요).
    try {
      const allowed = (await folderAccess(folder)) === "granted" || (await askFolder(folder));
      if (stale()) return;
      if (!allowed) {
        setAccess("denied");
        return setViewer({ thingId, state: { status: "denied" } });
      }
      setAccess("granted");
      const file = await readFolderFile(folder, thing.path);
      if (stale()) return;
      setViewer({ thingId, state: { status: "ready", file } });
      // 미리보기를 연 것도 손댄 것으로 셉니다.
      patchThing(thingId, {});
    } catch (error) {
      if (stale()) return;
      const missing = error instanceof DOMException && (error.name === "NotFoundError" || error.name === "TypeMismatchError");
      setViewer({ thingId, state: { status: "error", message: missing ? "폴더에서 이 파일을 찾지 못했어요. 옮겨졌거나 지워졌다면 ‘폴더 다시 보기’로 목록을 맞춰 주세요." : "파일을 열지 못했어요. 다른 앱이 쓰고 있거나 권한이 바뀌었을 수 있어요." } });
    }
  }

  function closeViewer() {
    viewerReq.current += 1;
    setViewer(null);
  }

  // 데스크톱: OS 기본 앱으로 열거나 파일 관리자에서 보여줍니다. 연 것은 손댄 것으로 셉니다. 실패하면 이유를 돌려줍니다.
  async function openApp(thingId: string, folder: string, reveal = false): Promise<string | null> {
    const thing = latest.current?.things.find((item) => item.id === thingId);
    if (!thing) return null;
    try {
      await (reveal ? revealInFinder : openInApp)(folder, thing.path);
      if (!reveal) patchThing(thingId, {});
      return null;
    } catch (error) {
      return `파일을 열지 못했어요. 옮겨졌거나 지워졌다면 ‘폴더 다시 보기’로 목록을 맞춰 주세요. (${String(error)})`;
    }
  }

  async function restore(id: string) {
    if (!latest.current) return;
    flush();
    setBusy("제자리로 옮기는 중…");
    try {
      const result = await restoreFromBox(latest.current, handle, id);
      if (result.error) return toast(result.error);
      // 기다리는 동안 쓴 메모·자리를 지우지 않게, 바뀐 칸만 지금 상태에 덧씌웁니다.
      update((current) => ({ ...current, things: current.things.map((thing) => (thing.id === id ? { ...thing, ...result.patch, spot: thing.spot ?? freeSpot(current.things, 3) } : thing)) }), [id]);
      toast("제자리로 돌려놓았어요.");
      focusSoon("#room-drawer h2");
    } catch {
      toast("제자리로 옮기지 못했어요. 잠시 뒤 다시 해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  // 선반의 물건을 빈자리에 놓습니다. 여러 개면 하나씩 빈자리를 찾아 겹치지 않게 놓아요.
  function place(ids: string[]) {
    update((current) => {
      let things = current.things;
      ids.forEach((id, index) => {
        const spot = freeSpot(things, things.length + index);
        things = things.map((thing) => (thing.id === id ? { ...thing, spot } : thing));
      });
      return { ...current, things };
    }, ids);
  }

  function shelve(thing: Thing) {
    const spot = thing.spot;
    patchThing(thing.id, { spot: null }, false);
    focusSoon("#room-drawer h2");
    toast("선반에 올려두었어요.", {
      label: "되돌리기",
      run: () => {
        patchThing(thing.id, { spot }, false);
        setSelectedId(thing.id);
        setPanel("thing");
        focusSoon(thingSelector(thing.id));
      },
    });
  }

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    const at = panels.indexOf(panel);
    const to = ({ ArrowRight: at + 1, ArrowLeft: at - 1 + panels.length, Home: 0, End: panels.length - 1 } as Record<string, number | undefined>)[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = panels[to % panels.length];
    setPanel(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  if (missing) {
    return (
      <main className="page-status">
        <h1>방을 찾지 못했어요</h1>
        <p>{isNative() ? "Folduct에 저장된 방이 아니에요." : "이 브라우저에 저장된 방이 아니에요."}</p>
        <button type="button" className="primary" onClick={onBack}>집으로</button>
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="page-status">
        <h1>방을 불러오지 못했어요</h1>
        <p>저장된 방 기록을 읽는 중에 문제가 생겼어요. 기록은 지우지 않았어요.</p>
        <div className="row">
          <button type="button" className="primary" onClick={() => { setLoadError(false); setAttempt((count) => count + 1); }}>다시 시도</button>
          <button type="button" onClick={onBack}>집으로</button>
        </div>
      </main>
    );
  }
  if (!room) return <main><p className="loading" role="status">방을 불러오는 중…</p></main>;

  const usage = roomUsage(room);
  const selected = room.things.find((thing) => thing.id === selectedId && thing.spot && !thing.box) ?? null;
  const shelfCount = room.things.filter((thing) => !thing.spot && !thing.box).length;
  const boxed = room.things.filter((thing) => thing.box);
  const tabLabels: Record<Panel, string> = { thing: "물건", shelf: `선반 ${shelfCount}`, box: `정리 상자 ${boxed.length}`, settings: "방 설정" };

  return (
    <main className="room-page">
      <header className="topnav">
        <button type="button" className="quiet home-link" onClick={() => { flush(); onBack(); }}>
          <BrandMark size={32} />
          <span aria-hidden="true">←</span>
          돌아가기
        </button>
        <div className="topnav-title">
          <h1 ref={heading} tabIndex={-1}>{room.name}</h1>
          <p className="eyebrow">{room.source === "sample" ? "샘플 방" : room.source === "input" ? `${room.rootName} · 보기 전용` : `${room.rootName} 폴더`}{room.care.done ? " · 완료" : ""}</p>
        </div>
        <div className="row">
          <div aria-live="polite">{busy && <span className="scanning">{busy}</span>}</div>
          {room.source === "handle" && <button type="button" onClick={() => void rescan()} disabled={busy !== null}>폴더 다시 보기</button>}
        </div>
      </header>

      <div className="banners">
        {saveError && (
          <p className="banner danger" role="alert">변경 내용을 저장하지 못했어요. 화면의 내용은 그대로예요. <button type="button" onClick={flush}>다시 저장</button></p>
        )}
        {folderIssue && (
          <p className="banner danger" role="alert">
            {folderIssues[folderIssue]}{folderIssue === "denied" && isNative() && ` ${permissionHint()}`}{" "}
            <button type="button" onClick={() => void rescan()} disabled={busy !== null}>다시 시도</button>
            {(canPickFolder() || isNative()) && <button type="button" onClick={() => void connectFromPage()} disabled={busy !== null}>폴더 다시 고르기</button>}
          </p>
        )}
        {room.source === "sample" && <p className="banner soft-banner">샘플 방이에요. 실제 파일은 없고, 옮기기·정리는 Folduct 안에서만 일어나요.</p>}
        {handle && access !== "granted" && (
          <p className="banner soft-banner">
            폴더 접근을 허용하면 상자 정리와 다시 보기를 할 수 있어요. <button type="button" className="primary" onClick={() => void allowFolder()}>폴더 접근 허용</button>
            {/* 한 번 거절되면 다시 물어도 창이 뜨지 않을 수 있어요. 폴더를 새로 고르면 늘 다시 열 수 있습니다. */}
            {access === "denied" && canPickFolder() && <button type="button" onClick={() => void connectFromPage()} disabled={busy !== null}>폴더 다시 고르기</button>}
          </p>
        )}
        {room.care.done && (
          <p className="banner happy-banner">
            홈에서 뺀 방이에요. 주간 정리가 쉬어요.{" "}
            <button type="button" onClick={() => { update((current) => ({ ...current, care: { ...current.care, done: false } })); heading.current?.focus(); }}>홈에 올리기</button>
          </p>
        )}
        {room.source === "input" && (
          <p className="banner soft-banner">
            {room.origin ? `가져온 목록으로 만든 보기 전용 방이에요(${shortPath(room.origin)}).` : "이 방은 브라우저가 폴더를 기억하지 못하는 방식으로 연결됐어요."} 폴더를 연결하면 다시 보기와 정리 상자 이동을 할 수 있어요. 그 전에는 정리 상자가 Folduct 안에서만 쓰여요.
            {(canPickFolder() || isNative()) && <button type="button" className="primary" onClick={() => void connectFromPage()} disabled={busy !== null}>폴더 연결</button>}
          </p>
        )}
        {!usage.exact && <p className="banner soft-banner">폴더를 다 읽지 못했어요(파일 {scanLimits.files.toLocaleString("ko-KR")}개·폴더 {scanLimits.depth}단계까지만 읽거나, 읽지 못한 항목이 있어요). 못 본 파일은 ‘파일 없음’으로 바꾸지 않고, 용량은 확인한 만큼만 보여 줘요.</p>}
        {room.scan.freedBytes > 0 && <p className="banner happy-banner">지난 확인보다 {formatBytes(room.scan.freedBytes)} 비웠어요. 방이 한결 넓어졌어요.</p>}
      </div>

      <div className="room-body">
        <section className="room-stage-wrap" aria-label={`${room.name} 방. 물건을 끌거나 화살표 키로 옮길 수 있어요.`}>
          <div className="room-capacity">
            <Capacity usage={usage} />
          </div>
          <RoomScene
            room={room}
            now={now}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelectedId(id);
              setPanel("thing");
              // 서랍이 무대 아래로 쌓인 좁은 창에서는 고른 결과가 보이게 서랍을 끌어올립니다.
              if (window.matchMedia(stacked).matches) side.current?.scrollIntoView({ block: "nearest" });
            }}
            onOpen={(id) => void openFile(id)}
            onMove={(id, spot: Spot, commit) => patchThing(id, { spot }, commit)}
            onOpenBox={() => setPanel("box")}
            onOpenShelf={() => setPanel("shelf")}
          />
          <div className="legend-strip">
            <KindLegend kinds={room.things.filter((thing) => thing.spot && !thing.box).map((thing) => thing.kind)} />
            <SizeKey />
          </div>
        </section>

        <aside className="side" ref={side}>
          <div className="tabs" role="tablist" aria-label="방 서랍" onKeyDown={moveTab}>
            {panels.map((key, at) => (
              // 고른 탭에서 멀수록 어둡고 뒤로 갑니다(RoomPage.css).
              <button key={key} id={`tab-${key}`} type="button" role="tab" aria-selected={panel === key} tabIndex={panel === key ? 0 : -1} data-away={Math.abs(at - panels.indexOf(panel))} onClick={() => setPanel(key)}>
                {tabLabels[key]}
              </button>
            ))}
          </div>
          <div className="drawer" id="room-drawer" role="tabpanel" aria-labelledby={`tab-${panel}`}>
            {panel === "thing" &&
              (selected ? (
                <ThingPanel
                  room={room}
                  thing={selected}
                  now={now}
                  folder={access === "granted" ? handle : null}
                  onPatch={patchThing}
                  onOpen={(id) => void openFile(id)}
                  onShelve={shelve}
                  onReveal={typeof handle === "string" ? (id) => void openApp(id, handle, true).then((error) => error && toast(error)) : undefined}
                />
              ) : (
                <div>
                  <div className="drawer-head">
                    <h2 tabIndex={-1}>물건</h2>
                    <p className="soft">방 안 물건을 누르면 여기서 열거나 옮길 수 있어요.</p>
                  </div>
                </div>
              ))}
            {panel === "shelf" && (
              <ShelfPanel
                things={room.things}
                onOpen={(id) => void openFile(id)}
                onPlace={(id) => {
                  place([id]);
                  setSelectedId(id);
                  setPanel("thing");
                  focusSoon(thingSelector(id));
                }}
                onPlaceMany={(ids) => {
                  place(ids);
                  toast(`방에 ${ids.length}개를 놓았어요.`);
                  focusSoon("#shelf-search");
                }}
              />
            )}
            {panel === "box" && <BoxPanel things={boxed} busy={busy !== null} onRestore={(id) => void restore(id)} onCopy={copy} />}
            {panel === "settings" && (
              <SettingsPanel
                room={room}
                onChange={(patch) => update((current) => ({ ...current, ...patch }))}
                onCare={(patch) => update((current) => ({ ...current, care: { ...current.care, ...patch } }))}
                onForget={async () => {
                  if (!(await window.confirm(`‘${room.name}’ 방을 Folduct에서 지울까요? 폴더와 파일은 그대로예요. 방 기록만 사라져요.`))) return;
                  forgetting.current = true;
                  try {
                    await forgetRoom(room.id);
                    onBack();
                  } catch {
                    forgetting.current = false;
                    dirty.current = true;
                    toast("방을 지우지 못했어요. 잠시 뒤 다시 해 주세요.");
                  }
                }}
              />
            )}
          </div>
        </aside>
      </div>
      {viewer && room.things.some((thing) => thing.id === viewer.thingId) && (
        <FileViewer
          thing={room.things.find((thing) => thing.id === viewer.thingId)!}
          state={viewer.state}
          busy={busy !== null}
          folderHint={room.origin ? shortPath(room.origin) : room.rootName}
          onClose={closeViewer}
          onConnect={() => {
            const { thingId } = viewer;
            const req = viewerReq.current;
            void connectFolder().then((result) => {
              if (!result || viewerReq.current !== req) return;
              if ("error" in result) setViewer({ thingId, state: { status: "error", message: result.error } });
              else void openFile(thingId, result.folder);
            });
          }}
          onRetry={() => void openFile(viewer.thingId)}
          onCopy={writeClipboard}
          onOpenApp={
            typeof handle === "string"
              ? () => {
                  const { thingId } = viewer;
                  const req = viewerReq.current;
                  void openApp(thingId, handle).then((error) => {
                    if (error && viewerReq.current === req) setViewer({ thingId, state: { status: "error", message: error } });
                  });
                }
              : undefined
          }
        />
      )}
      {toastRegion}
    </main>
  );
}

const nudges: [label: string, glyph: string, dx: number, dy: number][] = [
  ["왼쪽으로 옮기기", "←", -0.5, 0],
  ["위로 옮기기", "↑", 0, -0.5],
  ["아래로 옮기기", "↓", 0, 0.5],
  ["오른쪽으로 옮기기", "→", 0.5, 0],
];

// 서랍의 실제 이미지. 읽기만 하고 권한을 묻지 않으며 손댄 것으로 세지 않아요. 읽거나 그리지 못하면(HEIC 등) 조용히 숨깁니다.
function ThingImage({ folder, thing }: { folder: Folder; thing: Thing }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    let made: string | null = null;
    setUrl(null);
    readFolderFile(folder, thing.path).then(
      (file) => {
        if (stale) return;
        made = URL.createObjectURL(file);
        setUrl(made);
      },
      () => undefined,
    );
    return () => {
      stale = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [folder, thing.path, thing.lastModified]);
  return url && <img className="thing-image" src={url} alt={`${thing.name} 미리보기`} onError={() => setUrl(null)} />;
}

function ThingPanel({ room, thing, now, folder, onPatch, onOpen, onShelve, onReveal }: { room: Room; thing: Thing; now: number; folder: Folder | null; onPatch: (id: string, patch: Partial<Thing>, touch?: boolean) => void; onOpen: (id: string) => void; onShelve: (thing: Thing) => void; onReveal?: (id: string) => void }) {
  const age = thingAge(thing, room.care, room.workDays, now);
  const last = lastActivity(thing);
  return (
    <div className="thing-panel">
      <div className="thing-head">
        <span className="thing-icon"><ObjectShape kind={thing.kind} size={64} name={thing.name} seed={thing.id} /></span>
        <div>
          <h2 tabIndex={-1}>{thing.name}</h2>
          <p className="soft">{kindLabels[thing.kind]} · {formatBytes(thing.size)} · 고친 날 {new Date(thing.lastModified).toLocaleDateString("ko-KR")}{thing.lastUsedAt !== null && ` · 마지막 사용 ${new Date(thing.lastUsedAt).toLocaleDateString("ko-KR")}`}</p>
        </div>
      </div>
      {folder && previewMode(thing) === "image" && !thing.missing && thing.size <= imageLimit && <ThingImage folder={folder} thing={thing} />}
      <p className="path">{thing.path}</p>
      <p className={`state${age.stale ? " state-stale" : ""}`}>
        {thing.missing ? "폴더에서 찾지 못했어요."
          : thing.pinned ? "고정한 물건이라 정리 후보가 되지 않아요."
          : age.stale ? `${age.days}일째 그대로예요. 다음 주간 정리 때 물어볼게요.`
          : last > (thing.touchedAt ?? 0) ? `방 밖에서 ${relativeDay(last, now)} ${last === thing.lastUsedAt ? "썼어요" : "고쳤어요"}.`
          : "최근에 손댄 물건이에요."}
      </p>
      {/* 메모는 더 쓰지 않아요. 예전에 쓴 메모는 지우지 않고 보여 줍니다. */}
      {thing.note && <p className="note-line">“{thing.note}”</p>}
      <div className="row wrap">
        <button type="button" className="primary" onClick={() => onOpen(thing.id)}>파일 열기</button>
        {onReveal && <button type="button" onClick={() => onReveal(thing.id)}>{fileManagerName()}에서 보기</button>}
        {age.stale && <button type="button" onClick={() => onPatch(thing.id, {})}>아직 써요</button>}
        {/* 눌림은 aria-pressed와 체크 표시가 말하므로 글자는 바꾸지 않습니다. */}
        <button type="button" aria-pressed={thing.pinned} onClick={() => onPatch(thing.id, { pinned: !thing.pinned })}><Icon name="pin" />고정</button>
        <button type="button" onClick={() => onShelve(thing)}>선반에 올려두기</button>
      </div>
      {/* 끌기 없이 한 번씩 눌러서도 옮길 수 있게 합니다. */}
      <div className="row">
        <span className="soft" id="nudge-label">자리 옮기기</span>
        <div className="nudge" role="group" aria-labelledby="nudge-label">
          {nudges.map(([label, glyph, dx, dy]) => (
            <button key={label} type="button" aria-label={label} title={label} onClick={() => onPatch(thing.id, { spot: clampSpot({ x: thing.spot!.x + dx, y: thing.spot!.y + dy }) })}>{glyph}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// 한 번에 '모두 놓기'로 놓는 최대 개수. 방 바닥이 한꺼번에 덮이지 않게 합니다.
const placeLimit = 24;
const collator = new Intl.Collator("ko");

// 선반 목록은 이 탭이 열려 있을 때만 거르고 정렬합니다.
function ShelfPanel({ things, onPlace, onPlaceMany, onOpen }: { things: Thing[]; onPlace: (id: string) => void; onPlaceMany: (ids: string[]) => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const shelf = things.filter((thing) => !thing.spot && !thing.box).sort((a, b) => collator.compare(a.path, b.path));
  const needle = query.trim().toLowerCase();
  const shown = needle ? shelf.filter((thing) => thing.path.toLowerCase().includes(needle)) : shelf;
  return (
    <div>
      <div className="drawer-head">
        <h2 tabIndex={-1}>선반 · 놓지 않은 물건 {shelf.length}</h2>
        <p className="soft">폴더에 있지만 아직 방 바닥에 놓지 않은 파일이에요. 놓은 물건만 주간 정리 대상이 돼요.</p>
        <label className="field">찾기 <input id="shelf-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일 이름이나 경로" /></label>
        {needle && shown.length > 0 && (
          <button type="button" onClick={() => onPlaceMany(shown.slice(0, placeLimit).map((thing) => thing.id))}>
            {shown.length > placeLimit ? `찾은 ${shown.length}개 중 ${placeLimit}개 놓기` : `찾은 ${shown.length}개 모두 놓기`}
          </button>
        )}
      </div>
      <ul className="list">
        {shown.slice(0, 200).map((thing) => (
          <li key={thing.id}>
            <ObjectShape kind={thing.kind} size={28} seed={thing.id} />
            <div>
              <strong>{thing.name}</strong>
              <span className="soft" title={thing.path}>{formatBytes(thing.size)} · {thing.path}{isInBox(thing.path) && " · 정리 상자 폴더"}{thing.missing && " · 파일 없음"}</span>
            </div>
            <div className="col">
              <button type="button" onClick={() => onPlace(thing.id)}>방에 놓기</button>
              <button type="button" className="link" onClick={() => onOpen(thing.id)}>열기</button>
            </div>
          </li>
        ))}
      </ul>
      {shown.length > 200 && <p className="soft">처음 200개만 보여요. 찾기로 좁혀 주세요.</p>}
      {needle && shown.length === 0 && shelf.length > 0 && <p className="soft">‘{query.trim()}’에 맞는 파일이 없어요.</p>}
      {shelf.length === 0 && <p className="soft">선반이 비었어요. 모든 물건이 방에 나와 있어요.</p>}
    </div>
  );
}

function BoxPanel({ things, busy, onRestore, onCopy }: { things: Thing[]; busy: boolean; onRestore: (id: string) => void; onCopy: (path: string) => Promise<boolean> }) {
  return (
    <div>
      <div className="drawer-head">
        <h2 tabIndex={-1}>정리 상자 {things.length}</h2>
        <p className="soft">Folduct는 파일을 지우지 않아요. 필요 없으면 {isNative() ? `${fileManagerName()}에서` : "폴더에서 직접"} 정리 상자 폴더(<code>{boxFolderName}</code>)를 비워 주세요.</p>
      </div>
      {things.length === 0 ? <p className="soft">상자가 비어 있어요. 주간 정리 때 오래된 물건이 이곳에 모여요.</p> : (
        <ul className="list">
          {things.map((thing) => {
            const entry = thing.box!;
            const note = firstLine(thing.note);
            return (
              <li key={thing.id}>
                <ObjectShape kind={thing.kind} size={28} seed={thing.id} />
                <div>
                  <strong>{thing.name}</strong>
                  <span className="soft">{formatBytes(thing.size)} · {new Date(entry.at).toLocaleDateString("ko-KR")} 상자에 넣음</span>
                  {note && <span className="note-line">“{note}”</span>}
                  <span className="soft">{entry.state === "virtual" ? "Folduct 안에서만 정리됨 · 실제 파일은 그대로" : entry.state === "boxed" ? entry.boxPath : "옮기던 중이에요. 폴더 접근을 허용하면 실제 위치를 확인해요."}</span>
                </div>
                <div className="col">
                  <button type="button" className="primary" disabled={busy || entry.state === "moving-in" || entry.state === "moving-out"} onClick={() => onRestore(thing.id)}>제자리로</button>
                  {entry.state === "boxed" && <button type="button" onClick={() => void onCopy(entry.boxPath)}>경로 복사</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SettingsPanel({ room, onChange, onCare, onForget }: { room: Room; onChange: (patch: Partial<Room>) => void; onCare: (patch: Partial<CareSettings>) => void; onForget: () => Promise<void> }) {
  const days = (value: string) => Math.min(365, Math.max(1, Math.round(Number(value)) || 1));
  return (
    <div className="settings">
      <h2 tabIndex={-1}>방 설정</h2>
      <label className="field">방 이름 <input value={room.name} maxLength={40} onChange={(event) => onChange({ name: event.target.value })} /></label>
      <FacePicker face={room.face} onChange={(face) => onChange({ face })} />
      <fieldset className="care">
        <legend>방 돌보기</legend>
        <div className="seg" role="radiogroup" aria-label="홈에 둘지">
          <label><input type="radio" name="room-status" checked={!room.care.done} onChange={() => onCare({ done: false })} />홈에 둠</label>
          <label><input type="radio" name="room-status" checked={room.care.done} onChange={() => onCare({ done: true })} />홈에서 뺌</label>
        </div>
        <p className="soft">{room.care.done ? "홈에서 뺌: 주간 정리를 멈추고 메뉴의 방 목록으로 옮겨요" : "홈에 둠: 오래 안 쓴 물건은 주간 정리 때 정리 상자로 옮길지 물어요"}</p>
        <div className="row">
          <label>오래됨 기준 <input type="number" min={1} max={365} value={room.care.staleAfterDays} onChange={(event) => onCare({ staleAfterDays: days(event.target.value) })} />일</label>
        </div>
      </fieldset>
      <button type="button" className="danger" onClick={() => void onForget()}>이 방을 Folduct에서 지우기 (파일은 그대로)</button>
    </div>
  );
}
