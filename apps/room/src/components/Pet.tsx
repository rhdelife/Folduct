import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { kindParts, vaseBands } from "../art/vases";
import type { Room } from "../domain/model";
import { checkpointSession, formatWorked, pauseSession, restoreSession, resumeSession, startSession, workedTime, type Session } from "../domain/session";
import { vaseFill } from "../domain/sky";
import { isNative } from "../gateways/native";
import { getSession, listRooms, saveSession } from "../storage/db";
import { BrandMark } from "./Icon";
import { RoomFaceArt } from "./RoomFace";

const saveEveryMs = 60_000;
const dragSlop = 4;

// 앱 화면과 따로 늘 떠 있는 작은 창. 화병은 지금 하는 프로젝트이고, 작업의 시작·멈춤·끝만 정합니다. 파일은 건드리지 않아요.
export function Pet() {
  const [session, setSession] = useState<Session | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const room = rooms.find((item) => item.id === session?.roomId) ?? null;
  const working = session?.status === "working";

  const change = useCallback((next: Session | null) => {
    setSession(next);
    setNow(Date.now());
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

  const choices = rooms.filter((item) => !item.care.done);
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
            {room && <small>{room.name}</small>}
          </p>
          <button type="button" className="pet-toggle" data-no-drag onClick={() => change(working ? pauseSession(session, Date.now()) : resumeSession(session, Date.now()))}>
            {working ? "멈춤" : "다시 시작"}
          </button>
        </div>
      ) : (
        <button type="button" className="pet-start" data-no-drag aria-haspopup="menu" aria-expanded={menuOpen} onClick={openMenu}>작업 시작</button>
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
                change(null);
              }}
            >
              작업 끝내기
            </button>
          )}
          {isNative() && <button type="button" onClick={openApp}>앱 열기</button>}
          {isNative() && <button type="button" onClick={() => invoke("quit_app").catch((error: unknown) => console.error(error))}>Folduct 끄기</button>}
        </div>
      )}
    </main>
  );
}
