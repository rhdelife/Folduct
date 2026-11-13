import { useEffect, useRef, useState } from "react";
import type { DoorItem } from "../../domain/doorstep";
import type { Room } from "../../domain/model";
import { streak } from "../../domain/trends";
import type { WorkLog } from "../../domain/worklog";
import type { OpenRoomMenu } from "../ContextMenu";
import { DoorstepRow } from "../Doorstep";
import { TrendPanel } from "./TrendPanel";

type Tab = "now" | "trend";
const titles: Record<Tab, string> = { now: "진행 중", trend: "추세" };

// 홈 왼쪽 아래: 큰 '작업 시작' 단추와 그 아래 겹쳐 꽂은 탭 카드. 탭을 누르면 왼쪽에 그 판이 열려요.
// 진행 중: 현관에 새로 온 파일과 안 쓴 파일. 추세: 작업 시간 대시보드.
export function HomeStack({ rooms, log, now, doorItems, onDoorMenu, staleFiles, onSweep, onStartWork }: { rooms: Room[]; log: WorkLog; now: number; doorItems: DoorItem[]; onDoorMenu: OpenRoomMenu; staleFiles: number; onSweep: () => void; onStartWork?: () => void }) {
  const [open, setOpen] = useState<Tab | null>(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const run = streak(log, now);
  const summary: Record<Tab, string> = {
    now: doorItems.length > 0 ? `새 파일 ${doorItems.length}개` : staleFiles > 0 ? `안 쓴 파일 ${staleFiles}개` : "조용해요",
    trend: run > 0 ? `연속 ${run}일` : "작업 기록",
  };
  const close = () => {
    setOpen(null);
    opener.current?.focus({ preventScroll: true });
  };
  // 열면 판 제목으로 포커스를 옮기고, Esc로 닫으면 누른 탭으로 돌려줘요. 대화상자·메뉴가 떠 있으면 Esc는 그쪽 몫이에요.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open], .context-menu")) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <div className="home-stack" inert={open ? true : undefined}>
        {onStartWork && (
          <button type="button" className="primary home-start" aria-haspopup="dialog" onClick={onStartWork}>
            작업 시작
          </button>
        )}
        <div className="home-tabs">
          {(Object.keys(titles) as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className="home-tab"
              aria-expanded={open === tab}
              aria-controls="home-panel"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen(tab);
              }}
            >
              <b>{titles[tab]}</b>
              <small>{summary[tab]}</small>
            </button>
          ))}
        </div>
      </div>
      {open && (
        <section ref={panel} id="home-panel" className="home-panel" aria-labelledby="home-panel-title">
          <header className="home-panel-head">
            <h2 id="home-panel-title" tabIndex={-1}>{titles[open]}</h2>
            <button type="button" className="quiet" onClick={close}>닫기</button>
          </header>
          <div className="home-panel-body">
            {open === "trend" ? (
              <TrendPanel log={log} rooms={rooms} now={now} />
            ) : (
              <>
                {doorItems.length === 0 && <p className="trend-sub">새로 온 파일이 없어요.</p>}
                <DoorstepRow items={doorItems} now={now} onMenu={onDoorMenu} />
                {staleFiles > 0 && (
                  <p className="home-panel-row">
                    <span>안 쓴 파일 {staleFiles}개</span>
                    <button type="button" aria-haspopup="dialog" onClick={onSweep}>주간 정리</button>
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
