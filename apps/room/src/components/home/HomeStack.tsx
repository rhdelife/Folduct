import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { DoorItem } from "../../domain/doorstep";
import type { Room } from "../../domain/model";
import { streak } from "../../domain/trends";
import type { WorkLog } from "../../domain/worklog";
import type { OpenRoomMenu } from "../ContextMenu";
import { DoorstepRow } from "../Doorstep";
import { cssToken, tokenMs } from "../tokens";
import { TrendPanel } from "./TrendPanel";

type Tab = "now" | "trend";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// 판의 자리(위·아래·왼쪽·폭)와 모서리·바탕을 px로. 판은 누른 탭 카드의 자리와 모습에서 자라 나오고, 닫으면 그 자리로 접혀 들어가요.
// clip-path·transform 대신 자리 자체를 움직여요. 앱의 WebKit은 판의 clip-path 애니메이션을 그리지 않아 판이 그냥 튀어나왔어요.
type Frame = { top: string; bottom: string; left: string; width: string; borderRadius: string; backgroundColor: string };
function frameOf(box: DOMRect, parent: DOMRect, from: Element): Frame {
  const style = getComputedStyle(from);
  return { top: `${box.top - parent.top}px`, bottom: `${parent.bottom - box.bottom}px`, left: `${box.left - parent.left}px`, width: `${box.width}px`, borderRadius: style.borderTopLeftRadius, backgroundColor: style.backgroundColor };
}
function frames(panel: HTMLElement, tab: HTMLElement): [Frame, Frame] {
  const parent = (panel.offsetParent ?? document.body).getBoundingClientRect();
  return [frameOf(tab.getBoundingClientRect(), parent, tab), frameOf(panel.getBoundingClientRect(), parent, panel)];
}
// 자라는 동안 속 글이 폭에 따라 다시 줄바꿈되지 않게 다 펼친 폭으로 붙잡아 둬요. 판이 잘라 보여 줘요.
function pinInside(panel: HTMLElement, width: string): () => void {
  const kids = [...panel.children] as HTMLElement[];
  for (const kid of kids) kid.style.width = `calc(${width} - 2px)`;
  return () => kids.forEach((kid) => kid.style.removeProperty("width"));
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
  // closing은 탭 묶음을 다시 띄우는 표시, folding은 Esc를 거푸 눌러도 한 번만 접게 막는 표시(Esc 듣기는 연 때의 close를 붙잡고 있어요).
  const [closing, setClosing] = useState(false);
  const folding = useRef(false);
  // 펼치는 중인 움직임을 멈추는 손잡이. 다 펼쳐지기 전에 닫으면 그 자리에서 바로 접기 시작해요.
  const stopOpening = useRef<(() => void) | null>(null);
  const close = () => {
    const el = panel.current;
    const tab = opener.current;
    const done = () => {
      // 탭 묶음의 inert가 먼저 풀려야 포커스를 받을 수 있어요.
      folding.current = false;
      flushSync(() => {
        setClosing(false);
        setOpen(null);
      });
      tab?.focus({ preventScroll: true });
    };
    if (!el || !tab || reduced()) return done();
    if (folding.current) return;
    // 판을 연 채 창을 줄이면 탭 묶음이 숨어(display: none) 접혀 들어갈 자리가 없어요. 그때는 바로 닫아요.
    if (tab.getBoundingClientRect().width === 0) return done();
    folding.current = true;
    // 접히는 동안 탭 묶음이 다시 떠올라, 판이 다 접히면 그 자리에 탭 카드가 그대로 있어요.
    setClosing(true);
    // 지금 보이는 자리·투명도에서 접기 시작해요. 펼치는 중이면 그 움직임을 멈추고 이어 받아요.
    const [from, shown] = frames(el, tab);
    const seen = [...el.children].map((part) => getComputedStyle(part).opacity);
    stopOpening.current?.();
    const unpin = pinInside(el, `${el.getBoundingClientRect().width}px`);
    const fade = tokenMs("--dur-1");
    [...el.children].forEach((part, at) => part.animate([{ opacity: seen[at] }, { opacity: 0 }], { duration: fade, easing: cssToken("--ease-standard"), fill: "forwards" }));
    el.animate([shown, from], { duration: tokenMs("--dur-3"), delay: fade / 2, easing: cssToken("--ease-glide"), fill: "both" }).finished.then(() => {
      unpin();
      done();
    }, done);
  };
  // 열 때: 판을 누른 탭 카드의 자리·모서리·바탕으로 두었다가 제자리로 펼치고, 속은 거의 다 펼쳐질 무렵 떠올라요.
  useLayoutEffect(() => {
    const el = panel.current;
    const tab = opener.current;
    if (!open || !el || !tab || reduced()) return;
    const [from, to] = frames(el, tab);
    const unpin = pinInside(el, to.width);
    const grow = tokenMs("--dur-drawer");
    const motion = el.animate([from, to], { duration: grow, easing: cssToken("--ease-drawer") });
    const parts = [...el.children].map((part) =>
      part.animate([{ opacity: 0, translate: `0 ${cssToken("--space-2")}` }, { opacity: 1, translate: "0 0" }], { duration: tokenMs("--dur-3"), delay: grow * 0.3, easing: cssToken("--ease-standard"), fill: "backwards" }),
    );
    const stop = () => {
      stopOpening.current = null;
      motion.cancel();
      parts.forEach((part) => part.cancel());
      unpin();
    };
    stopOpening.current = stop;
    motion.finished.then(() => {
      if (stopOpening.current === stop) stopOpening.current = null;
      unpin();
    }, () => undefined);
    return stop;
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
      <div className={`home-stack${closing ? " returning" : ""}`} inert={open ? true : undefined}>
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
