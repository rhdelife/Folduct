import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { roomUsage } from "../../domain/care";
import { tableRows, type TableRow } from "../../domain/home";
import { formatBytes, type Room } from "../../domain/model";
import { counterAt, decodeAt, folderOf, roomOrder } from "../../domain/table";
import { roomMenuTriggers } from "../ContextMenu";
import { RankVase } from "../SkyPanel";
import { clamp01, range, scenes, useScene, useSceneGate, type HomeActions, type SceneProps } from "./engine";
import { TableSummary } from "./TableSummary";

// 왼쪽에 방 목록, 오른쪽에 고른 방의 파일. 판, 종이, 글자 풀림은 모두 pos 하나로 정해져 되돌리면 그대로 되감깁니다.

// 판 뒤로 떨어지는 종이 조각: 왼쪽(%), 기울기, 크기, 모양.
const pieces: [number, number, number, number][] = [
  [20, -10, 0.9, 0], [36, 1, 1.08, 1], [52, -9, 1.02, 2], [63, 2, 0.96, 1], [79, -8, 0.9, 0],
  [20, 3, 1.08, 2], [36, -7, 1.02, 0], [52, 4, 0.96, 2], [63, -6, 0.9, 1], [79, 5, 1.08, 0],
];
const pieceStart = (index: number) => 2290 + 6 * index + 50 * Math.ceil(index / 5);

// 찢어 접은 파일 종이 세 가지. 납작한 면 셋으로만 그리고, 조각마다 바탕 톤을 달리해 겹친 자리가 보이게 합니다.
const pieceArt: [string, string, string][] = [
  ["M2 5L238 0L240 91L197 97L172 91L121 100L92 95L41 104L0 97Z", "M2 5L118 3L2 62Z", "M238 0L150 52L240 91Z"],
  ["M0 19L58 18L68 4L132 3L142 17L240 13L236 87L181 97L130 88L72 101L4 92Z", "M0 19L240 13L236 50L0 62Z", "M68 4L132 3L142 17L58 18Z"],
  ["M5 8L236 2L231 30L240 56L230 78L238 102L8 96L2 70L10 44L0 22Z", "M128 5L236 2L231 30L240 56L230 78L238 102L166 100Z", "M5 8L72 6L10 44L0 22Z"],
];
const pieceTones = [
  ["piece-face", "piece-fold", "piece-light"],
  ["piece-light", "piece-fold", "piece-face"],
  ["piece-face", "piece-light", "piece-fold"],
];

// 글자 풀림은 첫 화면에 보이는 줄까지만 돕니다. 나머지는 스크롤해야 보여요.
const decodedRows = 8;
const listedRows = 60;
const rowIcon = 22;
const counterDone = 2250;

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// 화면 낭독기는 늘 진짜 글자를 읽습니다. 눈에 보이는 쪽만 흐트러졌다 풀려요.
function Decode({ text, row, col }: { text: string; row: number; col: number }) {
  if (row >= decodedRows) return <span className="table-text">{text}</span>;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="table-text" aria-hidden="true" data-decode={text} data-row={row} data-col={col}>{text}</span>
    </>
  );
}

function Rows({ room, rows, actions }: { room: Room; rows: TableRow[]; actions: HomeActions }) {
  return (
    <div role="rowgroup">
      {rows.map((row, index) => (
        <div role="row" className="table-row" key={row.thing.id} onClick={() => actions.focusThing(room.id, row.thing.id)}>
          <div role="cell" className="tc tc-name">
            <button type="button" className="table-file" title={row.path} aria-label={`${row.name}, ${row.kindLabel}, 패널에서 보기`}>
              <ObjectShape kind={row.kind} size={rowIcon} seed={row.thing.id} />
              <Decode text={row.name} row={index} col={0} />
            </button>
          </div>
          <div role="cell" className="tc tc-path" title={row.path}><Decode text={folderOf(row.path)} row={index} col={1} /></div>
          <div role="cell" className="tc tc-size"><Decode text={formatBytes(row.size)} row={index} col={2} /></div>
          <div role="cell" className={`tc tc-status tone-${row.tone}`}><Decode text={row.status} row={index} col={3} /></div>
        </div>
      ))}
    </div>
  );
}

export function TableScene({ rooms, now, returnTo, actions }: SceneProps) {
  const gate = useSceneGate(2);
  const uid = useId();
  // 방에서 돌아오면 그 방을 다시 펼칩니다.
  const [activeId, setActiveId] = useState(returnTo);
  const [mode, setMode] = useState<"table" | "summary">("table");

  const order = useMemo(() => roomOrder(rooms, now), [rooms, now]);
  const room = order.find((item) => item.id === activeId) ?? order[0];
  const allRows = useMemo(() => tableRows(room, now), [room, now]);
  const rows = allRows.slice(0, listedRows);
  const usage = roomUsage(room);

  const lift = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const paper = useRef<(HTMLDivElement | null)[]>([]);
  const roomList = useRef<HTMLDivElement>(null);
  const pieceAt = useRef<(number | null)[]>(pieces.map(() => null));
  const cells = useRef<{ el: HTMLElement; text: string; row: number; col: number; shown: string | null }[]>([]);

  // 줄이 바뀐 다음에 글자를 맞추도록 useScene보다 먼저 모읍니다.
  useLayoutEffect(() => {
    cells.current = Array.from(card.current?.querySelectorAll<HTMLElement>("[data-decode]") ?? [], (el) => ({ el, text: el.dataset.decode!, row: Number(el.dataset.row), col: Number(el.dataset.col), shown: null }));
  });

  // 고른 방이 목록 밖이면 끌어옵니다. 방에서 돌아온 직후처럼 포커스가 대신 해 주지 않을 때도 있어요. scrollIntoView는 위로 판까지 밀 수 있어 쓰지 않습니다.
  useLayoutEffect(() => {
    const list = roomList.current!;
    const box = list.getBoundingClientRect();
    const tab = list.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
    const past = (lo: number, hi: number, min: number, max: number) => (lo < min ? lo - min : hi > max ? hi - max : 0);
    list.scrollBy(past(tab.left, tab.right, box.left, box.right), past(tab.top, tab.bottom, box.top, box.bottom));
  }, [room.id]);

  const [showFrom, showTo] = scenes[2].show;
  useScene((pos) => {
    if (pos < showFrom || pos > showTo) return;
    const enter = range(pos, 1750, 2250);
    const exit = range(pos, 3350, 3950);
    const box = lift.current!;
    box.style.transform = `translate3d(0, ${exit > 0 ? -40 * exit : 80 * (1 - enter)}dvh, 0)`;
    box.style.opacity = String(enter * (1 - exit));

    pieces.forEach(([, rotate, scale], index) => {
      const t = clamp01((pos - pieceStart(index)) / 680);
      if (pieceAt.current[index] === t) return;
      pieceAt.current[index] = t;
      const el = paper.current[index];
      if (!el) return;
      // 떨어지기 전과 판 뒤로 다 들어간 뒤에는 그리지 않습니다. inherit라야 pos가 건너뛰어도 숨은 장면을 따라 숨어요.
      el.style.visibility = t > 0 && t < 1 ? "inherit" : "hidden";
      if (t > 0 && t < 1) el.style.transform = `translate3d(-50%, ${-32 + 44 * t * t}dvh, 0) rotate(${rotate}deg) scale(${scale})`;
    });

    const calm = reduced();
    if (counter.current) {
      const next = String(calm || pos >= counterDone ? allRows.length : counterAt(pos, allRows.length));
      if (counter.current.textContent !== next) counter.current.textContent = next;
    }
    for (const cell of cells.current) {
      const next = calm ? cell.text : decodeAt(cell.text, pos, cell.row, cell.col);
      if (next === cell.shown) continue;
      cell.shown = next;
      cell.el.textContent = next;
    }
  });

  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = `${uid}-panel`;

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = order.indexOf(room);
    const count = order.length;
    const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? (at + 1) % count : event.key === "ArrowUp" || event.key === "ArrowLeft" ? (at - 1 + count) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActiveId(order[next].id);
    requestAnimationFrame(() => document.getElementById(tabId(order[next].id))?.focus());
  }

  return (
    <section className="scene scene-table" aria-label="방" {...gate}>
      <div className="table-lift" ref={lift}>
        <div className="table-card" ref={card}>
          <div className="table-paper" aria-hidden="true">
            {pieces.map(([left, , , art], index) => (
              <div key={index} className="table-piece" style={{ left: `${left}%` } as CSSProperties} ref={(el) => void (paper.current[index] = el)}>
                <svg viewBox="0 0 240 105" focusable="false">
                  {pieceArt[art].map((d, part) => <path key={part} className={pieceTones[index % 3][part]} d={d} />)}
                </svg>
              </div>
            ))}
          </div>
          <div className="table-sheet">
            <div className="table-rooms" role="tablist" aria-label="방" aria-orientation="vertical" data-own-wheel onKeyDown={onTabKey} ref={roomList}>
              {order.map((item) => {
                const menu = roomMenuTriggers(item.id, actions.roomMenu);
                const used = roomUsage(item);
                return (
                  <button
                    key={item.id}
                    id={tabId(item.id)}
                    type="button"
                    role="tab"
                    aria-selected={item === room}
                    aria-controls={panelId}
                    tabIndex={item === room ? 0 : -1}
                    title={item.name}
                    className="table-room"
                    onClick={() => setActiveId(item.id)}
                    onContextMenu={menu.onContextMenu}
                    onKeyDown={menu.onKeyDown}
                  >
                    <RankVase room={item} bytes={used.totalBytes} partial={!used.exact} />
                    <span className="table-room-name">{item.name}</span>
                    <small>{item.care.done ? "완료" : formatBytes(used.totalBytes)}</small>
                  </button>
                );
              })}
            </div>
            <div className="table-panel" id={panelId} role="tabpanel" aria-labelledby={tabId(room.id)}>
              <header className="table-head">
                <div className="table-title">
                  <h2>{room.name}</h2>
                  <p>
                    <span aria-hidden="true">파일 <span ref={counter}>{allRows.length}</span>개</span>
                    <span className="sr-only">파일 {allRows.length}개</span>
                    {` · ${usage.exact ? "" : "최소 "}${formatBytes(usage.totalBytes)}${room.budgetBytes ? ` / ${formatBytes(room.budgetBytes)}` : ""}`}
                  </p>
                </div>
                <div className="table-mode" role="group" aria-label="보기">
                  <button type="button" aria-pressed={mode === "table"} onClick={() => setMode("table")}>목록</button>
                  <button type="button" aria-pressed={mode === "summary"} onClick={() => setMode("summary")}>요약</button>
                </div>
                <button type="button" className="primary table-enter" onClick={() => actions.openRoom(room.id)} aria-label={`${room.name} 방에 들어가기`}>방에 들어가기</button>
              </header>
              {mode === "table" ? (
                <div className="table-grid" role="table" aria-label={`${room.name} 방의 파일`} data-own-wheel key={room.id}>
                  {rows.length > 0 ? (
                    <Rows room={room} rows={rows} actions={actions} />
                  ) : (
                    <div role="rowgroup">
                      <div role="row">
                        <p role="cell" className="table-note">{room.things.length > 0 ? "폴더에서 파일을 찾지 못했어요." : "이 방에는 아직 파일이 없어요."}</p>
                      </div>
                    </div>
                  )}
                  {allRows.length > rows.length && <p className="table-note">그 밖에 {allRows.length - rows.length}개 더 있어요. 방에 들어가면 다 보여요.</p>}
                </div>
              ) : (
                <TableSummary key={room.id} room={room} now={now} />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
