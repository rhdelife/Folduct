import { useState } from "react";
import { boxFolderName } from "../domain/care";
import { formatByteSize } from "../domain/preview";
import { runSweep, type SweepOutcome, type SweepPlan } from "../services/careSweep";
import type { FolductStorage } from "../services/storage";

export function WeeklySweepDialog({
  storage,
  plans,
  onDone,
}: {
  storage: FolductStorage;
  plans: SweepPlan[];
  onDone: (changed: boolean) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(plans.flatMap((plan) => plan.candidates.map((item) => item.asset.id))));
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<SweepOutcome[] | null>(null);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const range = `${weekAgo.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} – ${now.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}`;

  function toggle(assetId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  async function sweep() {
    setBusy(true);
    try {
      setOutcomes(await runSweep(storage, plans, selected));
    } finally {
      setBusy(false);
    }
  }

  async function later() {
    await storage.setLastSweepAt();
    onDone(false);
  }

  return (
    <dialog className="sheet sweep-sheet" open aria-labelledby="sweep-title">
      <div className="panel">
        <p className="eyebrow">이번 주 정리 · {range}</p>
        {outcomes === null ? (
          <>
            <h2 id="sweep-title">쉬고 있던 파일을 상자에 모을까요?</h2>
            <p>선택한 파일을 각 프로젝트 폴더의 ‘{boxFolderName}’로 옮겨요. 지우지 않아요. 언제든 ‘제자리로’ 되돌릴 수 있어요.</p>
            <p className="sweep-hint">Premiere처럼 다른 앱이 경로를 기억하는 파일이면 체크를 빼 주세요.</p>
            {plans.map((plan) => (
              <section key={plan.project.id} className="sweep-room">
                <h3>{plan.project.name}</h3>
                {plan.mode === "virtual" && <p className="sweep-hint">이 방은 실제 파일을 옮길 수 없어 Folduct 안에서만 정리해요.</p>}
                <ul>
                  {plan.candidates.map((item) => (
                    <li key={item.asset.id}>
                      <label>
                        <input type="checkbox" checked={selected.has(item.asset.id)} onChange={() => toggle(item.asset.id)} />
                        <span className="sweep-name">{item.asset.displayName}</span>
                        <span className="sweep-meta">{item.days}일째 그대로 · {formatByteSize(item.asset.size)}</span>
                      </label>
                      {item.note && <p className="sweep-note">“{item.note}”</p>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <div className="sheet-actions">
              <button type="button" disabled={busy} onClick={() => void later()}>다음 주에</button>
              <button type="button" className="primary" disabled={busy || selected.size === 0} onClick={() => void sweep()}>{busy ? "정리하는 중" : `정리하기 ${selected.size}`}</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="sweep-title">정리했어요</h2>
            {outcomes.length === 0 && <p>옮긴 파일이 없어요.</p>}
            <ul className="sweep-results" aria-live="polite">
              {outcomes.map((outcome) => (
                <li key={outcome.projectId}>
                  <strong>{outcome.projectName}</strong>{" "}
                  {outcome.skipped ?? `${outcome.moved}개 ${outcome.mode === "virtual" ? "Folduct 안에서 정리" : "상자 폴더로 옮김"} (${formatByteSize(outcome.movedBytes)})`}
                  {outcome.failures.length > 0 && (
                    <ul>{outcome.failures.map((failure) => <li key={failure.name}>{failure.name}: {failure.message}</li>)}</ul>
                  )}
                </li>
              ))}
            </ul>
            <p className="sweep-hint">Folduct는 파일을 지우지 않아요. 필요 없으면 Finder에서 ‘{boxFolderName}’를 비워 주세요.</p>
            <div className="sheet-actions">
              <button type="button" className="primary" onClick={() => onDone(true)}>닫기</button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
