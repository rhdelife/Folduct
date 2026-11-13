import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { Room } from "../../domain/model";
import { formatWorked, normalizeSession, workedTime, type Session } from "../../domain/session";
import { sessionChanged, workEndAsked, workPauseAsked, workStartAsked } from "../../gateways/native";
import { getSession } from "../../storage/db";

const ask = (event: string) => void emit(event).catch((error: unknown) => console.error(error));

// 프로도 받침 아래 작업 줄. 시간은 메뉴 막대 작은 창이 재고, 이 줄은 그 창의 상태를 따라가요.
// 꺼져 있으면 '작업 시작' 하나, 작업 중이면 그 자리가 시간·멈춤·끝내기로 갈라져요. 누르면 작은 창에 부탁해요.
export function WorkControl({ rooms }: { rooms: Room[] }) {
  const [session, setSession] = useState<Session | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let left = false;
    let stop = () => {};
    getSession().then((saved) => !left && setSession(saved), (error: unknown) => console.error(error));
    void listen<unknown>(sessionChanged, (event) => setSession(normalizeSession(event.payload))).then((unlisten) => (left ? unlisten() : (stop = unlisten)));
    return () => {
      left = true;
      stop();
    };
  }, []);
  const working = session?.status === "working";
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [working]);
  if (!session) {
    return (
      <div className="work-control" key="off">
        <button type="button" className="primary work-start" aria-haspopup="dialog" onClick={() => ask(workStartAsked)}>작업 시작</button>
      </div>
    );
  }
  const room = rooms.find((item) => item.id === session.roomId);
  return (
    <div className="work-control on" key="on" role="group" aria-label={`${room?.name ?? "방"} ${working ? "작업 중" : "멈춤"}`}>
      <span className="work-clock" aria-live="off">
        <b>{formatWorked(workedTime(session, now))}</b>
        <small>{room?.name ?? "방"} · {working ? "작업 중" : "멈춤"}</small>
      </span>
      <button type="button" className={working ? undefined : "primary"} onClick={() => ask(workPauseAsked)}>{working ? "멈춤" : "다시 시작"}</button>
      <button type="button" onClick={() => ask(workEndAsked)}>끝내기</button>
    </div>
  );
}
