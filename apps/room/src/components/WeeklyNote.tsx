import { useMemo, useRef, type CSSProperties } from "react";
import { doneOfferDue } from "../domain/care";
import { notebookSections } from "../domain/home";
import type { Room } from "../domain/model";
import { taskRows } from "../domain/notebook";
import type { HomeActions } from "./home/engine";
import { Task } from "./home/NotebookScene";
import { useModal } from "./useModal";

const rowLimit = 12;

// 일주일에 한 번 앱을 열 때 떠오르는 공책입니다. 머리의 주간 정리 버튼으로 언제든 다시 열어요. 파일을 옮기는 일은 정리 창에서만 합니다.
export function WeeklyNote({ rooms, now, actions, onClose, onSweep }: { rooms: Room[]; now: number; actions: HomeActions; onClose: () => void; onSweep: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog);
  const { first } = useMemo(() => notebookSections(rooms, now), [rooms, now]);
  const { rows, more } = useMemo(() => taskRows(first, rowLimit), [first]);
  const stale = first.stale.reduce((sum, item) => sum + item.files.length, 0);
  const asks = rooms.filter((room) => doneOfferDue(room, now)).length;
  const summary = [stale > 0 && `오래된 파일 ${stale}개`, asks > 0 && `오래 쉰 방 ${asks}개`].filter(Boolean).join(" · ");
  // 줄을 누르면 공책을 닫고 그 자리로 갑니다.
  const leaving = <A extends unknown[]>(run: (...args: A) => void) => (...args: A) => {
    onClose();
    run(...args);
  };
  const rowActions = { ...actions, focusThing: leaving(actions.focusThing), selectRoom: leaving(actions.selectRoom), openRoom: leaving(actions.openRoom) };
  return (
    <dialog
      ref={dialog}
      className="sheet weekly"
      aria-labelledby="weekly-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="sheet-body">
        <h2 id="weekly-title">이번 주 손댈 것</h2>
        <p className="note-line">{summary || "지금은 손댈 게 없어요. 모두 깔끔해요."}</p>
        {rows.length > 0 && (
          <ul className="nb-rows">
            {rows.map((row, index) => <Task key={row.key} row={row} actions={rowActions} style={{ "--i": index } as CSSProperties} />)}
          </ul>
        )}
        {more > 0 && <p className="note-line">외 {more}개 더 있어요.</p>}
        <div className="row end">
          <button type="button" onClick={onClose}>닫기</button>
          {(stale > 0 || asks > 0) && <button type="button" className="primary" onClick={onSweep}>정리하기</button>}
        </div>
      </div>
    </dialog>
  );
}
