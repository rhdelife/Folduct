import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from "react";
import { cssToken } from "./tokens";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { downloadDir } from "@tauri-apps/api/path";
import { cursorPosition, getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { kindParts, poseFace, type DuctPose } from "../art/duct";
import { kindTones } from "../art/palette";
import { dayMs, doneOfferDue, localDay, sweepCandidates, sweepDue, sweepRooms } from "../domain/care";
import { faceColorVar } from "../domain/face";
import { doorTargets, dropItem, emptyDoorstep, isScreenshotName, type DoorItem, type Doorstep } from "../domain/doorstep";
import { readDoorFolder } from "../gateways/folder";
import type { Room } from "../domain/model";
import { arrivals, checkpointSession, defaultPet, formatWorked, pauseSession, restoreSession, resumeSession, startSession, workedTime, type PetSettings, type Session } from "../domain/session";
import { addWork } from "../domain/worklog";
import { doorChanged, isNative, petSettingsChanged, sessionEnded, setPetVisible, workLogged, workStartAsked, sessionChanged, workEndAsked, workPauseAsked, workStartRoom, sweepOpenAsked, watchFolder, workAutoMoved, workAutoUndo, pathSource, sameFolder, screenshotDir, folderMover } from "../gateways/native";
import { getDoorstep, getLastSweepAt, getPetSettings, getReviewDays, getSession, getSweepNoticeAt, listRooms, patchDoorstep, patchWorkLog, savePetSettings, saveSession, setLastSweepAt, setSweepNoticeAt } from "../storage/db";
import { addDoorFolder, bringIntoRoom, refreshDoorstep, undoBring, type DoorMove } from "../storage/doorstep";
import { downloadName, freeDoorName, saveDownload, trashFile } from "../gateways/mover";
import { PoseArt, RoomFaceArt } from "./RoomFace";
import { cue } from "./useFrodo";
import { Meta } from "./Meta";
import { HoldToEnd } from "./home/WorkControl";
import { QuickMemo } from "./QuickMemo";

const saveEveryMs = 60_000;
const dragSlop = 4;
// 답이 없으면 상태는 그대로 두고 묻기만 거둡니다.
const askShownMs = 30_000;
// 작업 중에 새 파일을 찾는 주기.
const watchEveryMs = 10_000;
// 그림이 차지하는 폭. styles.css --pet-vase와 같아요.
const petPx = 104;
// 커서를 읽는 주기. 앱이 뒤에 있으면 창에 호버가 오지 않아 위치를 직접 읽습니다.
const cursorEveryMs = 150;
// styles.css의 pet-untuck(--dur-3)보다 조금 길게 기다린 뒤 창 크기를 다시 맞춰요.
const untuckMs = 400;
const glanceEveryMs = 9_000;

// 그림이 차지하는 폭(아이콘 아래 작은 창). styles.css --pet-panel-art와 같아요.
const panelPx = 64;
// 다른 곳을 눌러 닫힌 바로 그 누름이 아이콘이면, 그 누름으로 다시 열지 않아요.
const reopenGapMs = 300;

// 메뉴 막대 아이콘 아래에 여는 작은 창(기본), 또는 앱 화면과 따로 늘 떠 있는 작은 창(띄워 두기). 주름관은 지금 하는 프로젝트이고, 자세가 지금 상태를 말해요. 작업의 시작·멈춤·끝만 정합니다. 파일은 건드리지 않아요.
export function Pet() {
  const [session, setSession] = useState<Session | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  // 메뉴 막대 아이콘으로 들어가거나(tuck) 나오는(untuck) 중. 창은 Rust가 미끄러뜨리고, 여기서는 프로도를 줄였다 키워요.
  const [motion, setMotion] = useState<"tuck" | "untuck" | null>(null);
  const [pet, setPet] = useState<PetSettings>(defaultPet);
  const [asking, setAsking] = useState(false);
  const [door, setDoor] = useState<Doorstep | null>(null);
  const [done, setDone] = useState<{ text: string; failed?: boolean; undo?: { moves: { item: DoorItem; moved: DoorMove }[]; room: Room }; saved?: { root: string; name: string } } | null>(null);
  // 웹에서 그림·파일 링크를 끌어 프로도 위에 올려 둔 동안. 프로도가 받는 자세를 해요.
  const [dropping, setDropping] = useState(false);
  // 메뉴 막대 작은 창 안에 펼친 퀵 메모(2026-11-19 요청).
  const [memoOpen, setMemoOpen] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  // 이 작업에서 새로 찍은 스크린샷. 현관 파일과 같은 길로 방 안 '스크린샷/찍은 날' 폴더에 옮겨요(2026-11-19 요청).
  const [shots, setShots] = useState<DoorItem[]>([]);
  // 옮겼다는 알림에서 '다른 방으로'를 눌러 받을 방을 고르는 중.
  const [picking, setPicking] = useState(false);
  // 아이콘 아래 작은 창이 열려 있는지. 띄워 두기를 켜면 쓰지 않아요.
  const [panelOpen, setPanelOpen] = useState(false);
  const closedAt = useRef(0);
  const root = useRef<HTMLElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const room = rooms.find((item) => item.id === session?.roomId) ?? null;
  const working = session?.status === "working";

  // 작업 중이던 시간은 상태가 바뀔 때마다 일력에 넣습니다. 앱이 갑자기 꺼져도 마지막 저장 뒤의 시간만 빠져요.
  const latest = useRef<Session | null>(null);
  const commit = useCallback((next: Session | null) => {
    const before = latest.current;
    latest.current = next;
    setSession(next);
    saveSession(next).catch((error: unknown) => console.error(error));
    if (isNative()) emit(sessionChanged, next).catch((error: unknown) => console.error(error));
    if (before?.since == null) return;
    const at = Date.now();
    patchWorkLog((log) => addWork(log, localDay(at), before.roomId, workedTime(before, at) - before.workedMs))
      .then(() => (isNative() ? emit(workLogged) : undefined))
      .catch((error: unknown) => console.error(error));
  }, []);

  const change = useCallback((next: Session | null) => {
    commit(next);
    setNow(Date.now());
    setAsking(false);
  }, [commit]);

  const loadRooms = useCallback(async () => {
    const list = await listRooms();
    setRooms(list);
    return list;
  }, []);
  // 방 목록을 다시 읽어요. 못 읽어도 지금 보이는 목록을 그대로 두고 기록만 남겨요.
  const reloadRooms = useCallback(() => void loadRooms().catch((error: unknown) => console.error(error)), [loadRooms]);

  useEffect(() => {
    void (async () => {
      try {
        const [saved, list] = await Promise.all([getSession(), loadRooms()]);
        // 지운 방이나 홈에서 뺀 방의 작업은 이어 갈 수 없어요.
        change(saved && list.some((item) => item.id === saved.roomId && !item.care.done) ? restoreSession(saved) : null);
      } catch (error) {
        console.error(error);
      }
    })();
  }, [change, loadRooms]);

  // Review 알림: 정리할 때가 됐고 이번 주기에 아직 알리지 않았으면 이 창에 한 번만 띄워요(메인 창에 정리 창을 띄우지 않아요).
  // 다시 보려면 앱 메뉴의 'Review 보기'나 머리의 'Review'를 눌러요.
  const [sweepNotice, setSweepNotice] = useState<number | null>(null);
  useEffect(() => {
    void (async () => {
      const [last, noticed, every] = await Promise.all([getLastSweepAt(), getSweepNoticeAt(), getReviewDays()]);
      const now = Date.now();
      if (last === null || !sweepDue(last, now, every)) return setSweepNotice(null);
      if (noticed !== null && noticed > last && now - noticed < every * dayMs) return;
      const active = sweepRooms(rooms.filter((item) => !item.care.done));
      const count = active.reduce((sum, item) => sum + sweepCandidates(item, now).length, 0) + active.filter((item) => doneOfferDue(item, now)).length;
      setSweepNotice(count > 0 ? count : null);
    })().catch((error: unknown) => console.error(error));
  }, [rooms]);
  const sweepSeen = useRef(false);
  const dismissSweep = (later: boolean) => {
    const at = Date.now();
    setSweepNotice(null);
    setSweepNoticeAt(at).catch((error: unknown) => console.error(error));
    if (later) setLastSweepAt(at).catch((error: unknown) => console.error(error));
  };

  // 설정을 읽은 뒤에 창을 띄웁니다. 앱의 환경설정에서 바꾸면 바로 따라와요.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let left = false;
    const read = () => getPetSettings().then(setPet, (error: unknown) => console.error(error));
    getPetSettings()
      .then((saved) => {
        setPet(saved);
        if (saved.floating && isNative()) return setPetVisible(true);
      })
      .catch((error: unknown) => console.error(error));
    if (isNative()) {
      void listen(petSettingsChanged, () => void read()).then((unlisten) => {
        if (left) unlisten();
        else stop = unlisten;
      });
    }
    return () => {
      left = true;
      stop?.();
    };
  }, []);

  // 정한 주기마다 지금 상태가 맞는지 묻습니다. 상태를 바꾸면 주기를 처음부터 다시 세요.
  const status = session?.status;
  useEffect(() => {
    if (!status || pet.askEvery === 0) return setAsking(false);
    const timer = window.setInterval(() => setAsking(true), pet.askEvery * 60_000);
    return () => window.clearInterval(timer);
  }, [status, pet.askEvery]);
  // 묻는 말은 보이는 동안만 30초 세요. 아이콘 창을 닫아 둔 동안은 아이콘 점으로 남아 있다가, 열면 그때부터 세요.
  const askVisible = asking && (pet.floating || panelOpen);
  useEffect(() => {
    if (!askVisible) return;
    const timer = window.setTimeout(() => setAsking(false), askShownMs);
    return () => window.clearTimeout(timer);
  }, [askVisible]);

  useEffect(() => {
    if (!working) return;
    const refreshTime = () => setNow(Date.now());
    const tick = window.setInterval(refreshTime, 1000);
    window.addEventListener("focus", refreshTime);
    document.addEventListener("visibilitychange", refreshTime);
    const save = window.setInterval(() => {
      if (latest.current) commit(checkpointSession(latest.current, Date.now()));
    }, saveEveryMs);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(save);
      window.removeEventListener("focus", refreshTime);
      document.removeEventListener("visibilitychange", refreshTime);
    };
  }, [working, commit]);

  // 작업 중에만 폴더를 봅니다. 시작하는 순간 한 번 읽어 두어야 그 전에 들어온 파일이 이 작업의 파일로 잡히지 않아요.
  useEffect(() => {
    if (!working) return;
    let left = false;
    let count: number | null = null;
    let doorTried = false;
    const look = async () => {
      try {
        // 현관이 비어 있으면 묻지 않고 다운로드 폴더를 현관으로 둬요(앱이 맨 위층만 읽고 옮길 수 있게 열어 둬요). 방으로 쓰는 폴더면 두지 않아요.
        if (isNative() && !doorTried && (await getDoorstep()).folders.length === 0) {
          doorTried = true;
          await addDoorFolder(await downloadDir()).catch((error: unknown) => console.error(error));
        }
        const state = isNative() ? (await refreshDoorstep()).state : await getDoorstep();
        if (left) return;
        setDoor(state);
        if (isNative() && count !== null && count !== state.items.length) await emit(doorChanged);
        count = state.items.length;
      } catch (error) {
        console.error(error);
      }
    };
    // 첫 읽기에서 다운로드 폴더를 현관으로 둘 수 있어 그 뒤에 현관(맨 위층만)을 감시해요. 새 파일이 들어오면 타이머를 기다리지 않고 바로 읽어요.
    let unwatch: (() => void) | undefined;
    void look()
      .then(async () => {
        if (!isNative() || left) return;
        const stop = await watchFolder((await getDoorstep()).folders, () => void look(), false);
        if (left) stop();
        else unwatch = stop;
      })
      .catch((error: unknown) => console.error(error));
    const timer = window.setInterval(() => void look(), watchEveryMs);
    return () => {
      left = true;
      unwatch?.();
      window.clearInterval(timer);
    };
  }, [working]);

  // 작업 중에만 스크린샷 저장 폴더(맨 위층)를 봅니다. 시작할 때 있던 이름은 기준으로만 잡고, 그 뒤 새로 생긴 스크린샷만 골라요.
  // 그 폴더가 현관이기도 하면 현관 쪽이 이미 옮기니 여기서는 보지 않아요.
  useEffect(() => {
    if (!working || !isNative()) return;
    let left = false;
    let dir: string | null = null;
    let seen: string[] | undefined;
    const look = async () => {
      if (!dir) return;
      try {
        const read = await readDoorFolder(pathSource(dir), seen);
        seen = read.present;
        const found = read.found.filter((file) => isScreenshotName(file.name)).map((file): DoorItem => ({ ...file, id: `shot:${file.path}:${file.lastModified}`, folder: dir!, since: Date.now() }));
        if (!left && found.length > 0) setShots((before) => [...before, ...found]);
      } catch (error) {
        console.error(error);
      }
    };
    let unwatch: (() => void) | undefined;
    void (async () => {
      const found = await screenshotDir();
      if (left || !found || (await getDoorstep()).folders.some((folder) => sameFolder(folder, found))) return;
      dir = found;
      await look();
      const stop = await watchFolder(found, () => void look(), false);
      if (left) stop();
      else unwatch = stop;
    })().catch((error: unknown) => console.error(error));
    const timer = window.setInterval(() => void look(), watchEveryMs);
    return () => {
      left = true;
      unwatch?.();
      window.clearInterval(timer);
      setShots([]);
    };
  }, [working]);

  // 앱에서 방을 고치거나 지울 수 있어 틈틈이 다시 읽습니다. 작업하던 방을 지우거나 홈에서 빼면 작업도 끝나요. 그때까지의 시간은 일력에 남아요.
  useEffect(() => {
    const timer = window.setInterval(reloadRooms, watchEveryMs);
    return () => window.clearInterval(timer);
  }, [reloadRooms]);
  useEffect(() => {
    if (session && !rooms.some((item) => item.id === session.roomId && !item.care.done)) change(null);
  }, [rooms, session, change]);

  useEffect(() => {
    setPicking(false);
  }, [done]);
  useEffect(() => {
    // 받을 방을 고르는 동안은 알림을 닫지 않아요.
    if (!done || picking) return;
    const timer = window.setTimeout(() => setDone(null), pet.noticeSec * 1000);
    return () => window.clearTimeout(timer);
  }, [done, picking, pet.noticeSec]);

  const tellMain = () => {
    if (isNative()) emit(doorChanged).catch((error: unknown) => console.error(error));
  };

  // 파일은 '넣기'를 누른 것만 옮깁니다.
  // 작업 중 자동으로 옮긴 마지막 묶음. 메인 창 알림의 '되돌리기'가 이것을 되돌려요.
  const autoUndo = useRef<{ moves: { item: DoorItem; moved: DoorMove }[]; room: Room } | null>(null);
  async function bring(items: DoorItem[], target: Room, auto = false) {
    setFileBusy(true);
    const moves: { item: DoorItem; moved: DoorMove }[] = [];
    let problem: string | null = null;
    try {
      for (const item of items) {
        const { state, moved, error } = await bringIntoRoom(item, target);
        setDoor(state);
        if (moved) moves.push({ item, moved });
        problem ??= error;
      }
    } catch (error) {
      console.error(error);
      problem = "옮기지 못했어요. 폴더 권한을 확인해 주세요.";
    }
    setFileBusy(false);
    tellMain();
    // 옮긴 게 있으면 몇 개든 한 번에 되돌릴 수 있어요(T506). 일부만 옮겨졌으면 그 수와 문제를 함께 알려요.
    const undo = moves.length > 0 ? { moves, room: target } : undefined;
    const [only] = moves;
    if (problem) setDone({ text: moves.length > 0 ? `${moves.length}개는 옮겼어요. ${problem}` : problem, failed: true, undo });
    else if (moves.length === 1) setDone({ text: `${target.name} 방으로 옮겼어요.${only.moved.name === only.item.path ? "" : ` 이름이 같아 ${only.moved.name.normalize("NFC")}(으)로 두었어요.`}`, undo });
    else setDone({ text: `${target.name} 방으로 ${moves.length}개 옮겼어요.`, undo });
    // 자동으로 옮긴 건 홈에서 다른 방을 보고 있어도 알 수 있게 메인 창에도 알려요.
    if (auto && undo) {
      autoUndo.current = undo;
      const what = moves.length === 1 ? `‘${only.moved.name.normalize("NFC")}’을` : `새 파일 ${moves.length}개를`;
      void emit(workAutoMoved, `작업 중이라 ${what} ${target.name} 방으로 옮겼어요.`).catch((error: unknown) => console.error(error));
    }
    reloadRooms();
  }

  // 잘못 들어간 파일을 다른 방으로: 원래 폴더로 되돌린 뒤 고른 방에 넣어요. 되돌리기와 넣기를 그대로 이어 써서 새 이동은 없어요(2026-11-18 요청).
  async function sendElsewhere({ moves, room: from }: { moves: { item: DoorItem; moved: DoorMove }[]; room: Room }, to: Room) {
    setDone(null);
    setFileBusy(true);
    autoUndo.current = null;
    const back: DoorItem[] = [];
    let problem: string | null = null;
    for (const { item, moved } of [...moves].reverse()) {
      try {
        const { state, error } = await undoBring(item, moved, from);
        setDoor(state);
        if (error) problem ??= error;
        else back.unshift(item);
      } catch (error) {
        console.error(error);
        problem ??= "옮기지 못했어요. 폴더 권한을 확인해 주세요.";
      }
    }
    setFileBusy(false);
    if (back.length === 0) {
      setDone({ text: problem ?? "옮기지 못했어요.", failed: true });
      return;
    }
    await bring(back, to);
  }

  // 현관 줄에서만 뺍니다. 파일은 폴더에 그대로 있어요.
  async function skip(item: DoorItem) {
    try {
      setDoor(await patchDoorstep((state) => dropItem(state, item.id)));
      tellMain();
    } catch (error) {
      console.error(error);
    }
  }

  // 넣은 순서의 반대로 하나씩 되돌립니다. 하나가 실패해도 나머지는 계속해요.
  async function undo({ moves, room: target }: { moves: { item: DoorItem; moved: DoorMove }[]; room: Room }) {
    setDone(null);
    setFileBusy(true);
    let back = 0;
    let problem: string | null = null;
    for (const { item, moved } of [...moves].reverse()) {
      try {
        const { state, error } = await undoBring(item, moved, target);
        // 되돌린 파일을 다시 묻지 않게 줄에서는 빼 둡니다. 원래 폴더에 돌아가 있어요.
        setDoor(error ? state : await patchDoorstep((latest) => dropItem(latest, item.id)));
        if (error) problem ??= error;
        else back += 1;
      } catch (error) {
        console.error(error);
        problem ??= "되돌리지 못했어요. 폴더 권한을 확인해 주세요.";
      }
    }
    setFileBusy(false);
    const all = moves.length > 1 ? `${back}개를 ` : "";
    setDone(problem ? { text: back > 0 ? `${back}개는 되돌렸어요. ${problem}` : problem, failed: true } : { text: `${all}원래 폴더로 되돌렸어요.` });
    tellMain();
    reloadRooms();
  }

  // 아이콘 아래 작은 창 열기·닫기. 여는 순간 방 목록을 새로 읽어요.
  function openPanel() {
    reloadRooms();
    setNow(Date.now());
    setMotion(null);
    setPanelOpen(true);
    if (isNative()) invoke("set_panel_visible", { visible: true }).catch((error: unknown) => console.error(error));
  }
  function closePanel() {
    closedAt.current = Date.now();
    setPanelOpen(false);
    if (isNative()) invoke("set_panel_visible", { visible: false }).catch((error: unknown) => console.error(error));
  }
  function togglePanel() {
    if (panelOpen) closePanel();
    else if (Date.now() - closedAt.current > reopenGapMs) openPanel();
  }

  // 앱에서 방 이름이나 얼굴을 바꿨을 수 있어 돌아올 때마다 다시 읽습니다. 다른 곳을 누르면 메뉴를 닫아요.
  // 아이콘 아래 작은 창은 다른 곳을 누르면 닫혀요. 화면을 가리지 않게요.
  const onBlurPanel = useRef(() => {});
  onBlurPanel.current = () => {
    if (!pet.floating && panelOpen && !pulling.current) closePanel();
  };
  useEffect(() => {
    const onFocus = reloadRooms;
    const onBlur = () => {
      setMenuOpen(false);
      onBlurPanel.current();
    };
    // 막 연 창은 안의 단추에 포커스가 없어 main에 건 키는 오지 않아요. 창 전체에서 Esc를 들어요.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onBlurPanel.current();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
    };
  }, [reloadRooms]);

  // 프로도가 커서를 눈으로 따라가고, 창에 들어오면 손을 흔듭니다. 멈춤 상태에서는 자고 있어요.
  const sleeping = session?.status === "paused";
  useEffect(() => {
    if (!pet.floating || sleeping) {
      cue("pet", { look: null });
      return;
    }
    let inside = false;
    const see = (x: number, y: number, w: number, h: number) => {
      cue("pet", { look: { x, y } });
      const now = x >= 0 && y >= 0 && x < w && y < h;
      if (now && !inside) cue("pet", { body: "wave" });
      inside = now;
    };
    if (!isNative()) {
      const onMove = (event: globalThis.PointerEvent) => see(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
      window.addEventListener("pointermove", onMove);
      return () => window.removeEventListener("pointermove", onMove);
    }
    const win = getCurrentWindow();
    let last = "";
    const timer = window.setInterval(() => {
      void Promise.all([cursorPosition(), win.outerPosition(), win.scaleFactor()]).then(([at, origin, scale]) => {
        const key = `${at.x},${at.y},${origin.x},${origin.y}`;
        if (key === last) return;
        last = key;
        see((at.x - origin.x) / scale, (at.y - origin.y) / scale, window.innerWidth, window.innerHeight);
      }).catch((error: unknown) => console.error(error));
    }, cursorEveryMs);
    return () => window.clearInterval(timer);
  }, [pet.floating, sleeping]);

  // 작업 중에는 가끔 폴더를 살피듯 두리번거립니다.
  useEffect(() => {
    if (!working) return;
    let back = 0;
    const timer = window.setInterval(() => {
      cue("pet", { face: "lookL", ms: 500 });
      back = window.setTimeout(() => cue("pet", { face: "lookR", ms: 500 }), 600);
    }, glanceEveryMs);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(back);
    };
  }, [working]);

  // 내용 크기가 바뀔 때만 창 크기를 맞춰요. 매초 숫자가 바뀔 때 창을 다시 그리지 않아요.
  // 줄었다 커지는 동안은 움직이는 크기를 재지 않아요.
  useLayoutEffect(() => {
    const panel = root.current;
    if (!isNative() || !panel || motion) return;
    const win = getCurrentWindow();
    let lastWidth = 0;
    let lastHeight = 0;
    const resize = () => {
      const { width, height } = panel.getBoundingClientRect();
      const w = Math.ceil(width);
      const h = Math.ceil(height);
      if (w === lastWidth && h === lastHeight) return;
      lastWidth = w;
      lastHeight = h;
      win.setSize(new LogicalSize(w, h)).catch((error: unknown) => console.error(error));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(panel, { box: "border-box" });
    resize();
    return () => observer.disconnect();
  }, [motion]);

  function openMenu() {
    if (!menuOpen) reloadRooms();
    setMenuOpen(!menuOpen);
  }


  function onPointerDown(event: PointerEvent<HTMLElement>) {
    dragged.current = false;
    press.current = (event.target as Element).closest("[data-no-drag]") ? null : { x: event.clientX, y: event.clientY };
    if (press.current) cue("pet", { body: "stretch" });
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!pet.floating || !press.current || Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) < dragSlop) return;
    press.current = null;
    dragged.current = true;
    if (isNative()) getCurrentWindow().startDragging().catch((error: unknown) => console.error(error));
  }

  // 아이콘 아래 작은 창의 프로도를 끌어 밖으로 꺼내면 그 자리에서 띄워 두기가 켜지고, 손을 떼기 전까지 그대로 끌려와요(2026-11-17 요청, '띄워 두기' 단추 대신).
  // 같은 창이 작은 창 모양에서 프로도 모양으로 바뀌는 거라, 아이콘에서 미끄러져 나오는 움직임 없이 지금 자리에서 바로 끌어요.
  const pulling = useRef(false);
  function onPanelPointerDown(event: PointerEvent<HTMLElement>) {
    press.current = { x: event.clientX, y: event.clientY };
  }
  function onPanelPointerMove(event: PointerEvent<HTMLElement>) {
    if (!press.current || Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) < dragSlop) return;
    press.current = null;
    pulling.current = true;
    if (isNative()) getCurrentWindow().startDragging().catch((error: unknown) => console.error(error));
    setFloating(true);
    window.setTimeout(() => (pulling.current = false), 1000);
  }

  function openApp() {
    setMenuOpen(false);
    if (panelOpen) closePanel();
    invoke("show_main").catch((error: unknown) => console.error(error));
  }

  // 띄워 두기를 끄면 메뉴 막대 아이콘으로 들어가고, 그 뒤로는 아이콘을 누를 때만 아래에 작은 창이 열려요. 앱의 환경설정 스위치도 따라오게 알려요.
  function setFloating(floating: boolean, fromIcon = false) {
    setMenuOpen(false);
    setPanelOpen(false);
    // 띄워 둔 프로도가 아이콘으로 들어가는 동안은 프로도 모양을 그대로 둬요. 작은 창 판이 대신 미끄러져 들어가지 않게요.
    if (!floating && pet.floating) setMotion("tuck");
    const next = { ...pet, floating };
    setPet(next);
    void (async () => {
      try {
        await savePetSettings(next);
        await setPetVisible(floating, fromIcon);
        await emit(petSettingsChanged);
      } catch (error) {
        console.error(error);
      }
    })();
  }
  const hide = () => setFloating(false);
  // 들어가던 중에 다른 길(환경설정)로 다시 켜져도 프로도가 사라진 채로 남지 않게 합니다.
  useEffect(() => {
    if (pet.floating) setMotion((now) => (now === "tuck" ? null : now));
  }, [pet.floating]);

  // 메뉴 막대 아이콘을 누르면(tray-pet) 띄워 둔 창은 아이콘으로 들어가고, 아니면 아이콘 아래 작은 창을 열고 닫아요.
  // 아이콘 메뉴의 플로팅 창 보이기·숨기기(tray-float)는 띄워 두기를 켜고 꺼요. 설정이 바뀔 때마다 새 값으로 다시 들어요.
  const fromTray = useRef({ icon: () => {}, float: () => {}, start: () => {}, pause: () => {}, end: () => {}, startRoom: (_roomId: string) => {}, undoAuto: () => {} });
  fromTray.current = {
    icon: () => (pet.floating ? setFloating(false, true) : togglePanel()),
    float: () => setFloating(!pet.floating, true),
    // 메인 창 홈의 '작업 시작': 아이콘 창을 열고(띄워 뒀으면 그대로) 어느 방을 시작할지 묻는 메뉴를 펼쳐요.
    start: () => {
      if (!pet.floating) openPanel();
      if (!menuOpen) openMenu();
    },
    // 메인 창 홈의 멈춤(다시 시작)·끝내기.
    pause: () => session && change(working ? pauseSession(session, Date.now()) : resumeSession(session, Date.now())),
    end: () => session && endWork(session),
    // 메인 창 홈에서 고른 방. 이미 작업 중이면 무시해요(홈은 작업 중에 고르기를 보이지 않아요).
    startRoom: (roomId: string) => !session && rooms.some((item) => item.id === roomId) && start(roomId),
    // 메인 창 알림의 '되돌리기'. 한 번만 되돌려요.
    undoAuto: () => {
      const last = autoUndo.current;
      autoUndo.current = null;
      if (last && !fileBusy) void undo(last);
    },
  };
  useEffect(() => {
    if (!isNative()) return;
    let left = false;
    const stops: (() => void)[] = [];
    const add = (stop: () => void) => (left ? stop() : stops.push(stop));
    void listen("tray-pet", () => fromTray.current.icon()).then(add);
    void listen("tray-float", () => fromTray.current.float()).then(add);
    void listen(workStartAsked, () => fromTray.current.start()).then(add);
    void listen(workPauseAsked, () => fromTray.current.pause()).then(add);
    void listen(workEndAsked, () => fromTray.current.end()).then(add);
    void listen<string>(workStartRoom, (event) => fromTray.current.startRoom(event.payload)).then(add);
    void listen(workAutoUndo, () => fromTray.current.undoAuto()).then(add);
    // 나오는 동작은 시간으로 끝냅니다. 움직임 줄이기에서는 애니메이션이 아예 돌지 않아 끝났다는 신호가 오지 않아요.
    let settle = 0;
    void listen<"tuck" | "untuck">("pet-motion", (event) => {
      window.clearTimeout(settle);
      setMotion(event.payload);
      // 들어가는 동작도 시간으로 끝내요. 끝난 뒤에야 작은 창 판으로 바뀌고 창 크기도 다시 맞춰요.
      settle = window.setTimeout(() => setMotion((now) => (now === event.payload ? null : now)), untuckMs);
    }).then(add);
    return () => {
      left = true;
      window.clearTimeout(settle);
      for (const stop of stops) stop();
    };
  }, []);

  // 웹에서 끌어 온 그림·파일 링크를 프로도에 놓으면 내려받아 작업 중인 방 폴더 맨 위에 저장해요(2026-11-19 요청). 되돌리면 그 새 파일을 휴지통으로 보내요.
  function droppedUrl(data: DataTransfer): string | null {
    const lines = `${data.getData("text/uri-list")}\n${data.getData("text/plain")}`.split(/\r?\n/).map((line) => line.trim());
    return lines.find((line) => /^https?:\/\//i.test(line)) ?? null;
  }
  async function saveDropped(url: string) {
    if (!working || !room || !roomLinked || !room.origin) {
      setDone({ text: "작업을 시작하면 그 방에 저장해요.", failed: true });
      return;
    }
    setDone(null);
    setFileBusy(true);
    try {
      const name = await freeDoorName(folderMover(room.origin), downloadName(url));
      const result = name ? await saveDownload(room.origin, name, url) : { ok: false as const, message: "방 폴더에 둘 이름을 정하지 못했어요." };
      setDone(result.ok ? { text: `${room.name} 방에 ${name!.normalize("NFC")}(으)로 저장했어요.`, saved: { root: room.origin, name: name! } } : { text: result.message, failed: true });
    } catch (error) {
      console.error(error);
      setDone({ text: "내려받지 못했어요.", failed: true });
    }
    setFileBusy(false);
    reloadRooms();
  }
  async function undoSaved({ root: folder, name }: { root: string; name: string }) {
    setFileBusy(true);
    try {
      await trashFile(folder, name);
      setDone({ text: "저장한 파일을 휴지통으로 보냈어요." });
    } catch (error) {
      console.error(error);
      setDone({ text: "휴지통으로 보내지 못했어요.", failed: true });
    }
    setFileBusy(false);
    reloadRooms();
  }
  const dropProps = {
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      if (!dropping) setDropping(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropping(false);
      const url = droppedUrl(event.dataTransfer);
      if (url && !fileBusy) void saveDropped(url);
      else if (!url) setDone({ text: "웹의 그림이나 파일 링크를 놓아 주세요.", failed: true });
    },
  };

  const choices = rooms.filter((item) => !item.care.done);
  // '다른 방으로'에서 고를 수 있는 방: 폴더를 연결한 다른 방(지금 넣은 방은 빼요).
  const elsewhere = done?.undo ? doorTargets(rooms, done.undo.moves[0].item).filter((item) => item.id !== done.undo!.room.id) : [];
  const incoming = room ? arrivals((door ?? emptyDoorstep).items, session).filter((item) => doorTargets([room], item).length > 0) : [];
  const roomLinked = room !== null && room.source === "handle" && Boolean(room.origin);
  // 작업 중에 현관으로 새 파일이 오면 묻지 않고 지금 방으로 옮겨요(덮어쓰지 않고, '되돌리기'가 남아요).
  // 한 번 시도한 파일은 다시 자동으로 옮기지 않아요. 못 옮긴 파일만 아래 '넣기·빼기'로 물어요.
  const autoTried = useRef(new Set<string>());
  useEffect(() => {
    if (!working || !room || !roomLinked || fileBusy) return;
    const fresh = [...incoming, ...shots].filter((item) => !autoTried.current.has(item.id));
    if (fresh.length === 0) return;
    fresh.forEach((item) => autoTried.current.add(item.id));
    void bring(fresh, room, true);
  }, [working, room?.id, roomLinked, fileBusy, incoming.map((item) => item.id).join(), shots]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = session ? session.status : "off";
  const pose: DuctPose = dropping ? "offer" : fileBusy ? "move" : done?.failed ? "shock" : incoming.length > 0 ? "offer" : done ? "done" : !session ? "idle" : working ? "watch" : "rest";
  const panel = !pet.floating && motion !== "tuck";

  // 아이콘 창을 닫아 둔 채로 새 파일이 오거나 상태를 물을 때가 되면 아이콘에 점을 찍어요. 열면 지워요.
  const dot = isNative() && panel && !panelOpen && (incoming.length > 0 || asking || sweepNotice !== null);
  // 알림을 한 번 보여 줬으면(창이 열려 있었으면) 다시 켜도 또 띄우지 않아요.
  useEffect(() => {
    if (sweepNotice === null || sweepSeen.current || !(panelOpen || pet.floating)) return;
    sweepSeen.current = true;
    setSweepNoticeAt(Date.now()).catch((error: unknown) => console.error(error));
  }, [sweepNotice, panelOpen, pet.floating]);
  useEffect(() => {
    if (isNative()) invoke("set_tray_dot", { on: dot }).catch((error: unknown) => console.error(error));
  }, [dot]);
  // 작업 중이면 메뉴 막대 프로도 얼굴의 검은 구멍을 작업하는 방의 얼굴색으로 칠해요. 멈추거나 끝내면 원래 얼굴로 돌아가요.
  const workColor = working && room ? cssToken(`--face-${room.face.color + 1}`) : null;
  useEffect(() => {
    if (isNative()) invoke("set_tray_working", { color: workColor }).catch((error: unknown) => console.error(error));
  }, [workColor]);

  function start(roomId: string) {
    setMenuOpen(false);
    change(startSession(roomId, Date.now()));
  }

  function endWork(current: Session) {
    setMenuOpen(false);
    if (isNative()) emit(sessionEnded, current.roomId).catch((error: unknown) => console.error(error));
    change(null);
  }
  const quit = () => invoke("quit_app").catch((error: unknown) => console.error(error));
  const art = (px: number) => (
    <span className="pet-breathe">
      <span key={pose} className="pet-pose">
        <PoseArt pose={pose} actor="pet" mood={asking ? "tilt" : menuOpen ? "lookD" : poseFace[pose]} parts={room ? kindParts(room.things) : []} px={px} foot={room ? faceColorVar(room.face.color) : undefined} paper={incoming[0] ? kindTones[incoming[0].kind].pale : undefined} />
      </span>
    </span>
  );
  // 새 파일 넣기, 옮긴 결과와 되돌리기, 폴더 고르기, 상태 묻기. 두 모양이 함께 써요.
  const asks = (
    <>
      {incoming.length > 0 && room && (
        <div className="pet-ask" data-no-drag>
          <p role="status">새 파일{incoming.length > 1 ? ` ${incoming.length}개` : ""}</p>
          <strong title={incoming[0].name}>{incoming[0].name}</strong>
          <small>{room.name} 방으로 옮길까요?</small>
          <div>
            <button type="button" className="primary" disabled={fileBusy} onClick={() => void bring([incoming[0]], room)}>넣기</button>
            <button type="button" disabled={fileBusy} onClick={() => void skip(incoming[0])}>빼기</button>
          </div>
          {incoming.length > 1 && <button type="button" disabled={fileBusy} onClick={() => void bring(incoming, room)}>{incoming.length}개 모두 넣기</button>}
        </div>
      )}
      {done && (
        <div className="pet-ask" data-no-drag>
          <p role="status">{done.text}</p>
          {done.saved && <button type="button" disabled={fileBusy} onClick={() => void undoSaved(done.saved!)}>되돌리기</button>}
          {done.undo && !picking && (
            <div>
              <button type="button" disabled={fileBusy} onClick={() => void undo(done.undo!)}>{done.undo.moves.length > 1 ? `${done.undo.moves.length}개 되돌리기` : "되돌리기"}</button>
              {elsewhere.length > 0 && <button type="button" disabled={fileBusy} onClick={() => setPicking(true)}>다른 방으로</button>}
            </div>
          )}
          {done.undo && picking && (
            <div className="pet-pick" role="group" aria-label="옮길 방">
              {elsewhere.map((target) => <button key={target.id} type="button" disabled={fileBusy} onClick={() => void sendElsewhere(done.undo!, target)}>{target.name}</button>)}
              <button type="button" className="quiet" onClick={() => setPicking(false)}>취소</button>
            </div>
          )}
        </div>
      )}
      {asking && session && (
        <div className="pet-ask" data-no-drag>
          <p role="status">{working ? "계속 작업 중인가요?" : "다시 시작할까요?"}</p>
          <div>
            <button type="button" onClick={() => change(working ? checkpointSession(session, Date.now()) : resumeSession(session, Date.now()))}>{working ? "계속" : "다시 시작"}</button>
            <button type="button" onClick={() => (working ? change(pauseSession(session, Date.now())) : setAsking(false))}>{working ? "멈춤" : "계속 멈춤"}</button>
          </div>
        </div>
      )}
    </>
  );

  // 이번 주 정리 알림: 프로도 바로 아래 말풍선으로, 프로도 말투(반말)예요. 꼬리는 위의 프로도를 가리켜요.
  const sweepBubble = sweepNotice !== null && (
    <div className="pet-ask frodo-bubble tail-up" data-no-drag>
      <p role="status">안 쓴 파일이나 방이 {sweepNotice}개 있어. 지금 정리할까?</p>
      <div>
        <button
          type="button"
          className="primary"
          onClick={() => {
            dismissSweep(false);
            if (isNative()) emit(sweepOpenAsked).catch((error: unknown) => console.error(error));
          }}
        >
          보기
        </button>
        <button type="button" onClick={() => dismissSweep(true)}>다음에</button>
      </div>
    </div>
  );

  // 시작할 방 고르기. 방마다 얼굴 색 알약과 작은 주름관이라 한눈에 골라요. 누르면 바로 시간을 재요.
  const roomPills = (
    <ul className="pet-rooms">
      {choices.map((item) => (
        <li key={item.id}>
          <button type="button" className="pet-room" style={{ "--room-color": faceColorVar(item.face.color) } as CSSProperties} onClick={() => start(item.id)}>
            <RoomFaceArt face={item.face} px={22} className="pet-room-art" />
            <span>{item.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  // 아이콘 아래 작은 창: 지금 상태, 시작·멈춤·끝, 묻는 것, 아래에 앱 열기·끄기. 프로도를 끌어내면 띄워 둬요. Esc나 다른 곳을 누르면 닫혀요.
  if (panel) {
    return (
      <main ref={root} className={`pet pet-panel pet-${state}`} {...dropProps}>
        <div className="pet-card">
          <header className="pet-panel-head">
            <span className="pet-panel-art" aria-hidden="true" title="끌어서 화면에 띄워 두기" onPointerDown={onPanelPointerDown} onPointerMove={onPanelPointerMove} onPointerUp={() => (press.current = null)}>{art(panelPx)}</span>
            <p className="pet-status" role="status">
              {session ? (
                <>
                  <strong>{working ? "작업 중" : "멈춤"}</strong>
                  <time>{formatWorked(workedTime(session, now))}</time>
                  {room && <small><Meta items={[room.name, !roomLinked && "파일 연결 안 됨"]} /></small>}
                </>
              ) : (
                <>
                  <strong>작업 전</strong>
                </>
              )}
            </p>
          </header>
          {sweepBubble}
          {session ? (
            <div className="pet-panel-row">
              <button type="button" className="primary" onClick={() => change(working ? pauseSession(session, Date.now()) : resumeSession(session, Date.now()))}>{working ? "멈춤" : "다시 시작"}</button>
              <HoldToEnd onEnd={() => endWork(session)} />
            </div>
          ) : choices.length > 0 ? (
            <div className="pet-panel-rooms" role="group" aria-label="작업할 방">
              {roomPills}
            </div>
          ) : (
            <p className="pet-panel-note">진행 중인 방이 없어요. 앱에서 방을 만들어 주세요.</p>
          )}
          {asks}
          {memoOpen && <QuickMemo onClose={() => setMemoOpen(false)} />}
          <footer className="pet-panel-foot">
            <button type="button" aria-expanded={memoOpen} onClick={() => setMemoOpen((open) => !open)}>{memoOpen ? "메모 접기" : "메모"}</button>
            {isNative() && <button type="button" onClick={openApp}>앱 열기</button>}
            {isNative() && <button type="button" onClick={() => void quit()}>Folduct 끄기</button>}
          </footer>
        </div>
      </main>
    );
  }

  return (
    <main ref={root} className={`pet pet-${state}${motion ? ` pet-${motion}` : ""}`} {...dropProps} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => {
      if (press.current) cue("pet", { body: "hop" });
      press.current = null;
    }}>
      <button
        type="button"
        className="pet-vase"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={room ? `${room.name} 메뉴` : "Folduct 메뉴"}
        onClick={() => {
          if (!dragged.current) openMenu();
        }}
      >
        {art(petPx)}
      </button>
      {sweepBubble}
      {session ? (
        <div className="pet-bar">
          <p className="pet-status" role="status">
            <strong>{working ? "작업 중" : "멈춤"}</strong>
            <time>{formatWorked(workedTime(session, now))}</time>
            {room && <small><Meta items={[room.name, !roomLinked && "파일 연결 안 됨"]} /></small>}
          </p>
          <button type="button" className="pet-toggle" data-no-drag onClick={() => change(working ? pauseSession(session, Date.now()) : resumeSession(session, Date.now()))}>
            {working ? "멈춤" : "다시 시작"}
          </button>
        </div>
      ) : (
        <button type="button" className="pet-start" data-no-drag aria-haspopup="menu" aria-expanded={menuOpen} onClick={openMenu}>작업 시작</button>
      )}
      {asks}
      {menuOpen && (
        <div className="pet-menu" data-no-drag>
          {!session && (
            choices.length > 0 ? (
              <>
                {roomPills}
              </>
            ) : (
              <p>진행 중인 방이 없어요. 앱에서 방을 만들어 주세요.</p>
            )
          )}
          {session && <HoldToEnd onEnd={() => endWork(session)} />}
          {isNative() && <button type="button" onClick={openApp}>앱 열기</button>}
          {isNative() && <button type="button" onClick={hide}>숨기기</button>}
          {isNative() && <button type="button" onClick={() => void quit()}>Folduct 끄기</button>}
        </div>
      )}
    </main>
  );
}
