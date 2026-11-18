import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { Capacity } from "../components/Capacity";
import { FileViewer, previewLimit, previewMode, writeClipboard, type ViewerState } from "../components/FileViewer";
import { Icon } from "../components/Icon";
import { cue } from "../components/useFrodo";
import { RoomScene } from "../components/RoomScene";
import { AiNotePanel } from "../components/AiNotePanel";
import { useToast, type ToastAction } from "../components/Toast";
import { VersionLog } from "../components/VersionLog";
import { boxFolderName, firstLine, handTouchedAt, markWorkDay, mergeScan, newFileCount, relativeDay, roomUsage, scanOverlap, shownActivity, thingAge } from "../domain/care";
import { freeSpot } from "../domain/plane";
import { formatBytes, kindLabels, type Kind, type Room, type ScannedFile, type Thing } from "../domain/model";
import { kinds } from "../domain/kindIcon";
import { fileManagerName, permissionHint, shortPath } from "../domain/platform";
import { canPickFolder, folderProblem, pickFolder, type Access, type ScanResult } from "../gateways/folder";
import { askFolder, doorChanged, folderAccess, isNative, openInApp, pickRoomFolder, readFolderFile, scanRoomFolder, watchFolder, type Folder } from "../gateways/native";
import { boxThing, reconcileBox, restoreFromBox, roomFolder } from "../storage/box";
import { getRoom, listRooms, saveHandle, saveRoom } from "../storage/db";
import { canReceive, transferThings, undoMove, type TransferMode } from "../storage/transfer";
import { clearPicture, PictureError, setPicture, usePicture } from "../storage/pictures";
import { useHues } from "../storage/thumbs";
import type { Hue } from "../domain/hue";
import { HueSwatches } from "../components/HueSwatches";
import { Meta } from "../components/Meta";
import { isNotFound, restoreTrashed, trashFile } from "../gateways/mover";
import { RoomSettingsDialog } from "../components/RoomSettingsDialog";

// 방 설정(RoomSettingsDialog)은 방 머리의 단추나 홈에서 방을 우클릭해 엽니다.
// 데스크톱 보기 창은 파일을 통째로 메모리에 읽습니다. 이보다 크면 기본 앱으로 엽니다.
// 서랍의 이미지 미리보기도 통째로 읽으므로 더 작게 잡습니다.
const imageLimit = 30 * 1024 ** 2;
const folderIssues = {
  denied: "폴더 접근 권한이 없어요. 목록은 그대로예요.",
  gone: "폴더를 찾지 못했어요. 옮겼거나 드라이브가 빠졌는지 확인해 주세요. 목록은 그대로예요.",
  other: "폴더를 읽지 못했어요. 목록은 그대로예요.",
};
// 창이 보이는 동안 폴더를 다시 읽는 간격(Home.tsx와 같은 값)
const rereadEveryMs = 15_000;
// 창이 좁아 서랍이 줄 아래로 쌓이는 폭(styles.css와 같은 값)
const stacked = "(max-width: 899.98px)";

// 누른 버튼이 사라질 때는 다음 그림이 그려진 뒤 이어서 볼 곳으로 포커스를 옮깁니다.
function focusSoon(selector: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
}
const thingSelector = (id: string) => `[data-thing-id="${id}"]`;

export function RoomPage({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const [handle, setHandle] = useState<Folder | null>(null);
  const [access, setAccess] = useState<Access | "none">("none");
  const [folderIssue, setFolderIssue] = useState<keyof typeof folderIssues | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 색으로 보기: 색 네모에 처음 손이 가거나 색을 고르면 이미지 색을 읽기 시작해요.
  // 형식으로 먼저 거르고, 이미지를 골랐을 때만 그 아래에 색 네모를 띄워요(2026-11-18 요청).
  const [kind, setKind] = useState<Kind | "">("");
  const [hue, setHue] = useState<Hue | "">("");
  const [hueOn, setHueOn] = useState(false);
  // 지금 하고 있는 일(폴더 읽기, 옮기기)을 글자로 보여 줍니다. null이면 쉬는 중.
  const [busy, setBusy] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ thingId: string; state: ViewerState } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { toast, toastRegion } = useToast();
  const readable = room?.source === "handle" && access === "granted" ? handle : null;
  const { hues, total: imageCount } = useHues(readable, room?.things ?? [], hueOn || hue !== "");
  const latest = useRef<Room | null>(null);
  const reading = useRef(false);
  const busyNow = useRef(busy);
  // 다른 일(옮기기·되돌리기, 플로팅 창의 넣기)이 시작될 때마다 늘어납니다. 그 전에 시작한 조용한 다시 읽기는 버려요.
  const epoch = useRef(0);
  if (busy && busy !== busyNow.current) epoch.current += 1;
  busyNow.current = busy;
  const dirty = useRef(false);
  // 파일 열기 요청 번호. 창을 닫거나 다른 파일을 열면 늘어나서, 늦게 끝난 읽기는 버립니다.
  const viewerReq = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  // 여러 파일 고르기(휴지통으로). null이면 고르는 중이 아니에요.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // 옮기기·복제할 방 고르는 중이면 그 방법과 받을 수 있는 방들.
  const [send, setSend] = useState<{ mode: TransferMode; rooms: Room[] } | null>(null);
  const side = useRef<HTMLElement>(null);

  // 고칠 때마다 상태를 바꾸고, 0.3초 뒤에 한 번에 저장합니다. 방을 떠나거나 창을 가릴 때도 남은 것을 저장합니다.
  // 저장이 실패하면 다시 '고칠 것 있음'으로 두고 배너로 알립니다. 화면의 내용은 그대로라 다시 저장할 수 있어요.
  function flush() {
    const snap = latest.current;
    if (!dirty.current || !snap) return;
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
      epoch.current += 1;
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

  // 다른 앱에서 파일을 넣고 돌아오면 폴더를 조용히 다시 읽습니다. 버튼이 잠기지 않게 busy는 건드리지 않고, 다른 일을 하는 중이면 건너뛰어요.
  useEffect(() => {
    if (!handle || access !== "granted") return;
    let left = false;
    const back = () => {
      if (document.visibilityState !== "visible" || reading.current || busyNow.current) return;
      reading.current = true;
      const started = epoch.current;
      scanRoomFolder(handle)
        .then(
          (scan) => {
            const current = latest.current;
            if (left || busyNow.current || epoch.current !== started || !current) return;
            setFolderIssue(null);
            // 바뀐 게 없으면 저장하지 않아요. 빈 저장이 플로팅 창이 고친 기록을 덮거나 '비웠어요' 알림을 지우지 않게요.
            const next = mergeScan(current, scan.files, scan, Date.now());
            if (next.scan.complete === current.scan.complete && next.scan.failed === current.scan.failed && JSON.stringify(next.things) === JSON.stringify(current.things)) return;
            announceNew(scan);
            update((latestRoom) => mergeScan(latestRoom, scan.files, scan, Date.now()));
          },
          (error: unknown) => {
            if (!left) setFolderIssue(folderProblem(error));
          },
        )
        .finally(() => {
          reading.current = false;
        });
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    // 창을 띄워 둔 채 Finder에서 넣은 파일도 따라잡게, 보이는 동안 틈틈이 다시 읽습니다. 대화상자가 열려 있으면 닫은 뒤로 미뤄요.
    const timer = window.setInterval(() => {
      if (!document.querySelector("dialog[open]")) back();
    }, rereadEveryMs);
    // 데스크톱 앱은 폴더를 감시해 바뀌는 즉시 읽어요. 위 타이머는 감시가 놓친 때를 받쳐 줘요.
    let unwatch: (() => void) | undefined;
    if (isNative() && typeof handle === "string") {
      watchFolder(handle, back, true).then(
        (stop) => (left ? stop() : (unwatch = stop)),
        (error: unknown) => console.error(error),
      );
    }
    return () => {
      left = true;
      unwatch?.();
      window.clearInterval(timer);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [handle, access]);

  // 새 파일은 '새로 왔어요' 줄 맨 앞에 서요. 다른 일을 하다 놓치지 않게 알려 줍니다.
  function announceNew(scan: ScanResult) {
    const count = latest.current ? newFileCount(latest.current, scan.files, scan) : 0;
    if (count > 0) toast(`새 파일 ${count.toLocaleString("ko-KR")}개가 들어왔어요. ‘새로 왔어요’ 줄에 있어요.`);
  }

  // 방에 들어오면 제목으로 포커스를 옮겨, 화면 읽기 프로그램이 어느 방인지 읽게 합니다.
  useEffect(() => {
    heading.current?.focus();
  }, [room?.id]);
  useEffect(() => {
    if (room) document.title = `${room.name} · Folduct`;
  }, [room?.name]);
  // 방에 들어오면 프로도가 반겨 줍니다.
  const roomLoaded = room !== null;
  useEffect(() => {
    if (roomLoaded) cue(roomId, { body: "hop", face: "happy", ms: 800 });
  }, [roomLoaded, roomId]);

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

  // 폴더에서 찾지 못한 파일의 기록만 방에서 뺍니다(T314). 실제 파일은 건드리지 않고, 알림에서 되돌릴 수 있어요.
  // shortcut: 꾸민 이미지(pic:방:물건)는 되돌리기를 위해 남겨 두고 방을 잊을 때 함께 지워요. 쌓여 문제가 되면 그때 따로 치워요.
  // '고르기'로 고른 파일들을 한 번 묻고 차례로 휴지통으로 보내요. 하나가 실패해도 나머지는 계속해요.
  async function trashPicked() {
    const chosen = (latest.current?.things ?? []).filter((thing) => picked?.has(thing.id) && !thing.missing);
    if (chosen.length === 0 || typeof handle !== "string" || !(await window.confirm(`파일 ${chosen.length.toLocaleString("ko-KR")}개를 휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요.`))) return;
    setBusy("휴지통으로 보내는 중…");
    const done: { thing: Thing; place: string | null }[] = [];
    for (const thing of chosen) {
      try {
        done.push({ thing, place: await trashFile(handle, thing.path) });
      } catch (error) {
        // 이미 없는 파일은 기록에서만 빼요.
        if (isNotFound(error)) done.push({ thing, place: null });
        else console.error(error);
      }
    }
    const sent = new Set(done.map(({ thing }) => thing.id));
    setBusy(null);
    if (sent.size > 0) update((room) => ({ ...room, things: room.things.filter((thing) => !sent.has(thing.id)) }));
    if (selectedId && sent.has(selectedId)) setSelectedId(null);
    setPicked(null);
    const failed = chosen.length - sent.size;
    toast(`${sent.size > 0 ? `파일 ${sent.size.toLocaleString("ko-KR")}개를 휴지통으로 보냈어요.` : ""}${failed > 0 ? ` ${failed.toLocaleString("ko-KR")}개는 보내지 못했어요.` : ""}`.trim(), undoTrash(handle, done));
  }

  // 고른 파일들을 다른 방으로 옮기거나 복제해요(2026-11-18 요청). 먼저 받을 방을 고르게 해요.
  async function chooseTarget(mode: TransferMode) {
    const current = latest.current;
    if (!current) return;
    setSend({ mode, rooms: (await listRooms()).filter((other) => canReceive(other, current)) });
  }

  async function sendTo(to: Room) {
    const from = latest.current;
    if (!from || !send) return;
    const mode = send.mode;
    const chosen = from.things.filter((thing) => picked?.has(thing.id) && !thing.missing && !thing.box);
    if (chosen.length === 0) return;
    setSend(null);
    setBusy(mode === "move" ? "옮기는 중…" : "복제하는 중…");
    const { done, failed, message } = await transferThings(from, to, chosen, mode);
    setBusy(null);
    const gone = new Set(done.map(({ thing }) => thing.id));
    if (mode === "move" && gone.size > 0) {
      update((room) => ({ ...room, things: room.things.filter((thing) => !gone.has(thing.id)) }));
      if (selectedId && gone.has(selectedId)) setSelectedId(null);
    }
    setPicked(null);
    const verb = mode === "move" ? "옮겼어요" : "복제했어요";
    const text = `${done.length > 0 ? `파일 ${done.length.toLocaleString("ko-KR")}개를 ‘${to.name}’ 방으로 ${verb}.` : ""}${failed > 0 ? ` ${failed.toLocaleString("ko-KR")}개는 못 했어요.${message ? ` ${message}` : ""}` : ""}`.trim();
    // 옮기기만 되돌릴 수 있어요. 복제는 원본이 그대로라 되돌릴 게 없어요.
    toast(text, mode === "move" && done.length > 0 ? {
      label: "되돌리기",
      run: () =>
        void undoMove(from, to, done).then((back) => {
          if (back.length > 0) update((room) => ({ ...room, things: [...room.things, ...back.map(({ thing }) => thing).filter((thing) => !room.things.some((item) => item.id === thing.id))] }));
          toast(back.length === done.length ? `파일 ${back.length.toLocaleString("ko-KR")}개를 되돌렸어요.` : `${back.length.toLocaleString("ko-KR")}개만 되돌렸어요. 원래 자리에 같은 이름 파일이 생겼을 수 있어요.`);
        }),
    } : undefined);
  }

  // 휴지통으로 보낸 파일들을 원래 자리로 되돌리고 방 기록에 다시 넣는 알림 단추. 자리를 모르면(macOS 밖) 단추가 없어요.
  function undoTrash(root: string, done: { thing: Thing; place: string | null }[]): ToastAction | undefined {
    const known = done.filter((item): item is { thing: Thing; place: string } => item.place !== null);
    if (known.length === 0) return undefined;
    return {
      label: "되돌리기",
      run: () =>
        void (async () => {
          const back: Thing[] = [];
          for (const { thing, place } of known) {
            try {
              await restoreTrashed(root, thing.path, place);
              back.push(thing);
            } catch (error) {
              console.error(error);
            }
          }
          if (back.length > 0) update((room) => ({ ...room, things: [...room.things, ...back.filter((thing) => !room.things.some((item) => item.id === thing.id))] }));
          const failed = known.length - back.length;
          toast(back.length > 0 ? `파일 ${back.length.toLocaleString("ko-KR")}개를 되돌렸어요.${failed > 0 ? ` ${failed.toLocaleString("ko-KR")}개는 되돌리지 못했어요. 휴지통에서 직접 꺼내 주세요.` : ""}` : "되돌리지 못했어요. 같은 이름 파일이 생겼거나 휴지통에서 옮겨졌어요. 휴지통에서 직접 꺼내 주세요.");
        })(),
    };
  }

  // 묻고 나서 휴지통으로 보내고, 방 기록에서도 빼요(데스크톱만). 휴지통에서 되살릴 수 있어요.
  async function trashThing(id: string) {
    const gone = latest.current?.things.find((thing) => thing.id === id);
    if (!gone || typeof handle !== "string" || !(await window.confirm(`‘${gone.name}’ 파일을 휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요.`))) return;
    let place: string | null;
    try {
      place = await trashFile(handle, gone.path);
    } catch (error) {
      if (!isNotFound(error)) return toast(`휴지통으로 보내지 못했어요. (${String(error)})`);
      update((room) => ({ ...room, things: room.things.filter((thing) => thing.id !== id) }));
      setSelectedId(null);
      return toast(`‘${gone.name}’ 파일이 이미 없어서 목록에서만 뺐어요.`);
    }
    update((room) => ({ ...room, things: room.things.filter((thing) => thing.id !== id) }));
    setSelectedId(null);
    heading.current?.focus();
    toast(`‘${gone.name}’ 파일을 휴지통으로 보냈어요.`, undoTrash(handle, [{ thing: gone, place }]));
  }

  function forgetThing(id: string) {
    const current = latest.current?.things ?? [];
    const at = current.findIndex((thing) => thing.id === id);
    const gone = current[at];
    if (!gone?.missing) return;
    update((room) => ({ ...room, things: room.things.filter((thing) => thing.id !== id) }));
    setSelectedId(null);
    heading.current?.focus();
    toast(`‘${gone.name}’ 기록을 뺐어요. 파일은 건드리지 않았어요.`, {
      label: "되돌리기",
      run: () => update((room) => (room.things.some((thing) => thing.id === id) ? room : { ...room, things: [...room.things.slice(0, at), gone, ...room.things.slice(at)] })),
    });
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
      if (!silent) toast(`폴더를 다시 봤어요. 파일 ${scan.files.length.toLocaleString("ko-KR")}개.`);
      announceNew(scan);
      update((current) => mergeScan(current, scan.files, scan, Date.now()));
      setFolderIssue(null);
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
    cue(roomId, { face: "lookL", ms: 500 });
    window.setTimeout(() => cue(roomId, { face: "lookR", ms: 500 }), 600);
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
    cue(roomId, { body: "nod" });
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

  // 데스크톱: OS 기본 앱으로 엽니다. 연 것은 손댄 것으로 셉니다. 실패하면 이유를 돌려줍니다.
  async function openApp(thingId: string, folder: string): Promise<string | null> {
    const thing = latest.current?.things.find((item) => item.id === thingId);
    if (!thing) return null;
    try {
      await openInApp(folder, thing.path);
      patchThing(thingId, {});
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
      cue(roomId, { body: "wave", face: "happy", ms: 950 });
      toast("제자리로 돌려놓았어요.");
      focusSoon(thingSelector(id));
    } catch {
      toast("제자리로 옮기지 못했어요. 잠시 뒤 다시 해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  // 방 안에서 파일 하나를 바로 정리 상자에 넣어요. 주간 정리를 기다리지 않아요. 되돌리기는 상자 줄의 '제자리로'예요.
  async function putInBox(id: string) {
    if (!latest.current) return;
    flush();
    setBusy("상자에 넣는 중…");
    try {
      const result = await boxThing(latest.current, room?.source === "handle" ? handle : null, id);
      if (result.error) return toast(result.error);
      const saved = result.room.things.find((thing) => thing.id === id);
      if (!saved?.box) return;
      update((current) => ({ ...current, things: current.things.map((thing) => (thing.id === id ? { ...thing, box: saved.box, path: saved.path } : thing)) }));
      cue(roomId, { body: "bye", face: "happy", ms: 950 });
      toast(saved.box.state === "virtual" ? "Folduct 안에서만 상자에 넣었어요. 실제 파일은 그대로예요." : "정리 상자 폴더로 옮겼어요.");
    } catch {
      toast("상자에 넣지 못했어요. 잠시 뒤 다시 해 주세요.");
    } finally {
      setBusy(null);
    }
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
  const selected = room.things.find((thing) => thing.id === selectedId) ?? null;

  return (
    <main className="room-page">
      <header className="topnav">
        {/* 머리줄은 글 없이 화살표와 방 이름만 둬요. 로고·프로도는 뺐어요(2026-11-18 요청). */}
        <button type="button" className="quiet home-link" aria-label="홈으로" title="홈으로" onClick={() => { flush(); onBack(); }}>
          <span aria-hidden="true">←</span>
        </button>
        <div className="topnav-title">
          <h1 ref={heading} tabIndex={-1}>{room.name}</h1>
          <p className="eyebrow"><Meta items={[room.source === "sample" ? "샘플 방" : room.rootName === room.name ? null : room.source === "input" ? room.rootName : `${room.rootName} 폴더`, room.source === "input" && "보기 전용", room.care.done && "홈에서 뺌"]} /></p>
        </div>
        <div className="row">
          <div aria-live="polite">{busy && <span className="scanning">{busy}</span>}</div>
          {room.source === "handle" && <button type="button" onClick={() => void rescan()} disabled={busy !== null}>폴더 다시 보기</button>}
          <button
            type="button"
            onClick={() => {
              // 남은 저장을 먼저 끝내요. 설정 창이 저장한 이름·기준을 이 화면의 옛 기록이 덮지 않게요.
              flush();
              setSettingsOpen(true);
            }}
          >
            방 설정
          </button>
        </div>
        {settingsOpen && (
          <RoomSettingsDialog
            room={room}
            onClose={() => {
              setSettingsOpen(false);
              void getRoom(room.id).then((saved) => {
                if (!saved) return;
                latest.current = saved;
                setRoom(saved);
              });
            }}
            onForgotten={onBack}
          />
        )}
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
          <p className="banner room-off-banner">
            <span>홈에서 뺀 방이에요. 주간 정리가 쉬어요.</span>
            <button type="button" onClick={() => { update((current) => ({ ...current, care: { ...current.care, done: false } })); heading.current?.focus(); }}>홈에 올리기</button>
          </p>
        )}
        {room.source === "input" && (
          <p className="banner soft-banner">
            {room.origin ? `가져온 목록으로 만든 보기 전용 방이에요(${shortPath(room.origin)}).` : "이 방은 브라우저가 폴더를 기억하지 못하는 방식으로 연결됐어요."} 폴더를 연결하면 다시 보기와 정리 상자 이동을 할 수 있어요. 그 전에는 정리 상자가 Folduct 안에서만 쓰여요.
            {(canPickFolder() || isNative()) && <button type="button" className="primary" onClick={() => void connectFromPage()} disabled={busy !== null}>폴더 연결</button>}
          </p>
        )}
        {room.scan.freedBytes > 0 && <p className="banner happy-banner">지난 확인보다 {formatBytes(room.scan.freedBytes)} 비웠어요. 방이 한결 넓어졌어요.</p>}
      </div>

      <div className="room-body">
        <section className="room-stage-wrap" aria-label={`${room.name} 방. 꺼내 놓은 파일과 폴더의 판, 그 아래 정리 상자가 있어요.`}>
          <div className="room-capacity">
            {room.things.length > 0 && (
              <input type="search" className="room-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름이나 폴더로 찾기" aria-label="이 방에서 파일 이름이나 폴더 이름으로 찾기" />
            )}
            {room.things.length > 0 && (
              <div className="seg room-kinds" role="radiogroup" aria-label="형식으로 보기">
                {(["", ...kinds.filter((name) => room.things.some((thing) => thing.kind === name && !thing.box))] as (Kind | "")[]).map((name) => (
                  <label key={name || "all"}>
                    <input
                      type="radio"
                      name="room-kind"
                      checked={kind === name}
                      onChange={() => {
                        setKind(name);
                        if (name !== "image") setHue("");
                      }}
                    />
                    {name ? kindLabels[name] : "전체"}
                  </label>
                ))}
              </div>
            )}
            {kind === "image" && imageCount > 0 && <HueSwatches value={hue} found={hues} total={imageCount} onReach={() => setHueOn(true)} onPick={setHue} />}
            {access === "granted" && typeof handle === "string" && room.things.length > 0 && (
              <button type="button" className="quiet room-pick-toggle" aria-pressed={picked !== null} onClick={() => setPicked(picked ? null : new Set())}>{picked ? "고르기 끝" : "고르기"}</button>
            )}
            <Capacity usage={usage} />
          </div>
          {picked && (
            <div className="room-pick-bar" role="status">
              <span>{picked.size > 0 ? `${picked.size.toLocaleString("ko-KR")}개 골랐어요` : "휴지통으로 보낼 파일을 눌러 골라 주세요"}</span>
              <button type="button" disabled={picked.size === 0 || busy !== null} aria-expanded={send?.mode === "move"} onClick={() => (send?.mode === "move" ? setSend(null) : void chooseTarget("move"))}>옮기기</button>
              <button type="button" disabled={picked.size === 0 || busy !== null} aria-expanded={send?.mode === "copy"} onClick={() => (send?.mode === "copy" ? setSend(null) : void chooseTarget("copy"))}>복제</button>
              <button type="button" disabled={picked.size === 0 || busy !== null} onClick={() => void trashPicked()}><Icon name="trash" />휴지통</button>
              {send && (
                <div className="room-send" role="group" aria-label={send.mode === "move" ? "옮길 방 고르기" : "복제할 방 고르기"}>
                  {send.rooms.length === 0 ? (
                    <span>폴더를 연결한 다른 방이 없어요.</span>
                  ) : (
                    <>
                      <span>{send.mode === "move" ? "어느 방으로 옮길까요?" : "어느 방에 복제할까요?"}</span>
                      {send.rooms.map((other) => (
                        <button key={other.id} type="button" disabled={busy !== null} onClick={() => void sendTo(other)}>{other.name}</button>
                      ))}
                    </>
                  )}
                  <button type="button" className="quiet" onClick={() => setSend(null)}>취소</button>
                </div>
              )}
            </div>
          )}
          <RoomScene
            room={room}
            now={now}
            folder={readable}
            query={query}
            only={!kind ? null : kind === "image" && hue && imageCount > 0 ? new Set([...hues].filter(([, found]) => found === hue).map(([id]) => id)) : new Set(room.things.filter((thing) => thing.kind === kind).map((thing) => thing.id))}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              setSelectedId(id);
              cue(roomId, { body: "nod" });
              // 서랍이 줄 아래로 쌓인 좁은 창에서는 고른 결과가 보이게 서랍을 끌어올립니다.
              if (window.matchMedia(stacked).matches) side.current?.scrollIntoView({ block: "nearest" });
            }}
            onOpen={(id) => void openFile(id)}
            picked={picked}
            onPick={(id) => setPicked((current) => {
              const next = new Set(current);
              if (!next.delete(id)) next.add(id);
              return next;
            })}
            onCanvas={(items) => update((current) => ({ ...current, canvas: items }))}
          />
        </section>

        <aside className="side" ref={side} aria-label="고른 파일">
          <div className="drawer" id="room-drawer">
            {selected?.box ? (
              <BoxThingPanel thing={selected} busy={busy !== null} onRestore={(id) => void restore(id)} onCopy={copy} />
            ) : selected ? (
              <>
              <ThingPanel
                room={room}
                thing={selected}
                now={now}
                folder={access === "granted" ? handle : null}
                onPatch={patchThing}
                onOpen={(id) => void openFile(id)}
                onToast={toast}
                onForget={forgetThing}
                onTrash={access === "granted" && typeof handle === "string" ? (id) => void trashThing(id) : undefined}
                onBox={busy === null ? (id) => void putInBox(id) : undefined}
              />
              <VersionLog room={room} thing={selected} folder={access === "granted" ? handle : null} now={now} onPick={setSelectedId} />
              </>
            ) : (
              <div>
                <div className="drawer-head">
                  <h2 tabIndex={-1}>파일</h2>
                  <p className="soft">판 위 파일을 누르면 여기서 열거나 고정할 수 있어요. 필요한 파일은 ‘꺼내기’로 판에 놓아요.</p>
                </div>
              </div>
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

// 파일마다 내 이미지로 꾸미기. 고른 그림은 줄여서 앱 저장소에만 두고, 파일과 폴더는 건드리지 않아요.
function PictureButtons({ room, thing, onToast }: { room: Room; thing: Thing; onToast: (message: string) => void }) {
  const picture = usePicture(thing.id);
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const run = (job: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    job().then(
      () => onToast(done),
      (error: unknown) => onToast(error instanceof PictureError ? error.message : "이미지를 저장하지 못했어요."),
    ).finally(() => setBusy(false));
  };
  // disabled는 누른 단추의 포커스를 날려서, 일하는 동안은 aria-disabled로만 막아요.
  return (
    <>
      <button ref={pick} type="button" aria-disabled={busy} onClick={() => !busy && input.current?.click()}>{picture ? "다른 이미지로" : "내 이미지로 꾸미기"}</button>
      {/* 누른 단추가 사라지니 포커스를 고르기 단추로 옮겨요. */}
      {picture && <button type="button" aria-disabled={busy} onClick={() => run(() => clearPicture(room.id, thing.id).then(() => pick.current?.focus()), "원래 그림으로 돌렸어요.")}>원래 그림으로</button>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // 같은 그림을 다시 골라도 바뀜이 오게 비워 둡니다.
          event.currentTarget.value = "";
          if (file) run(() => setPicture(room.id, thing.id, file), "이 파일을 내 이미지로 꾸몄어요.");
        }}
      />
    </>
  );
}

function ThingPanel({ room, thing, now, folder, onPatch, onOpen, onToast, onForget, onTrash, onBox }: { room: Room; thing: Thing; now: number; folder: Folder | null; onPatch: (id: string, patch: Partial<Thing>, touch?: boolean) => void; onOpen: (id: string) => void; onToast: (message: string) => void; onForget: (id: string) => void; onTrash?: (id: string) => void; onBox?: (id: string) => void }) {
  const age = thingAge(thing, room, now);
  const last = shownActivity(thing, room);
  return (
    <div className="thing-panel">
      <div className="thing-head">
        <span className="thing-icon"><ObjectShape kind={thing.kind} size={64} name={thing.name} seed={thing.id} /></span>
        <div>
          <h2 tabIndex={-1}>{thing.name}</h2>
          <p className="soft"><Meta items={[kindLabels[thing.kind], formatBytes(thing.size), `고친 날 ${new Date(thing.lastModified).toLocaleDateString("ko-KR")}`, thing.lastUsedAt !== null && `마지막 사용 ${new Date(thing.lastUsedAt).toLocaleDateString("ko-KR")}`]} /></p>
        </div>
      </div>
      {folder && previewMode(thing) === "image" && !thing.missing && thing.size <= imageLimit && <ThingImage folder={folder} thing={thing} />}
      <p className="path">{thing.path}</p>
      {isNative() && <AiNotePanel key={thing.id} room={room} thing={thing} folder={folder} />}
      <p className={`state${age.stale ? " state-stale" : ""}`}>
        {thing.missing ? "폴더에서 찾지 못했어요."
          : thing.pinned ? "고정한 물건이라 정리 후보가 되지 않아요."
          : age.stale ? `${age.days}일째 그대로예요. 다음 주간 정리 때 물어볼게요.`
          : last > (handTouchedAt(thing, room) ?? 0) ? `방 밖에서 ${relativeDay(last, now)} ${last === thing.lastUsedAt ? "썼어요" : "고쳤어요"}.`
          : "최근에 손댄 물건이에요."}
      </p>
      {/* 메모는 더 쓰지 않아요. 예전에 쓴 메모는 지우지 않고 보여 줍니다. */}
      {thing.note && <p className="note-line">“{thing.note}”</p>}
      <div className="row wrap">
        <button type="button" className="primary" onClick={() => onOpen(thing.id)}>파일 열기</button>
        {age.stale && <button type="button" onClick={() => onPatch(thing.id, {})}>아직 써요</button>}
        {/* 눌림은 aria-pressed와 체크 표시가 말하므로 글자는 바꾸지 않습니다. */}
        <button type="button" aria-pressed={thing.pinned} onClick={() => onPatch(thing.id, { pinned: !thing.pinned })}><Icon name="pin" />고정</button>
        {thing.missing ? <button type="button" onClick={() => onForget(thing.id)}>기록 빼기</button>
          : <button type="button" aria-disabled={!onBox} onClick={() => onBox?.(thing.id)}><Icon name="sweep" />정리 상자에 넣기</button>}
        {onTrash && !thing.missing && <button type="button" onClick={() => onTrash(thing.id)}><Icon name="trash" />휴지통</button>}
      </div>
      <div className="row wrap">
        <PictureButtons key={thing.id} room={room} thing={thing} onToast={onToast} />
      </div>
    </div>
  );
}

// 정리 상자 줄에서 고른 파일. 상자에 넣은 날과 실제 자리를 보여 주고, 제자리로 돌릴 수 있어요.
function BoxThingPanel({ thing, busy, onRestore, onCopy }: { thing: Thing; busy: boolean; onRestore: (id: string) => void; onCopy: (path: string) => Promise<boolean> }) {
  const entry = thing.box!;
  const note = firstLine(thing.note);
  return (
    <div className="thing-panel">
      <div className="thing-head">
        <span className="thing-icon"><ObjectShape kind={thing.kind} size={64} name={thing.name} seed={thing.id} /></span>
        <div>
          <h2 tabIndex={-1}>{thing.name}</h2>
          <p className="soft"><Meta items={[kindLabels[thing.kind], formatBytes(thing.size), `${new Date(entry.at).toLocaleDateString("ko-KR")} 상자에 넣음`]} /></p>
        </div>
      </div>
      {note && <p className="note-line">“{note}”</p>}
      <p className="path">{entry.state === "virtual" ? "Folduct 안에서만 정리했어요. 실제 파일은 그대로예요." : entry.state === "boxed" ? entry.boxPath : "옮기던 중이에요. 폴더 접근을 허용하면 실제 위치를 확인해요."}</p>
      <p className="soft">Folduct는 파일을 지우지 않아요. 필요 없으면 {isNative() ? `${fileManagerName()}에서` : "폴더에서 직접"} 정리 상자 폴더(<code>{boxFolderName}</code>)를 비워 주세요.</p>
      <div className="row wrap">
        <button type="button" className="primary" disabled={busy || entry.state === "moving-in" || entry.state === "moving-out"} onClick={() => onRestore(thing.id)}>제자리로</button>
        {entry.state === "boxed" && <button type="button" onClick={() => void onCopy(entry.boxPath)}>경로 복사</button>}
      </div>
    </div>
  );
}
