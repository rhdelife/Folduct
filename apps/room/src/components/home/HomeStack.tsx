import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { DoorItem } from "../../domain/doorstep";
import type { Room } from "../../domain/model";
import { streak } from "../../domain/trends";
import type { WorkLog } from "../../domain/worklog";
import type { OpenRoomMenu } from "../ContextMenu";
import { DoorstepRow } from "../Doorstep";
import { TrendPanel } from "./TrendPanel";

type Tab = "now" | "trend";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// 판 안에서 탭 카드가 있던 자리만 남기는 잘라 내기. 판은 이 자리에서 자라 나오고, 닫으면 이 자리로 접혀 들어가요.
function tabClip(panel: HTMLElement, tab: HTMLElement): string {
  const p = panel.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  return `inset(${t.top - p.top}px ${p.right - t.right}px ${p.bottom - t.bottom}px ${t.left - p.left}px round ${token("--radius-lg")})`;
}
const titles: Record<Tab, string> = { now: "진행 중", trend: "추세" };

// 홈 왼쪽 아래: 큰 '작업 시작' 단추와 그 아래 겹쳐 꽂은 탭 카드. 탭을 누르면 그 탭 카드가 자라나 판이 되고, 닫으면 다시 탭으로 접혀요.
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
  const closing = useRef(false);
  const close = () => {
    const el = panel.current;
    const tab = opener.current;
    const done = () => {
      closing.current = false;
      // 탭 묶음의 inert가 먼저 풀려야 포커스를 받을 수 있어요.
      flushSync(() => setOpen(null));
      tab?.focus({ preventScroll: true });
    };
    if (!el || !tab || reduced()) return done();
    if (closing.current) return;
    closing.current = true;
    el.querySelector(".home-panel-body")?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: parseFloat(token("--dur-1")), fill: "forwards" });
    el.animate([{ clipPath: "inset(0px 0px 0px 0px round " + token("--radius-xl") + ")" }, { clipPath: tabClip(el, tab) }], { duration: parseFloat(token("--dur-3")), easing: token("--ease-glide"), fill: "forwards" }).finished.then(done, done);
  };
  // 열 때: 판을 누른 탭 자리로 잘라 두었다가 전체로 펼치고, 속은 펼쳐지는 도중부터 떠올라요.
  useLayoutEffect(() => {
    const el = panel.current;
    const tab = opener.current;
    if (!open || !el || !tab || reduced()) return;
    const grow = el.animate([{ clipPath: tabClip(el, tab) }, { clipPath: "inset(0px 0px 0px 0px round " + token("--radius-xl") + ")" }], { duration: parseFloat(token("--dur-drawer")), easing: token("--ease-drawer") });
    const body = el.querySelector(".home-panel-body")?.animate([{ opacity: 0, translate: "0 " + token("--space-3") }, { opacity: 1, translate: "0 0" }], { duration: parseFloat(token("--dur-3")), delay: parseFloat(token("--dur-1")), easing: token("--ease-standard"), fill: "backwards" });
    return () => {
      grow.cancel();
      body?.cancel();
    };
  }, [open]);
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
