import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { vasePaths } from "../../art/vases";
import { RoomFaceArt } from "../RoomFace";
import { notebookSections, recentFiles as listRecent, shelfFiles, type FileRef } from "../../domain/home";
import { formatBytes } from "../../domain/model";
import { fitLadder, rowWindow, taskRows, type TaskRow } from "../../domain/notebook";
import { cubicOut, range, smooth, useSceneGate, useScene, type HomeActions, type SceneProps } from "./engine";

const rowIcon = 24;
const bottomGap = 24;

function FileLine({ file, actions }: { file: FileRef; actions: HomeActions }) {
  return (
    <button type="button" className="nb-file" data-thing={file.thing.id} title={file.thing.path} onClick={() => actions.focusThing(file.room.id, file.thing.id)}>
      <ObjectShape kind={file.thing.kind} size={rowIcon} seed={file.thing.id} />
      <span className="nb-file-name">{file.thing.name}</span>
      <span className="nb-file-state">{file.days ?? 0}일째 그대로</span>
      <span className="nb-file-size">{formatBytes(file.thing.size)}</span>
    </button>
  );
}

function Task({ row, actions }: { row: TaskRow; actions: HomeActions }) {
  if (row.type === "file") return <li className="nb-row" data-nb="row"><FileLine file={row.file} actions={actions} /></li>;
  return (
    <li className="nb-row nb-room" data-nb="row">
      <button type="button" className="nb-room-main" onClick={() => actions.selectRoom(row.room.id)}>
        <RoomFaceArt face={row.room.face} roomId={row.room.id} compact className="nb-vase" />
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
  const reveals = useRef<{ el: HTMLElement; from: number; to: number; p: number }[]>([]);

  const entries = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const limit = fitLadder[fit];

  const { first, info, later } = useMemo(() => notebookSections(rooms, now, lastSweepAt), [rooms, now, lastSweepAt]);
  const { rows, more, moreFiles } = useMemo(() => taskRows(first, limit), [first, limit]);
  const staleCount = first.stale.reduce((sum, item) => sum + item.files.length, 0);
  const recentFiles = useMemo(() => listRecent(rooms, now).filter((file) => !file.room.care.done), [rooms, now]);
  const shelf = useMemo(() => shelfFiles(rooms, now).filter((file) => !file.room.care.done), [rooms, now]);
  const counters = [...info.recent].sort((a, b) => b.count - a.count);
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
    const windows = rowEls.map((el, index) => ({ el, p: -1, ...rowWindow(index, rowEls.length) }));
    reveals.current = [
      ...[...root.querySelectorAll<HTMLElement>('[data-nb="label"]')].map((el) => ({ el, from: 880, to: 980, p: -1 })),
      ...windows,
      ...[...root.querySelectorAll<HTMLElement>('[data-nb="info"]')].map((el) => ({ el, from: 1200, to: 1262, p: -1 })),
      ...[...root.querySelectorAll<HTMLElement>('[data-nb="later"]')].map((el) => ({ el, from: 1299, to: 1332, p: -1 })),
    ];
  });

  useScene((pos) => {
    // 남은 종이 밑으로 공책이 미끄러져 올라옵니다. 종이가 내려앉기 전에 대부분 자리를 잡아요.
    const rise = smooth(range(pos, 420, 1060));
    const leave = cubicOut(range(pos, 1350, 1745));
    stack.current!.style.transform = `translate3d(0, ${100 * (1 - rise) - 110 * leave}dvh, 0)`;
    stack.current!.style.opacity = String(1 - leave);
    for (const item of reveals.current) {
      const p = range(pos, item.from, item.to);
      if (p === item.p) continue;
      item.p = p;
      const { style } = item.el;
      style.opacity = p === 1 ? "" : String(p);
      style.pointerEvents = p === 1 ? "" : "none";
      style.willChange = p > 0 && p < 1 ? "transform, opacity" : "";
      // 글자는 제자리에서 번지듯 나타납니다. 옆으로 움직이면 내려앉는 종이와 줄이 어긋나요.
      style.transform = p === 1 ? "" : `translate3d(0, ${6 * (1 - cubicOut(p))}px, 0)`;
    }
  });

  const quiet = rows.length === 0;
  return (
    <section className="scene scene-notebook" aria-label="손댈 것" {...gate}>
      <div className="nb-stack" ref={stack}>
        <div className="nb-entries" ref={entries}>
          <section className="nb-section" aria-labelledby="nb-first">
            <div className="nb-head" data-nb="label">
              <h2 className="nb-label" id="nb-first">먼저 볼 것</h2>
              {staleCount > 0 && <button type="button" className="primary nb-sweep" onClick={actions.openSweep}>오래된 파일 {staleCount}개 정리하기</button>}
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
          <section className="nb-section" aria-labelledby="nb-info">
            <div className="nb-head" data-nb="label"><h2 className="nb-label" id="nb-info">참고</h2></div>
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
              <p className="nb-empty" data-nb="info">최근 7일에 쓴 파일이 없어요.</p>
            )}
          </section>
          <section className="nb-section" aria-labelledby="nb-later">
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
