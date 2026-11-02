import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { vaseIndex, vasePaths } from "../../art/vases";
import { notebookSections, recentFiles as listRecent, shelfFiles, type FileRef } from "../../domain/home";
import { formatBytes } from "../../domain/model";
import { fitLadder, rowWindow, taskRows, type TaskRow } from "../../domain/notebook";
import { cubicOut, range, scenes, useSceneGate, useScene, type HomeActions, type SceneProps } from "./engine";

const rowIcon = 24;
const bottomGap = 24;

function FileLine({ file, state, actions }: { file: FileRef; state: string; actions: HomeActions }) {
  return (
    <button type="button" className="nb-file" title={file.thing.path} onClick={() => actions.focusThing(file.room.id, file.thing.id)}>
      <ObjectShape kind={file.thing.kind} size={rowIcon} seed={file.thing.id} />
      <span className="nb-file-name">{file.thing.name}</span>
      <span className="nb-file-state">{file.days ?? 0}일째 {state}</span>
      <span className="nb-file-size">{formatBytes(file.thing.size)}</span>
    </button>
  );
}

function Task({ row, actions }: { row: TaskRow; actions: HomeActions }) {
  if (row.type === "file") return <li className="nb-row" data-nb="row"><FileLine file={row.file} state="쓰러짐" actions={actions} /></li>;
  return (
    <li className="nb-row nb-room" data-nb="row">
      <button type="button" className="nb-room-main" onClick={() => actions.selectRoom(row.room.id)}>
        <svg className="nb-vase" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false"><path d={vasePaths[vaseIndex(row.room.id)]} /></svg>
        <span className="nb-room-name">{row.room.name}</span>
        {row.over !== null && <b className="nb-over">한도 {formatBytes(row.over)} 넘음</b>}
      </button>
      <button type="button" className="nb-go" aria-label={`${row.room.name} 방으로 가기`} onClick={() => actions.openRoom(row.room.id)}>방으로</button>
    </li>
  );
}

function Counter({ icon, label, onClick }: { icon: ReactNode; label: string; onClick?: () => void }) {
  return (
    <li>
      <button type="button" className="nb-counter" onClick={onClick}>
        {icon}
        {label}
      </button>
    </li>
  );
}

const counterLimit = 4;

// 종이 한 장에 방별로 지금 손댈 것을 적습니다. 줄을 누르면 패널이, 버튼을 누르면 그 일이 바로 열려요.
export function NotebookScene({ rooms, now, lastSweepAt, actions }: SceneProps) {
  const gate = useSceneGate(1);
  const stack = useRef<HTMLDivElement>(null);
  const reveals = useRef<{ el: HTMLElement; type: string; from: number; to: number; p: number }[]>([]);

  const entries = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const limits = fitLadder[fit];

  const { first, info, later } = useMemo(() => notebookSections(rooms, now, lastSweepAt), [rooms, now, lastSweepAt]);
  const { rows, more, moreFiles } = useMemo(() => taskRows(first, limits.first), [first, limits.first]);
  const fallenCount = first.fallen.reduce((sum, item) => sum + item.files.length, 0);
  const recentFiles = useMemo(() => listRecent(rooms, now).filter((file) => !file.room.care.done), [rooms, now]);
  const shelf = useMemo(() => shelfFiles(rooms, now).filter((file) => !file.room.care.done), [rooms, now]);
  const counters = [...info.recent].sort((a, b) => b.count - a.count);
  const shownTilted = info.tilted.slice(0, limits.tilted);
  const moreTilted = info.tilted.length - shownTilted.length;
  const shownCounters = counters.slice(0, counterLimit);
  const moreKinds = counters.length - shownCounters.length;

  // 창 크기나 방 목록이 바뀌면 가장 많이 적은 단부터 다시 맞춥니다. 칠하기 전에 줄이니 넘친 모습은 보이지 않아요.
  const [, remeasure] = useReducer((count: number) => count + 1, 0);
  const fittedRooms = useRef(rooms);
  useEffect(() => {
    const again = () => {
      setFit(0);
      remeasure();
    };
    addEventListener("resize", again);
    return () => removeEventListener("resize", again);
  }, []);
  useLayoutEffect(() => {
    if (fittedRooms.current !== rooms) {
      fittedRooms.current = rooms;
      if (fit > 0) return setFit(0);
    }
    const [sheet, list] = [stack.current!, entries.current!];
    // 종이가 글 높이만큼 늘어납니다. 창 아래에 조금 남겨요.
    const room = innerHeight - sheet.offsetTop - bottomGap;
    if (list.offsetHeight > room && fit < fitLadder.length - 1) setFit(fit + 1);
  });

  // 장면이 다시 그려져 줄이 늘거나 줄면 자리와 창을 새로 잡습니다. useScene보다 먼저 와야 새 줄을 씁니다.
  useLayoutEffect(() => {
    const root = stack.current!;
    const rowEls = [...root.querySelectorAll<HTMLElement>('[data-nb="row"]')];
    const windows = rowEls.map((el, index) => ({ el, type: "row", p: -1, ...rowWindow(index, rowEls.length) }));
    reveals.current = [
      ...[...root.querySelectorAll<HTMLElement>('[data-nb="label"]')].map((el) => ({ el, type: "label", from: 651, to: 676, p: -1 })),
      ...windows,
      ...[...root.querySelectorAll<HTMLElement>('[data-nb="info"]')].map((el) => ({ el, type: "info", from: 1200, to: 1262, p: -1 })),
      ...[...root.querySelectorAll<HTMLElement>('[data-nb="later"]')].map((el) => ({ el, type: "later", from: 1299, to: 1332, p: -1 })),
    ];
  });

  useScene((pos) => {
    // 띠가 다 모이기 전에 올라오기 시작해 띠 아래에 먼저 자리 잡고, 그다음 종이가 떨어집니다. 처음에 빠르고 끝에 느려요.
    const rise = cubicOut(range(pos, scenes[1].show[0], 578));
    const leave = cubicOut(range(pos, 1350, 1745));
    stack.current!.style.transform = `translate3d(0, ${100 * (1 - rise) - 110 * leave}dvh, 0)`;
    stack.current!.style.opacity = String(rise * (1 - leave));
    for (const item of reveals.current) {
      const p = range(pos, item.from, item.to);
      if (p === item.p) continue;
      item.p = p;
      const { style } = item.el;
      style.opacity = p === 1 ? "" : String(p);
      style.pointerEvents = p === 1 ? "" : "none";
      style.willChange = p > 0 && p < 1 ? "transform, opacity" : "";
      const left = 1 - cubicOut(p);
      if (p === 1) style.transform = "";
      else if (item.type === "label") style.transform = `translate3d(${-30 * (1 - p)}px, 0, 0) scale(${1 - 0.1 * (1 - p)})`;
      else if (item.type === "row") style.transform = `translate3d(${-40 * left}px, ${-4 * left}px, 0) rotate(${-1.5 * left}deg)`;
      else if (item.type === "info") style.transform = `translate3d(${30 * left}px, 0, 0) scale(${1 - 0.15 * left})`;
      else style.transform = `translate3d(0, ${20 * left}px, 0) scale(${1 - 0.08 * left})`;
    }
  });

  const quiet = rows.length === 0;
  return (
    <section className="scene scene-notebook" aria-label="손댈 것" {...gate}>
      <div className="nb-stack" ref={stack}>
        <div className="nb-entries" ref={entries}>
          <section className="nb-section" aria-labelledby="nb-first" data-land="first">
            <div className="nb-head" data-nb="label">
              <h2 className="nb-label" id="nb-first">먼저 볼 것</h2>
              {fallenCount > 0 && <button type="button" className="primary nb-sweep" onClick={actions.openSweep}>쓰러진 파일 {fallenCount}개 상자로 옮기기</button>}
            </div>
            {quiet ? (
              <p className="nb-empty" data-nb="row">지금은 손댈 게 없어요. 모두 깔끔해요.</p>
            ) : (
              <ul className="nb-rows">
                {rows.map((row) => <Task key={row.key} row={row} actions={actions} />)}
                {more > 0 && (
                  <li className="nb-row" data-nb="row">
                    <button type="button" className="nb-more" onClick={moreFiles > 0 ? actions.openSweep : actions.openMenu}>외 {more}개 더 있어요</button>
                  </li>
                )}
              </ul>
            )}
          </section>
          <section className="nb-section" aria-labelledby="nb-info" data-land="info">
            <div className="nb-head" data-nb="label"><h2 className="nb-label" id="nb-info">참고</h2></div>
            {shownTilted.length > 0 && (
              <ul className="nb-rows">
                {shownTilted.map((file) => <li className="nb-row" data-nb="row" key={file.thing.id}><FileLine file={file} state="기울어짐" actions={actions} /></li>)}
                {moreTilted > 0 && <li className="nb-row nb-note" data-nb="row">기울어진 파일 외 {moreTilted}개</li>}
              </ul>
            )}
            {shownCounters.length > 0 ? (
              <ul className="nb-counters" data-nb="info">
                <li className="nb-note">이번 주 쓴 파일</li>
                {shownCounters.map((group) => {
                  const files = recentFiles.filter((file) => group.kinds.includes(file.thing.kind));
                  return (
                    <Counter
                      key={group.label}
                      icon={<ObjectShape kind={group.kinds[0]} size={20} seed={group.label} />}
                      label={`${group.label} ${group.count}`}
                      onClick={files[0] ? () => actions.focusThing(files[0].room.id, files[0].thing.id) : undefined}
                    />
                  );
                })}
                {moreKinds > 0 && <li className="nb-note">외 {moreKinds}가지</li>}
              </ul>
            ) : (
              shownTilted.length === 0 && <p className="nb-empty" data-nb="info">최근 7일에 쓴 파일이 없어요.</p>
            )}
          </section>
          <section className="nb-section" aria-labelledby="nb-later" data-land="later">
            <div className="nb-head" data-nb="label"><h2 className="nb-label" id="nb-later">나중에</h2></div>
            <ul className="nb-counters" data-nb="later">
              {shelf[0] && (
                <Counter
                  icon={<ObjectShape kind={shelf[0].thing.kind} size={20} seed={shelf[0].thing.id} />}
                  label={`선반 위 파일 ${later.shelfFiles}개`}
                  onClick={() => actions.focusThing(shelf[0].room.id, shelf[0].thing.id)}
                />
              )}
              {later.doneRooms > 0 && <Counter icon={<svg className="nb-vase" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false"><path d={vasePaths[3]} /></svg>} label={`완료한 방 ${later.doneRooms}개`} onClick={actions.openMenu} />}
              {later.doneRooms === 0 && !shelf[0] && <li className="nb-note">아직 없어요.</li>}
            </ul>
          </section>
        </div>
      </div>
    </section>
  );
}
