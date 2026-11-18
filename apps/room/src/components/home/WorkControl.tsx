import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { faceColorVar } from "../../domain/face";
import type { Room } from "../../domain/model";
import { formatWorked, normalizeSession, workedTime, type Session } from "../../domain/session";
import { isNative, sessionChanged, workEndAsked, workPauseAsked, workStartRoom } from "../../gateways/native";
import { getSession } from "../../storage/db";
import { RoomMark } from "../RoomFace";
import { Icon } from "../Icon";

const ask = (event: string, payload?: string) => void emit(event, payload).catch((error: unknown) => console.error(error));

// 메뉴 막대 작은 창이 재는 작업 상태. 홈의 작업 막대와 방 카드의 '작업 중' 표시가 같이 써요. 앱이 아니면 늘 없음이에요.
export function useWorkSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (!isNative()) return;
    let left = false;
    let stop = () => {};
    getSession().then((saved) => !left && setSession(saved), (error: unknown) => console.error(error));
    void listen<unknown>(sessionChanged, (event) => setSession(normalizeSession(event.payload))).then((unlisten) => (left ? unlisten() : (stop = unlisten)));
    return () => {
      left = true;
      stop();
    };
  }, []);
  return session;
}

// 홈 위쪽 가운데의 작업 막대. 파일 보기(방 카드를 프로도에게 먹이기)와 섞이지 않게 프로도에서 떨어진 자리에 둬요.
// 시간은 메뉴 막대 작은 창이 재고, 이 막대는 그 창의 상태를 따라가요.
// 꺼져 있으면 '작업 시작' 하나. 누르면 막대 아래로 방 알약이 펼쳐지고, 고르면 작은 창을 열지 않고 바로 시간을 재요.
// 작업 중이면 방 이름·시간·멈춤·끝내기로 갈라져요. 누르면 작은 창에 부탁해요(시간은 그 창이 재요).
// pick: 처음부터 방 알약을 펼쳐요(머리줄 작업 아이콘으로 연 판). onDone: 고르기를 닫거나 방을 고르면 불러요.
export function WorkControl({ rooms, session, pick = false, onDone }: { rooms: Room[]; session: Session | null; pick?: boolean; onDone?: () => void }) {
  const [now, setNow] = useState(Date.now);
  const [picking, setPickingState] = useState(pick);
  const setPicking = (next: boolean) => {
    setPickingState(next);
    if (!next) onDone?.();
  };
  const working = session?.status === "working";
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [working]);
  // 고르는 중에는 Esc로 접어요.
  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setPicking(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picking]);
  if (!session) {
    const choices = rooms.filter((room) => !room.care.done);
    if (picking) {
      return (
        <div className="work-control picking" key="pick" role="group" aria-label="어느 방에서 작업할까요?">
          <p className="work-pick-title">어느 방에서 작업할까요?</p>
          <ul className="pet-rooms">
            {choices.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  className="pet-room"
                  style={{ "--room-color": faceColorVar(room.face.color) } as CSSProperties}
                  onClick={() => {
                    setPicking(false);
                    ask(workStartRoom, room.id);
                  }}
                >
                  <RoomMark color={faceColorVar(room.face.color)} className="pet-room-art" />
                  <span>{room.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="quiet icon-close" aria-label="닫기" onClick={() => setPicking(false)}><Icon name="close" /></button>
        </div>
      );
    }
    return (
      <div className="work-control" key="off">
        <button type="button" className="primary work-start" aria-expanded={false} disabled={choices.length === 0} onClick={() => setPicking(true)}>작업 시작</button>
      </div>
    );
  }
  const room = rooms.find((item) => item.id === session.roomId);
  // 어느 방인지 한눈에: 작은 방 실루엣과 굵은 이름, 그 아래 상태. 멈춤은 테두리 단추(❚❚), 다시 시작은 검은 단추(▶)로 달라요(2026-11-18 요청).
  return (
    <div className={`work-control on${working ? "" : " paused"}`} key="on" role="group" aria-label={`${room?.name ?? "방"} ${working ? "작업 중" : "멈춤"}`}>
      <span className="work-clock" aria-live="off">
        <span className="work-room">
          {room && <RoomMark color={faceColorVar(room.face.color)} className="work-room-art" />}
          <span>
            <b className="work-room-name">{room?.name ?? "방"}</b>
            <small className="work-state">{working ? "작업 중" : "멈춤"}</small>
          </span>
        </span>
        <b className="work-time">{formatWorked(workedTime(session, now))}</b>
      </span>
      <button type="button" className={working ? "pause" : "primary resume"} onClick={() => ask(workPauseAsked)}>
        <Icon name={working ? "pause" : "play"} size={14} />
        {working ? "멈춤" : "다시 시작"}
      </button>
      <HoldToEnd onEnd={() => ask(workEndAsked)} />
    </div>
  );
}

// 끝내기는 꾹 눌러 게이지가 다 차야 해요(2026-11-18 요청). 손을 떼거나 밖으로 나가면 취소돼요. 키보드는 Space·Enter를 누르고 있으면 돼요.
// 차는 시간은 styles.css의 --dur-hold와 같아요.
const holdMs = 1200;
function HoldToEnd({ onEnd }: { onEnd: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const start = () => {
    if (timer.current !== null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onEnd();
    }, holdMs);
  };
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => cancel, []);
  return (
    <button
      type="button"
      className={`end hold${holding ? " holding" : ""}`}
      aria-label="끝내기. 꾹 누르고 있으면 끝나요"
      title="꾹 누르고 있으면 끝나요"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => (event.key === " " || event.key === "Enter") && cancel()}
      onBlur={cancel}
      onClick={(event) => event.preventDefault()}
    >
      <span>{holding ? "계속 누르세요" : "꾹 눌러 끝내기"}</span>
    </button>
  );
}
