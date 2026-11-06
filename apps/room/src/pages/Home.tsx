import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu } from "../components/ContextMenu";
import { createEngine, EngineContext, type HomeActions } from "../components/home/engine";
import { HeroScene } from "../components/home/HeroScene";
import { HomeHeader } from "../components/home/HomeHeader";
import { Icon } from "../components/Icon";
import { FrodoGuide } from "../components/FrodoGuide";
import { NewRoomDialog } from "../components/NewRoomDialog";
import { RoomSettingsDialog } from "../components/RoomSettingsDialog";
import { cue } from "../components/useFrodo";
import { HomeMenu } from "../components/HomeMenu";
import { HomeRoomsDialog } from "../components/HomeRoomsDialog";
import { SettingsDialog } from "../components/SettingsDialog";
import { SweepDialog } from "../components/SweepDialog";
import { useToast } from "../components/Toast";
import { doneOfferDue, mergeScan, sweepDue } from "../domain/care";
import { doorTargets, dropItem, emptyDoorstep, restoreItem, type DoorItem, type Doorstep } from "../domain/doorstep";
import { buildRoom, doneAfterDays, looksDone, parseRoomsFile } from "../domain/importFile";
import type { Room } from "../domain/model";
import type { WorkLog } from "../domain/worklog";
import { homeLimit, roomStats } from "../domain/sky";
import { doorChanged, isNative, sessionEnded, workLogged } from "../gateways/native";
import { planSweep, refreshRooms, type SweepPlan } from "../storage/box";
import { forgetRoom, getDoorstep, getLastSweepAt, getWorkLog, listRooms, patchDoorstep, patchRoom, saveRoom, setLastSweepAt } from "../storage/db";
import { assignDoorItem, refreshDoorstep, undoDoorMove } from "../storage/doorstep";
import { sampleRooms } from "../storage/sample";

// 파일 보기는 방 화면과 같은 묶음이라 첫 화면에 싣지 않습니다.
const QuickViewer = lazy(() => import("../components/QuickViewer").then((m) => ({ default: m.QuickViewer })));

// 주간 정리는 앱을 켤 때 한 번만 저절로 뜹니다. 창으로 돌아올 때는 시각만 새로 고치고, 밀린 정리는 주간 정리 버튼 글자로 알립니다.
let sweepChecked = false;
// 현관 폴더도 앱을 켤 때 한 번만 읽습니다. 방에서 돌아오면 저장된 줄을 그대로 보여 줘요.
let doorChecked = false;

const scanCommand = "node apps/room/scripts/scan-folders.mjs --out folduct-rooms.json 폴더1 폴더2…";

// 그 방의 주름관으로 포커스를 옮깁니다. 주름관이 없으면 지도로 들어오는 자리(첫 주름관이나 빈 지도의 버튼)로요.
function landFocus(id: string) {
  (document.querySelector<HTMLElement>(`.room-node[data-room-id="${CSS.escape(id)}"]`) ?? document.querySelector<HTMLElement>('.room-node[tabindex="0"], .sky-empty button'))?.focus();
}

export function Home({ returnTo, entered, onOpen }: { returnTo: string | null; entered: boolean; onOpen: (id: string) => void }) {
  const [engine] = useState(() => createEngine());
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastSweepAt, setLastSweep] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [viewing, setViewing] = useState<{ roomId: string; thingId: string } | null>(null);
  const [plans, setPlans] = useState<SweepPlan[] | null>(null);
  const [offers, setOffers] = useState<Room[]>([]);
  // 방에서 돌아오면 패널 없이 주름관을 고르는 첫 화면으로 옵니다.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 패널이 닫히며 미끄러지는 동안에도 내용이 남도록 마지막으로 고른 방을 기억합니다.
  const [panelId, setPanelId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [roomMenu, setRoomMenu] = useState<{ id: string; opener: HTMLElement; x: number; y: number } | null>(null);
  const [roomSettingsId, setRoomSettingsId] = useState<string | null>(null);
  const [door, setDoor] = useState<Doorstep>(emptyDoorstep);
  const [workLog, setWorkLog] = useState<WorkLog>({});
  const [doorMenu, setDoorMenu] = useState<{ id: string; opener: HTMLElement; x: number; y: number } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const rereading = useRef(false);
  // 방금 홈에 올린 방. 자리가 모자라도 그 방을 먼저 골라 둡니다.
  const raised = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const { toast, toastRegion } = useToast();

  const load = useCallback(async () => {
    try {
      const list = await listRooms();
      setRooms(list);
      setLoadFailed(false);
      return list;
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
      return null;
    }
  }, []);

  // 폴더를 다시 읽고 정리할 게 있으면 정리 창을 띄웁니다. 없으면 false예요.
  const findSweep = useCallback(async (list?: Room[]) => {
    const due = await planSweep(list);
    const fresh = (await load()) ?? [];
    const asks = fresh.filter((room) => (!list || list.some((item) => item.id === room.id)) && doneOfferDue(room, Date.now()));
    if (due.length === 0 && asks.length === 0) return false;
    setOffers(asks);
    setPlans(due);
    return true;
  }, [load]);

  const start = useCallback(async () => {
    const list = await load();
    if (!list) return;
    try {
      const last = await getLastSweepAt();
      if (last === null) {
        const at = Date.now();
        await setLastSweepAt(at);
        setLastSweep(at);
        return;
      }
      setLastSweep(last);
      if (sweepChecked) return;
      sweepChecked = true;
      if (!sweepDue(last, Date.now())) return;
      await findSweep(list);
    } catch (error) {
      // 정리 확인이 안 돼도 방은 그대로 씁니다.
      console.error(error);
    }
  }, [load, findSweep]);

  useEffect(() => {
    document.title = "Folduct · 내 방들";
    void start();
  }, [start]);

  // 현관을 읽지 못해도 방은 그대로 씁니다. 저장된 줄을 먼저 보여 주고 폴더는 뒤에서 읽어요.
  useEffect(() => {
    void (async () => {
      try {
        setDoor(await getDoorstep());
        if (doorChecked || !isNative()) return;
        doorChecked = true;
        const { state, failed } = await refreshDoorstep();
        setDoor(state);
        if (failed > 0) toast(`현관 폴더 ${failed}개를 읽지 못했어요. 환경설정에서 확인해 주세요.`);
      } catch (error) {
        console.error(error);
      }
    })();
  }, [toast]);

  useEffect(() => {
    getWorkLog().then(setWorkLog, (error: unknown) => console.error(error));
  }, []);

  // 플로팅 창이 파일을 옮겼거나 작업을 끝냈을 때입니다. 끝낸 방에 치울 파일이 있으면 정리 창을 띄워요.
  useEffect(() => {
    if (!isNative()) return;
    let left = false;
    const stops: (() => void)[] = [];
    const add = (stop: () => void) => {
      if (left) stop();
      else stops.push(stop);
    };
    void listen(workLogged, () => void getWorkLog().then(setWorkLog, (error: unknown) => console.error(error))).then(add);
    void listen(doorChanged, () => {
      void getDoorstep().then(setDoor, (error: unknown) => console.error(error));
      void load();
    }).then(add);
    void listen<string>(sessionEnded, (event) => {
      void (async () => {
        const room = (await load())?.find((item) => item.id === event.payload);
        if (room && (await findSweep([room]))) await invoke("show_main");
      })().catch((error: unknown) => console.error(error));
    }).then(add);
    return () => {
      left = true;
      for (const stop of stops) stop();
    };
  }, [load, findSweep]);

  // 켤 때와 창으로 돌아올 때 폴더를 다시 읽어 밖에서 넣은 파일을 보여 줍니다. 권한이 풀린 방은 건너뛰어요(묻는 건 그 방에 들어갔을 때).
  useEffect(() => {
    const reread = async () => {
      if (rereading.current) return;
      rereading.current = true;
      try {
        if ((await refreshRooms(await listRooms())) > 0) await load();
      } catch (error) {
        console.error(error);
      } finally {
        rereading.current = false;
      }
    };
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      void reread();
    };
    void reread();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // 지운 방이 골라져 있으면 고르지 않은 것으로 봅니다.
  const selected = rooms?.find((room) => room.id === selectedId) ?? null;

  if (selected && selected.id !== panelId) setPanelId(selected.id);

  // 패널을 닫으면 포커스가 갈 곳을 잃으니, 방금 본 방의 주름관으로 돌려줍니다. 다른 곳에 있는 포커스는 빼앗지 않습니다.
  // 새로 연 방은 패널 맨 위부터 보여 줍니다. 파일을 눌러 열면 그 줄로 가는 스크롤을 두고요.
  useEffect(() => {
    if (selected) {
      if (!focusId) panel.current?.scrollTo(0, 0);
      return;
    }
    if (!panelId || engine.target !== 0) return;
    const active = document.activeElement;
    if (!active || active === document.body || panel.current?.contains(active)) landFocus(panelId);
  }, [selected?.id]);

  // 줄에서 고르면 맨 위로 돌아옵니다.
  const selectRoom = useCallback((id: string | null) => {
    setSelectedId(id);
    setFocusId(null);
    if (id) engine.goTo(0);
  }, [engine]);

  // 패널 글자나 별을 눌러 포커스가 패널 밖으로 나가도 Esc로 닫습니다. 대화상자와 오른쪽 클릭 메뉴가 먼저예요.
  const panelOpen = selected !== null;
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open]")) selectRoom(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen, selectRoom]);
  const focusThing = useCallback((roomId: string, thingId: string) => {
    setSelectedId(roomId);
    setFocusId(thingId);
    engine.goTo(0);
  }, [engine]);

  // 불러오는 중이거나 실패하면 움직일 게 없습니다.
  const ready = rooms !== null && !loadFailed;
  // 방에서 돌아오면 들어갔던 주름관으로 포커스를 돌려줍니다.
  useEffect(() => {
    if (ready && returnTo) landFocus(returnTo);
  }, [ready]);
  useEffect(() => {
    if (ready) return engine.attach();
  }, [engine, ready]);

  // 방이 하나도 없으면 움직일 게 없습니다.
  const noRooms = rooms?.length === 0;
  useEffect(() => engine.lock(noRooms), [engine, noRooms]);

  // 줄로 향하면 고른 방은 닫습니다. 남겨 두면 돌아올 때 패널이 다시 열리며 포커스를 가져가요.
  useEffect(() => {
    if (!selected) return;
    return engine.subscribe(() => {
      if (engine.target !== 0) selectRoom(null);
    });
  }, [engine, !selected, selectRoom]);

  const openRoomMenu = useCallback((id: string, opener: HTMLElement, x: number, y: number) => setRoomMenu({ id, opener, x, y }), []);
  const openDoorMenu = useCallback((id: string, opener: HTMLElement, x: number, y: number) => setDoorMenu({ id, opener, x, y }), []);
  useEffect(() => {
    if (!roomMenu || roomMenu.opener.closest("dialog")) return;
    return engine.subscribe(() => setRoomMenu(null));
  }, [engine, roomMenu]);
  useEffect(() => {
    if (!doorMenu) return;
    return engine.subscribe(() => setDoorMenu(null));
  }, [engine, doorMenu]);

  const stats = useMemo(() => roomStats(rooms ?? [], now), [rooms, now]);
  const kinds = useMemo(() => new Set((rooms ?? []).flatMap((room) => room.things.map((thing) => thing.kind))), [rooms]);
  let staleFiles = 0;
  for (const stat of stats.values()) staleFiles += stat.stale;
  const overdue = sweepDue(lastSweepAt, now) && (staleFiles > 0 || (rooms ?? []).some((room) => doneOfferDue(room, now)));

  const fail = (message: string) => (error: unknown) => {
    console.error(error);
    toast(message);
  };

  async function openSweep() {
    toast("폴더를 다시 보는 중…");
    if (!(await findSweep(rooms ?? undefined))) toast("지금은 정리할 파일이 없어요.");
  }

  async function addSample() {
    const samples = sampleRooms(Date.now());
    for (const room of samples) await saveRoom(room);
    setRooms((list) => [...(list ?? []), ...samples]);
    selectRoom(samples[0].id);
    toast(`샘플 방 ${samples.length}개를 띄웠어요.`);
  }

  // 샘플 방은 한 번에 치우고, 잠깐 동안 되돌릴 수 있습니다.
  async function clearSamples() {
    const samples = (rooms ?? []).filter((room) => room.source === "sample");
    await Promise.all(samples.map((room) => forgetRoom(room.id)));
    const gone = new Set(samples.map((room) => room.id));
    setRooms((list) => list && list.filter((room) => !gone.has(room.id)));
    toast(`샘플 방 ${samples.length}개를 치웠어요.`, {
      label: "되돌리기",
      run: () =>
        void Promise.all(samples.map((room) => saveRoom(room)))
          .then(load)
          .then(() => {
            toast(`샘플 방 ${samples.length}개를 되돌렸어요.`);
            requestAnimationFrame(() => {
              if (document.activeElement === document.body) landFocus(samples[0].id);
            });
          })
          .catch(fail("샘플 방을 되돌리지 못했어요.")),
    });
  }

  // scan-folders 스크립트가 만든 목록으로 방을 한꺼번에 띄웁니다. 이미 있는 폴더는 새로 만들지 않고 다시 봅니다.
  async function importRooms(file: File) {
    const parsed = parseRoomsFile(await file.text());
    if (!parsed) {
      toast(`Folduct 목록 파일이 아니에요. 터미널에서 ${scanCommand} 로 만든 파일을 골라 주세요.`);
      return;
    }
    const at = Date.now();
    const existing = new Map((rooms ?? []).filter((room) => room.origin).map((room) => [room.origin!, room]));
    const taken = (rooms ?? []).map((room) => room.face);
    let added = 0;
    let refreshed = 0;
    let done = 0;
    for (const item of parsed.rooms) {
      const old = existing.get(item.origin);
      if (old) {
        await saveRoom(mergeScan(old, item.files, item, at));
        refreshed += 1;
        continue;
      }
      const finished = looksDone(item.files, at);
      if (finished) done += 1;
      const built = buildRoom({ taken, name: item.name, source: "input", rootName: item.name, origin: item.origin, files: item.files, scan: item, done: finished, workDays: [], now: at });
      taken.push(built.face);
      await saveRoom(built);
      added += 1;
    }
    toast(
      `새 방 ${added}개${refreshed ? `, 다시 본 방 ${refreshed}개` : ""}를 띄웠어요.` +
        (done ? ` 그중 ${done}개는 ${doneAfterDays}일 넘게 쓰거나 고친 파일이 없어 홈에서 빼 두었어요. 메뉴에서 고르면 바꿀 수 있어요.` : "") +
        (parsed.skipped ? ` 읽을 수 없는 항목 ${parsed.skipped}개는 뺐어요.` : ""),
    );
    await load();
  }

  // 실제 폴더는 그대로 두고 앱 안의 표시만 바꿉니다. 되돌리기는 나중에 불리니 옛 목록을 읽지 않게 바꿀 값을 받습니다.
  async function moveRoom(id: string, done: boolean) {
    raised.current = done ? null : id;
    const saved = await patchRoom(id, (room) => ({ ...room, care: { ...room.care, done } }));
    setRooms((list) => list && list.map((room) => (room.id === id ? saved : room)));
    // 고른 방이 옮겨 가면 고르기를 풀어 카메라를 제자리로 돌립니다.
    setSelectedId((current) => (current === id ? null : current));
    setFocusId((current) => (saved.things.some((thing) => thing.id === current) ? null : current));
    toast(done ? "홈에서 뺐어요. 폴더와 파일은 그대로예요." : "홈에 올렸어요.", {
      label: "되돌리기",
      run: () => void moveRoom(id, !done).catch(fail(saveFailed)),
    });
    // 주름관이 사라져 포커스를 잃었으면 지도로 이어 줍니다.
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) landFocus(id);
    });
  }

  // 고르지 않은 방을 홈에서 뺍니다. 저장에 실패하면 창이 남아 다시 고를 수 있어요.
  async function keepOnHome(keep: Set<string>) {
    const out = (rooms ?? []).filter((room) => !room.care.done && !keep.has(room.id));
    try {
      for (const room of out) await patchRoom(room.id, (current) => ({ ...current, care: { ...current.care, done: true } }));
      setSelectedId((current) => (out.some((room) => room.id === current) ? null : current));
      toast(`${out.length}개를 홈에서 뺐어요. 메뉴의 방 목록에 있고, 폴더와 파일은 그대로예요.`);
    } catch (error) {
      fail(saveFailed)(error);
    }
    await load();
  }

  // 누른 버튼이 사라졌으니 포커스를 줄의 다음 문서나 지도로 이어 줍니다.
  function landDoorFocus() {
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) (document.querySelector<HTMLElement>(".door-item") ?? document.querySelector<HTMLElement>('.room-node[tabindex="0"]'))?.focus();
    });
  }

  // 줄에서만 뺍니다. 파일은 폴더에 그대로 있어요.
  async function keepInPlace(item: DoorItem) {
    setDoor(await patchDoorstep((state) => dropItem(state, item.id)));
    toast("줄에서 뺐어요. 파일은 제자리에 있어요.", {
      label: "되돌리기",
      run: () => void patchDoorstep((state) => restoreItem(state, item)).then(setDoor).catch(fail(saveFailed)),
    });
    landDoorFocus();
  }

  async function assignToRoom(item: DoorItem, room: Room) {
    const { state, moved, error } = await assignDoorItem(item, room.origin!);
    setDoor(state);
    landDoorFocus();
    if (!moved) {
      toast(error ?? moveFailed);
      return;
    }
    const renamed = moved.name === item.path ? "" : ` 같은 이름이 있어 ${moved.name.normalize("NFC")}(으)로 두었어요.`;
    toast(`${room.name} 방으로 옮겼어요.${renamed} 방을 열면 선반에 있어요.`, {
      label: "되돌리기",
      run: () =>
        void undoDoorMove(item, moved)
          .then((undone) => {
            setDoor(undone.state);
            toast(undone.error ?? "현관으로 되돌렸어요.");
          })
          .catch(fail(moveFailed)),
    });
  }

  // 메뉴의 동작은 메뉴를 닫고 실행합니다. 대화상자와 알림이 메뉴 뒤에 가리지 않게요.
  const fromMenu = (run: () => void) => () => {
    setMenuOpen(false);
    run();
  };

  const saveFailed = "저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.";
  const moveFailed = "옮기지 못했어요. 폴더 권한을 확인해 주세요.";
  const hasSample = rooms?.some((room) => room.source === "sample");
  const onHome = (rooms ?? []).filter((room) => !room.care.done);
  const menuRoom = rooms?.find((room) => room.id === roomMenu?.id);
  const settingsRoom = rooms?.find((room) => room.id === roomSettingsId);
  const menuDoor = door.items.find((item) => item.id === doorMenu?.id);
  const viewingRoom = rooms?.find((room) => room.id === viewing?.roomId);
  const viewingThing = viewingRoom?.things.find((thing) => thing.id === viewing?.thingId);
  const actions: HomeActions = {
    selectRoom,
    focusThing,
    openRoom: onOpen,
    openSweep: () => void openSweep().catch(fail("정리할 파일을 찾지 못했어요. 잠시 뒤 다시 해 주세요.")),
    openFile: (roomId, thingId) => setViewing({ roomId, thingId }),
    openNew: () => setCreating(true),
    openMenu: () => setMenuOpen(true),
    importList: isNative() ? null : () => importInput.current?.click(),
    addSample: () => void addSample().catch(fail(saveFailed)),
    clearSamples: () => void clearSamples().catch(fail("샘플 방을 치우지 못했어요. 잠시 뒤 다시 해 주세요.")),
    roomMenu: openRoomMenu,
    toggleDone: (id, done) => void moveRoom(id, done).catch(fail(saveFailed)),
  };
  const scene = rooms && { rooms, stats, now, actions };
  return (
    <main className="home">
      <EngineContext.Provider value={engine}>
        <div className="home-stage">
          {/* 머리를 앞에 두어 탭 키가 머리에서 살아 있는 장면으로 이어집니다. 겹치는 순서는 z-index가 정해요. */}
          <FrodoGuide />
          <HomeHeader rooms={rooms ?? []} ready={ready} overdue={overdue} onWeekly={actions.openSweep} onMenu={() => setMenuOpen(true)} onNew={() => setCreating(true)} onSettings={() => setSettingsOpen(true)} />
          <div className="home-sheet">
            {loadFailed ? (
              <div className="scene page-status" role="alert">
                <p>저장소를 열지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.</p>
                <button type="button" onClick={() => { setLoadFailed(false); void start(); }}>다시 시도</button>
              </div>
            ) : !scene ? (
              <p className="scene loading">저장된 방을 불러오는 중…</p>
            ) : (
              <HeroScene {...scene} selectedId={selected?.id ?? null} panelId={panelId} focusId={focusId} panelRef={panel} doorItems={door.items} onDoorMenu={openDoorMenu} workLog={workLog} />
            )}
          </div>
        </div>
      </EngineContext.Provider>
      {!isNative() && (
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setImporting(true);
            void importRooms(file)
              .catch(fail("가져오지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요."))
              .finally(() => setImporting(false));
          }}
        />
      )}

      {menuOpen && rooms && (
        <HomeMenu
          rooms={rooms}
          stats={stats}
          now={now}
          kinds={kinds}
          onClose={() => setMenuOpen(false)}
          onOpenRoom={(id) => {
            setMenuOpen(false);
            onOpen(id);
          }}
          onRoomMenu={openRoomMenu}
          actions={
            <>
              {actions.importList && (
                <button type="button" className="quiet" disabled={importing} onClick={fromMenu(actions.importList)}>
                  <Icon name="import" />
                  {importing ? "가져오는 중…" : "목록 파일 가져오기"}
                </button>
              )}
              {hasSample ? (
                <button type="button" className="quiet" onClick={fromMenu(actions.clearSamples)}>샘플 방 치우기</button>
              ) : (
                <button type="button" className="quiet" onClick={fromMenu(actions.addSample)}>샘플 방 구경하기</button>
              )}
            </>
          }
        />
      )}
      {settingsOpen && <SettingsDialog doorstep={door} onDoorstep={setDoor} onClose={() => setSettingsOpen(false)} onError={toast} />}
      {creating && (
        <NewRoomDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            onOpen(id);
            // 들어가며 반기는 동작 뒤에 받침에서 쑥 올라옵니다.
            window.setTimeout(() => cue(id, { body: "rise", face: "happy", ms: 900 }), 250);
          }}
          onOpenExisting={onOpen}
          onCreatedMany={(message) => {
            setCreating(false);
            toast(message);
            void load();
          }}
        />
      )}
      {viewingRoom && viewingThing && (
        <Suspense fallback={null}>
          <QuickViewer
            key={viewingThing.id}
            room={viewingRoom}
            thing={viewingThing}
            onClose={() => {
              setViewing(null);
              // 연 파일이 최근 작업이 됐으니 더미 순서도 맞춥니다.
              void load();
            }}
            onToRoom={() => {
              setViewing(null);
              onOpen(viewingRoom.id);
            }}
            onError={toast}
          />
        </Suspense>
      )}
      {plans && entered && (
        <SweepDialog
          plans={plans}
          offers={offers}
          now={now}
          onDone={(changed) => {
            setPlans(null);
            // '다음 주에'도 정리 시각을 미루므로 늘 다시 읽습니다.
            getLastSweepAt().then(setLastSweep, (error: unknown) => console.error(error));
            if (changed) void load();
          }}
        />
      )}
      {entered && onHome.length > homeLimit && !plans && !creating && !viewing && !menuOpen && !settingsOpen && !settingsRoom && (
        <HomeRoomsDialog rooms={onHome} prefer={[raised.current, returnTo]} now={now} onKeep={keepOnHome} />
      )}
      {/* 판 밖에 둡니다. 판과 카메라의 transform 안에서는 fixed 자리가 어긋나요. */}
      {roomMenu && menuRoom && (
        <ContextMenu
          x={roomMenu.x}
          y={roomMenu.y}
          opener={roomMenu.opener}
          label={`${menuRoom.name} 방`}
          items={[
            { label: "방 설정", onSelect: fromMenu(() => setRoomSettingsId(menuRoom.id)) },
            { label: menuRoom.care.done ? "홈에 올리기" : "홈에서 빼기", onSelect: fromMenu(() => actions.toggleDone(menuRoom.id, !menuRoom.care.done)) },
          ]}
          onClose={() => setRoomMenu(null)}
        />
      )}
      {settingsRoom && (
        <RoomSettingsDialog
          key={settingsRoom.id}
          room={settingsRoom}
          onClose={() => {
            setRoomSettingsId(null);
            void load();
          }}
          onForgotten={() => {
            const id = settingsRoom.id;
            setRoomSettingsId(null);
            setSelectedId((current) => (current === id ? null : current));
            toast("방을 지웠어요. 폴더와 파일은 그대로예요.");
            void load().then(() => requestAnimationFrame(() => landFocus(id)));
          }}
        />
      )}
      {doorMenu && menuDoor && (
        <ContextMenu
          x={doorMenu.x}
          y={doorMenu.y}
          opener={doorMenu.opener}
          label={`${menuDoor.name} 옮길 곳`}
          items={[
            ...doorTargets(rooms ?? [], menuDoor).map((room) => ({ label: room.name, onSelect: () => void assignToRoom(menuDoor, room).catch(fail(moveFailed)) })),
            { label: "그대로 두기", onSelect: () => void keepInPlace(menuDoor).catch(fail(saveFailed)) },
          ]}
          onClose={() => setDoorMenu(null)}
        />
      )}
      {toastRegion}
    </main>
  );
}
