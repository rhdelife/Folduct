import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { DoorItem } from "../../domain/doorstep";
import type { Room } from "../../domain/model";
import { localDay } from "../../domain/care";
import { formatWork, workAmount, yearMonths, yearWork, type WorkLog } from "../../domain/worklog";
import type { OpenRoomMenu } from "../ContextMenu";
import { DoorstepRow } from "../Doorstep";
import { cssToken, tokenMs } from "../tokens";
import { isNative } from "../../gateways/native";
import { TrendPanel } from "./TrendPanel";
import { Icon } from "../Icon";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// 판의 자리(위·아래·왼쪽·폭)와 모서리·바탕을 px로. 판은 일력 카드의 자리와 모습에서 자라 나오고, 닫으면 그 자리로 접혀 들어가요.
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
const roomsShown = 3;

// 홈 왼쪽 아래: 올해 일력 한 장(한 줄이 한 달, 점 하나가 하루). 누르면 그 자리에서 판이 자라나 진행 중(새 파일·안 쓴 파일)과 작업 추세를 보여 주고, 닫으면 다시 일력으로 접혀요.
export function HomeStack({ rooms, log, now, doorItems, onDoorMenu, staleFiles, onSweep }: { rooms: Room[]; log: WorkLog; now: number; doorItems: DoorItem[]; onDoorMenu: OpenRoomMenu; staleFiles: number; onSweep: () => void }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const year = new Date(now).getFullYear();
  const today = localDay(now);
  const work = useMemo(() => yearWork(log, year), [log, year]);
  const months = useMemo(() => yearMonths(year), [year]);
  const amount = workAmount(work.totalMs);
  const names = new Map(rooms.map((room) => [room.id, room.name]));
  const lines = work.rooms.filter(([id]) => names.has(id)).slice(0, roomsShown);
  // closing은 일력을 다시 띄우는 표시, folding은 Esc를 거푸 눌러도 한 번만 접게 막는 표시(Esc 듣기는 연 때의 close를 붙잡고 있어요).
  const [closing, setClosing] = useState(false);
  const folding = useRef(false);
  // 펼치는 중인 움직임을 멈추는 손잡이. 다 펼쳐지기 전에 닫으면 그 자리에서 바로 접기 시작해요.
  const stopOpening = useRef<(() => void) | null>(null);
  const close = () => {
    const el = panel.current;
    const tab = opener.current;
    const done = () => {
      // 일력의 inert가 먼저 풀려야 포커스를 받을 수 있어요.
      folding.current = false;
      flushSync(() => {
        setClosing(false);
        setOpen(false);
      });
      tab?.focus({ preventScroll: true });
    };
    if (!el || !tab || reduced()) return done();
    if (folding.current) return;
    // 판을 연 채 창을 줄이면 일력이 숨어(display: none) 접혀 들어갈 자리가 없어요. 그때는 바로 닫아요.
    if (tab.getBoundingClientRect().width === 0) return done();
    folding.current = true;
    // 접히는 동안 일력이 다시 떠올라, 판이 다 접히면 그 자리에 일력이 그대로 있어요.
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
  // 열 때: 판을 일력 카드의 자리·모서리·바탕으로 두었다가 제자리로 펼치고, 속은 거의 다 펼쳐질 무렵 떠올라요.
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
  // 열면 판 제목으로 포커스를 옮기고, Esc로 닫으면 일력으로 돌려줘요. 대화상자·메뉴가 떠 있으면 Esc는 그쪽 몫이에요.
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
        <button
          type="button"
          className="work-cal"
          aria-expanded={open}
          aria-controls="home-panel"
          aria-label={`올해 작업 ${amount.value}${amount.unit}, ${work.days.size}일. 누르면 작업 기록을 열어요`}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setOpen(true);
          }}
        >
          <span className="work-cal-total">
            <strong>{amount.value}</strong>
            <span>{amount.unit}</span>
            {work.days.size > 0 && <small>{work.days.size}일 작업</small>}
          </span>
          <span className="trend-cal" aria-hidden="true">
            {months.map((days, month) => (
              <span key={month}>
                {days.map((day) => <i key={day} className={work.days.get(day) ? "on" : day < today ? "past" : undefined} />)}
              </span>
            ))}
          </span>
          <span className="work-cal-rooms">{lines.length > 0 ? lines.map(([id, ms]) => `${names.get(id)} ${formatWork(ms)}`).join(", ") : isNative() ? "플로팅 창에서 작업을 시작하면 쌓여요." : "작업 시간은 데스크톱 앱에서 재요."}</span>
        </button>
      </div>
      {open && (
        <section ref={panel} id="home-panel" className="home-panel" aria-labelledby="home-panel-title">
          <header className="home-panel-head">
            <h2 id="home-panel-title" tabIndex={-1}>작업 기록</h2>
            <button type="button" className="quiet icon-close" aria-label="닫기" onClick={close}><Icon name="close" /></button>
          </header>
          <div className="home-panel-body">
            <section className="trend-card" aria-labelledby="home-now">
              <h3 id="home-now">진행 중</h3>
              {doorItems.length === 0 && <p className="trend-sub">새로 온 파일이 없어요.</p>}
              <DoorstepRow items={doorItems} now={now} onMenu={onDoorMenu} />
              {staleFiles > 0 && (
                <p className="home-panel-row">
                  <span>안 쓴 파일 {staleFiles}개</span>
                  <button type="button" aria-haspopup="dialog" onClick={onSweep}>주간 정리</button>
                </p>
              )}
            </section>
            <TrendPanel log={log} rooms={rooms} now={now} />
          </div>
        </section>
      )}
    </>
  );
}
