import { useState } from "react";
import { budgetLevel, budgetPresets, GB, suggestBudget, type RoomUsage } from "../domain/care";
import type { Asset } from "../domain/models";
import { formatByteSize } from "../domain/preview";

// 방 용량은 막대와 글자로 함께 보여주고, 경고는 작업을 막지 않습니다.
export function CapacityBar({ usage, budgetBytes }: { usage: RoomUsage; budgetBytes: number | null }) {
  const level = budgetLevel(usage, budgetBytes);
  const total = formatByteSize(usage.totalBytes);
  const ratio = budgetBytes && level !== "partial" ? Math.min(1, usage.totalBytes / budgetBytes) : null;
  return (
    <div className={`capacity capacity-${level}`}>
      <p>
        {level === "partial" ? `최소 ${total} 확인` : budgetBytes ? `${total} / ${formatByteSize(budgetBytes)}` : `${total} · 방 크기 미정`}
        {level === "near" && <strong> · 방이 거의 찼어요</strong>}
        {level === "over" && <strong> · 방 크기를 넘었어요</strong>}
      </p>
      {ratio !== null && <span className="capacity-track" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></span>}
      {usage.boxBytes > 0 && <p className="capacity-box">그중 정리 상자 {formatByteSize(usage.boxBytes)}</p>}
    </div>
  );
}

export function BudgetPicker({ totalBytes, value, onChange }: { totalBytes: number; value: number | null; onChange: (budgetBytes: number | null) => void }) {
  const [custom, setCustom] = useState("");
  const suggestion = suggestBudget(totalBytes);
  const options = [...new Set([suggestion, ...budgetPresets])].sort((a, b) => a - b);
  const customBytes = Math.round(Number(custom) * GB);
  return (
    <fieldset className="budget-picker">
      <legend>방 크기</legend>
      <p>지금 {formatByteSize(totalBytes)}예요. 방 크기를 {formatByteSize(suggestion)}로 할까요? 넘어도 작업은 막지 않아요.</p>
      <div className="budget-options">
        {options.map((bytes) => (
          <button key={bytes} type="button" aria-pressed={value === bytes} onClick={() => onChange(bytes)}>
            {formatByteSize(bytes)}{bytes === suggestion ? " (제안)" : ""}
          </button>
        ))}
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>정하지 않음</button>
      </div>
      <div className="budget-custom">
        <label>직접 입력 <input type="number" min={0.1} step={0.1} inputMode="decimal" value={custom} onChange={(event) => setCustom(event.target.value)} /> GB</label>
        <button type="button" disabled={!(customBytes > 0)} onClick={() => onChange(customBytes)}>정하기</button>
      </div>
      {value !== null && !options.includes(value) && <p>지금 방 크기 {formatByteSize(value)}</p>}
    </fieldset>
  );
}

// 방 크기를 넘었을 때 방을 열면 주 1회 보여줍니다.
export function BudgetBanner({ assets, usage, copied, onCopy, onGrow, onHide }: { assets: Asset[]; usage: RoomUsage; copied: string | null; onCopy: (path: string) => void; onGrow: (budgetBytes: number) => void; onHide: () => void }) {
  const largest = assets.filter((asset) => asset.availability !== "missing").sort((a, b) => b.size - a.size).slice(0, 5);
  const grown = suggestBudget(usage.totalBytes);
  return (
    <section className="budget-banner" role="status">
      <p><strong>방 크기를 넘었어요.</strong> 가장 큰 파일 {largest.length}개예요. Folduct는 파일을 지우지 않으니, 필요하면 Finder에서 정리해 주세요.</p>
      <ul>
        {largest.map((asset) => (
          <li key={asset.id}>
            <span>{asset.displayName} · {formatByteSize(asset.size)}</span>
            <button type="button" onClick={() => onCopy(asset.relativePath)}>{copied === asset.relativePath ? "복사했어요" : "경로 복사"}</button>
          </li>
        ))}
      </ul>
      <div className="sheet-actions">
        <button type="button" className="primary" onClick={() => onGrow(grown)}>방 크기 늘리기 ({formatByteSize(grown)})</button>
        <button type="button" onClick={onHide}>이번 주 숨기기</button>
      </div>
    </section>
  );
}
