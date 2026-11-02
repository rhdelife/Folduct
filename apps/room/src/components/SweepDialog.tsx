import { useEffect, useRef, useState } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { dayMs, firstLine, thingStage } from "../domain/care";
import { formatBytes } from "../domain/model";
import { isNative } from "../gateways/native";
import { runSweep, type SweepOutcome, type SweepPlan } from "../storage/box";
import { setLastSweepAt } from "../storage/db";
import { useModal } from "./useModal";

// 옮기기 전에 묻습니다. 고른 파일만, '정리하기'를 누른 클릭 안에서 옮깁니다.
export function SweepDialog({ plans, now, onDone }: { plans: SweepPlan[]; now: number; onDone: (changed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(() => new Set(plans.flatMap((plan) => plan.candidates.map((thing) => thing.id))));
  // 지금 옮기는 대상: "all"은 처음 정리, 방 id는 그 방만 다시 시도.
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<SweepOutcome[] | null>(null);
  // 도중에 멈추면 같은 계획으로 다시 돌리지 않습니다. 닫고 집에서 새로 읽습니다.
  const [stopped, setStopped] = useState(false);
  useModal(dialog);

  // 결과로 바뀌거나 다시 시도가 끝나면, 누른 버튼이 사라지거나 잠겼으니 '닫기'로 포커스를 옮깁니다.
  useEffect(() => {
    if (outcomes && busy === null) closeButton.current?.focus();
  }, [outcomes, busy]);

  // '정리하기'나 '권한 다시 요청하고 옮기기' 클릭 안에서 바로 불러야 권한 요청이 됩니다.
  async function sweep(target: SweepPlan[], key: string) {
    setBusy(key);
    try {
      const result = await runSweep(target, selected, now);
      setOutcomes((current) => (current ? current.map((outcome) => result.find((next) => next.roomId === outcome.roomId) ?? outcome) : result));
    } catch {
      setStopped(true);
    } finally {
      setBusy(null);
    }
  }

  // '다음 주에': 이번 주는 묻지 않습니다. 저장에 실패해도 닫기는 막지 않습니다.
  async function later() {
    await setLastSweepAt(now).catch(() => undefined);
    onDone(false);
  }

  function toggle(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const asking = isNative() ? 0 : plans.filter((plan) => plan.mode === "real" && plan.candidates.some((thing) => selected.has(thing.id))).length;
  const moved = outcomes?.reduce((sum, outcome) => sum + outcome.moved, 0) ?? 0;
  const movedBytes = outcomes?.reduce((sum, outcome) => sum + outcome.movedBytes, 0) ?? 0;
  const skipped = outcomes?.filter((outcome) => outcome.skipped).length ?? 0;
  const failed = outcomes?.reduce((sum, outcome) => sum + outcome.failures.length, 0) ?? 0;
  const week = `${new Date(now - 6 * dayMs).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} – ${new Date(now).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}`;
  return (
    <dialog
      ref={dialog}
      className="sheet sweep"
      aria-labelledby="sweep-title"
      onCancel={(event) => {
        event.preventDefault();
        if (busy) return;
        if (stopped || outcomes) onDone(true);
        else void later();
      }}
    >
      <div className="sheet-body">
        <h2 id="sweep-title">이번 주 정리 · {week}</h2>
        {stopped ? (
          <>
            <p className="error" role="alert">정리하다 멈췄어요. 이미 옮긴 파일은 상자에 있어요.</p>
            <div className="row end"><button type="button" className="primary" autoFocus onClick={() => onDone(true)}>닫기</button></div>
          </>
        ) : outcomes ? (
          <>
            <p id="sweep-summary">
              {outcomes.length === 0
                ? "고른 파일이 없어 옮기지 않았어요."
                : `파일 ${moved}개(${formatBytes(movedBytes)})를 정리 상자에 넣었어요.` + (skipped ? ` 방 ${skipped}개는 권한이 없어 그대로예요.` : "") + (failed ? ` ${failed}개는 옮기지 못했어요.` : "")}
            </p>
            <ul className="sweep-results" aria-live="polite">
              {outcomes.map((outcome) => {
                const plan = plans.find((item) => item.room.id === outcome.roomId);
                return (
                  <li key={outcome.roomId}>
                    <strong>{outcome.roomName}</strong> — {outcome.skipped ?? `${outcome.moved}개 ${outcome.mode === "virtual" ? "Folduct 안에서 정리 상자에 넣음" : "정리 상자로 옮김"} (${formatBytes(outcome.movedBytes)})`}
                    {outcome.skipped && plan && (
                      <div className="row">
                        <button type="button" onClick={() => void sweep([plan], outcome.roomId)} disabled={busy !== null}>{busy === outcome.roomId ? "옮기는 중…" : "권한 다시 요청하고 옮기기"}</button>
                      </div>
                    )}
                    {outcome.failures.length > 0 && <ul>{outcome.failures.map((failure) => <li key={failure.id}>{failure.path}: {failure.message}</li>)}</ul>}
                  </li>
                );
              })}
            </ul>
            <p className="soft">상자에 넣은 파일은 각 방의 정리 상자에서 언제든 ‘제자리로’ 돌려놓을 수 있어요.</p>
            <div className="row end"><button ref={closeButton} type="button" className="primary" aria-describedby="sweep-summary" onClick={() => onDone(true)} disabled={busy !== null}>닫기</button></div>
          </>
        ) : (
          <>
            <p>쓰러진 파일을 각 방 폴더 안 정리 상자(<span className="path">_Folduct 정리상자</span>)로 옮겨요. <strong>지우지 않아요.</strong> 메모와 원래 자리는 상자 안에서도 그대로예요.</p>
            {plans.map((plan) => {
              const ids = plan.candidates.map((thing) => thing.id);
              const all = ids.every((id) => selected.has(id));
              return (
                <section key={plan.room.id} className="sweep-room">
                  <div className="row">
                    <h3 id={`sweep-room-${plan.room.id}`}>{plan.room.name} — 쓰러진 물건 {plan.candidates.length}개 ({formatBytes(plan.candidates.reduce((sum, thing) => sum + thing.size, 0))})</h3>
                    <button type="button" className="quiet" aria-describedby={`sweep-room-${plan.room.id}`} onClick={() => toggle(ids, !all)} disabled={busy !== null}>{all ? "모두 해제" : "모두 선택"}</button>
                  </div>
                  {plan.mode === "virtual" && <p className="soft">{plan.room.source === "sample" ? "샘플 방이라" : "이 방은 파일을 직접 옮길 수 없어"} Folduct 안에서만 상자에 넣어요. 실제 파일은 그대로예요.</p>}
                  <ul>
                    {plan.candidates.map((thing) => {
                      const note = firstLine(thing.note);
                      return (
                        <li key={thing.id}>
                          <label>
                            <input type="checkbox" checked={selected.has(thing.id)} onChange={(event) => toggle([thing.id], event.target.checked)} />
                            <ObjectShape kind={thing.kind} size={24} seed={thing.id} />
                            <span className="name">{thing.name}</span>
                            <span className="soft">{thingStage(thing, plan.room.care, plan.room.workDays, now).days}일째 그대로 · {formatBytes(thing.size)}</span>
                          </label>
                          {note && <p className="note-line">“{note}”</p>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            <p className="soft">다른 앱에서 쓰는 파일이면 체크를 빼 주세요.</p>
            {asking > 0 && <p className="soft">정리하기를 누르면 브라우저가 폴더 {asking}개에 대해 ‘수정 허용’을 물어요.</p>}
            <div className="row end">
              <button type="button" onClick={() => void later()} disabled={busy !== null}>다음 주에</button>
              <button type="button" className="primary" onClick={() => void sweep(plans, "all")} disabled={busy !== null || selected.size === 0}>{busy ? "옮기는 중…" : `${selected.size}개 정리하기`}</button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
