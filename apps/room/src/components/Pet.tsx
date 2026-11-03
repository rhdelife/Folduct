import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { downloadDir } from "@tauri-apps/api/path";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { kindParts, vaseBands } from "../art/vases";
import { doorTargets, dropItem, emptyDoorstep, type DoorItem, type Doorstep } from "../domain/doorstep";
import type { Room } from "../domain/model";
import { arrivals, checkpointSession, defaultPet, formatWorked, pauseSession, restoreSession, resumeSession, startSession, workedTime, type PetSettings, type Session } from "../domain/session";
import { vaseFill } from "../domain/sky";
import { doorChanged, isNative, petSettingsChanged, pickRoomFolder, sessionEnded, setPetVisible } from "../gateways/native";
import { getDoorstep, getPetSettings, getSession, listRooms, patchDoorstep, savePetSettings, saveSession } from "../storage/db";
import { addDoorFolder, bringIntoRoom, refreshDoorstep, undoBring, type DoorMove } from "../storage/doorstep";
import { BrandMark } from "./Icon";
import { RoomFaceArt } from "./RoomFace";

const saveEveryMs = 60_000;
const dragSlop = 4;
// 답이 없으면 상태는 그대로 두고 묻기만 거둡니다.
const askShownMs = 30_000;
// 작업 중에 새 파일을 찾는 주기.
const watchEveryMs = 10_000;
const doneShownMs = 20_000;

// 앱 화면과 따로 늘 떠 있는 작은 창. 화병은 지금 하는 프로젝트이고, 작업의 시작·멈춤·끝만 정합니다. 파일은 건드리지 않아요.
export function Pet() {
  const [session, setSession] = useState<Session | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [pet, setPet] = useState<PetSettings>(defaultPet);
  const [asking, setAsking] = useState(false);
  const [door, setDoor] = useState<Doorstep | null>(null);
  const [done, setDone] = useState<{ text: string; undo?: { item: DoorItem; moved: DoorMove; room: Room } } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const root = useRef<HTMLElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const room = rooms.find((item) => item.id === session?.roomId) ?? null;
  const working = session?.status === "working";

  const change = useCallback((next: Session | null) => {
    setSession(next);
    setNow(Date.now());
    setAsking(false);
    saveSession(next).catch((error: unknown) => console.error(error));
  }, []);

  const loadRooms = useCallback(async () => {
    const list = await listRooms();
    setRooms(list);
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [saved, list] = await Promise.all([getSession(), loadRooms()]);
        // 지운 방의 작업은 이어 갈 수 없어요.
        change(saved && list.some((item) => item.id === saved.roomId) ? restoreSession(saved) : null);
      } catch (error) {
        console.error(error);
      }
    })();
  }, [change, loadRooms]);

  // 설정을 읽은 뒤에 창을 띄웁니다. 앱의 환경설정에서 바꾸면 바로 따라와요.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let left = false;
    const read = () => getPetSettings().then(setPet, (error: unknown) => console.error(error));
    getPetSettings()
      .then((saved) => {
        setPet(saved);
        if (!saved.hidden && isNative()) return setPetVisible(true);
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
    if (!status || pet.hidden || pet.askEvery === 0) return setAsking(false);
    const timer = window.setInterval(() => setAsking(true), pet.askEvery * 60_000);
    return () => window.clearInterval(timer);
  }, [status, pet.hidden, pet.askEvery]);
  useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => setAsking(false), askShownMs);
    return () => window.clearTimeout(timer);
  }, [asking]);

  useEffect(() => {
    if (!working) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const save = window.setInterval(() => setSession((current) => {
      if (!current) return current;
      const next = checkpointSession(current, Date.now());
      saveSession(next).catch((error: unknown) => console.error(error));
      return next;
    }), saveEveryMs);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(save);
    };
  }, [working]);

  // 작업 중에만 폴더를 봅니다. 시작하는 순간 한 번 읽어 두어야 그 전에 들어온 파일이 이 작업의 파일로 잡히지 않아요.
  useEffect(() => {
    if (!working) return;
    let left = false;
    let count: number | null = null;
    const look = async () => {
      try {
        const state = isNative() ? (await refreshDoorstep()).state : await getDoorstep();
        if (left) return;
        setDoor(state);
        if (isNative() && count !== null && count !== state.items.length) await emit(doorChanged);
        count = state.items.length;
      } catch (error) {
        console.error(error);
      }
    };
    void look();
    const timer = window.setInterval(() => void look(), watchEveryMs);
    return () => {
      left = true;
      window.clearInterval(timer);
    };
  }, [working]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(null), doneShownMs);
    return () => window.clearTimeout(timer);
  }, [done]);

  const tellMain = () => {
    if (isNative()) emit(doorChanged).catch((error: unknown) => console.error(error));
  };

  // 파일은 '넣기'를 누른 것만 옮깁니다.
  async function bring(items: DoorItem[], target: Room) {
    setFileBusy(true);
    let last: { item: DoorItem; moved: DoorMove } | null = null;
    let count = 0;
    let problem: string | null = null;
    try {
      for (const item of items) {
        const { state, moved, error } = await bringIntoRoom(item, target);
        setDoor(state);
        if (moved) {
          last = { item, moved };
          count += 1;
        }
        problem ??= error;
      }
    } catch (error) {
      console.error(error);
      problem = "옮기지 못했어요. 폴더 권한을 확인해 주세요.";
    }
    setFileBusy(false);
    tellMain();
    if (problem) setDone({ text: problem });
    else if (count === 1 && last) setDone({ text: `${target.name} 방으로 옮겼어요.${last.moved.name === last.item.path ? "" : ` 이름이 같아 ${last.moved.name.normalize("NFC")}(으)로 두었어요.`}`, undo: { ...last, room: target } });
    else setDone({ text: `${target.name} 방으로 ${count}개 옮겼어요.` });
    void loadRooms().catch((error: unknown) => console.error(error));
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

  async function undo({ item, moved, room: target }: { item: DoorItem; moved: DoorMove; room: Room }) {
    setDone(null);
    try {
      const { state, error } = await undoBring(item, moved, target);
      // 되돌린 파일을 다시 묻지 않게 줄에서는 빼 둡니다. 원래 폴더에 돌아가 있어요.
      setDoor(error ? state : await patchDoorstep((latest) => dropItem(latest, item.id)));
      setDone({ text: error ?? "원래 폴더로 되돌렸어요." });
      tellMain();
      void loadRooms().catch((reason: unknown) => console.error(reason));
    } catch (error) {
      console.error(error);
      setDone({ text: "되돌리지 못했어요. 폴더 권한을 확인해 주세요." });
    }
  }

  async function addFolder() {
    const win = getCurrentWindow();
    const home = await win.outerPosition();
    try {
      const folder = await pickRoomFolder(await downloadDir());
      // 선택 창이 작은 화병 창에 붙으면서 창을 밀어내요. 제자리로 돌려놓습니다.
      await win.setPosition(home);
      if (!folder) return;
      const { state, error } = await addDoorFolder(folder);
      setDoor(state);
      if (error) setDone({ text: error });
      tellMain();
    } catch (error) {
      console.error(error);
      setDone({ text: "폴더를 읽지 못했어요. 권한을 확인해 주세요." });
    }
  }

  // 앱에서 방 이름이나 얼굴을 바꿨을 수 있어 돌아올 때마다 다시 읽습니다. 다른 곳을 누르면 메뉴를 닫아요.
  useEffect(() => {
    const onFocus = () => void loadRooms().catch((error: unknown) => console.error(error));
    const onBlur = () => setMenuOpen(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [loadRooms]);

  // 투명한 자리도 클릭을 막으니 창을 내용에 딱 맞춥니다.
  useLayoutEffect(() => {
    if (!isNative() || !root.current) return;
    const { width, height } = root.current.getBoundingClientRect();
    getCurrentWindow().setSize(new LogicalSize(Math.ceil(width), Math.ceil(height))).catch((error: unknown) => console.error(error));
  });

  function openMenu() {
    if (!menuOpen) void loadRooms().catch((error: unknown) => console.error(error));
    setMenuOpen(!menuOpen);
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    dragged.current = false;
    press.current = (event.target as Element).closest("[data-no-drag]") ? null : { x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!press.current || Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) < dragSlop) return;
    press.current = null;
    dragged.current = true;
    if (isNative()) getCurrentWindow().startDragging().catch((error: unknown) => console.error(error));
  }

  function openApp() {
    setMenuOpen(false);
    invoke("show_main").catch((error: unknown) => console.error(error));
  }

  function hide() {
    setMenuOpen(false);
    const next = { ...pet, hidden: true };
    setPet(next);
    savePetSettings(next).catch((error: unknown) => console.error(error));
    setPetVisible(false).catch((error: unknown) => console.error(error));
  }

  const choices = rooms.filter((item) => !item.care.done);
  const incoming = room ? arrivals((door ?? emptyDoorstep).items, session).filter((item) => doorTargets([room], item).length > 0) : [];
  const roomLinked = room !== null && room.source === "handle" && Boolean(room.origin);
  const state = session ? session.status : "off";
  return (
    <main ref={root} className={`pet pet-${state}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (press.current = null)}>
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
        {room ? <RoomFaceArt face={room.face} bands={vaseBands(kindParts(room.things), vaseFill)} /> : <BrandMark size={72} />}
      </button>
      {session ? (
        <div className="pet-bar">
          <p className="pet-status" role="status">
            <strong>{working ? "작업 중" : "멈춤"}</strong>
            <time>{formatWorked(workedTime(session, now))}</time>
            {room && <small>{roomLinked ? room.name : `${room.name} · 파일 연결 안 됨`}</small>}
          </p>
          <button type="button" className="pet-toggle" data-no-drag onClick={() => change(working ? pauseSession(session, Date.now()) : resumeSession(session, Date.now()))}>
            {working ? "멈춤" : "다시 시작"}
          </button>
        </div>
      ) : (
        <button type="button" className="pet-start" data-no-drag aria-haspopup="menu" aria-expanded={menuOpen} onClick={openMenu}>작업 시작</button>
      )}
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
          {done.undo && <button type="button" onClick={() => void undo(done.undo!)}>되돌리기</button>}
        </div>
      )}
      {working && roomLinked && door && door.folders.length === 0 && isNative() && (
        <div className="pet-ask" data-no-drag>
          <p role="status">새 파일이 들어오는 폴더를 골라 주세요.</p>
          <button type="button" className="primary" onClick={() => void addFolder()}>폴더 고르기</button>
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
      {menuOpen && (
        <div className="pet-menu" data-no-drag>
          {!session && (
            choices.length > 0 ? (
              <>
                <p>어느 방을 시작할까요?</p>
                <ul>
                  {choices.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          change(startSession(item.id, Date.now()));
                        }}
                      >
                        {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>진행 중인 방이 없어요. 앱에서 방을 만들어 주세요.</p>
            )
          )}
          {session && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                if (isNative()) emit(sessionEnded, session.roomId).catch((error: unknown) => console.error(error));
                change(null);
              }}
            >
              작업 끝내기
            </button>
          )}
          {isNative() && <button type="button" onClick={openApp}>앱 열기</button>}
          {isNative() && <button type="button" onClick={hide}>화병 숨기기</button>}
          {isNative() && <button type="button" onClick={() => invoke("quit_app").catch((error: unknown) => console.error(error))}>Folduct 끄기</button>}
        </div>
      )}
    </main>
  );
}
