import { useState } from "react";
import { budgetLevel, budgetPresets, GB, suggestBudget, type RoomUsage } from "../domain/care";
import { formatBytes, type Thing } from "../domain/model";
import { isNative } from "../gateways/native";

// 용량 한도는 막대와 글자로 함께 보여주고, 경고는 작업을 막지 않습니다.
export function CapacityBar({ usage, budgetBytes }: { usage: RoomUsage; budgetBytes: number | null }) {
  const level = budgetLevel(usage, budgetBytes);
  const total = formatBytes(usage.totalBytes);
  const ratio = budgetBytes && level !== "partial" ? Math.min(1, usage.totalBytes / budgetBytes) : null;
  return (
    <div className={`capacity capacity-${level}`}>
      <p>
        {level === "partial" ? `최소 ${total} 확인` : budgetBytes ? `${total} / 한도 ${formatBytes(budgetBytes)}` : `${total} · 한도 미정`}
        {level === "near" && <strong> · 한도에 거의 찼어요</strong>}
        {level === "over" && <strong> · 한도를 넘었어요</strong>}
      </p>
      {ratio !== null && <span className="capacity-track" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></span>}
      {usage.boxBytes > 0 && <p className="capacity-box">그중 정리 상자 {formatBytes(usage.boxBytes)}</p>}
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
      <legend>용량 한도</legend>
      <p>지금 {formatBytes(totalBytes)}예요. 용량 한도를 {formatBytes(suggestion)}로 할까요? 넘어도 작업은 막지 않아요.</p>
      <div className="chips">
        {options.map((bytes) => (
          <button key={bytes} type="button" aria-pressed={value === bytes} onClick={() => onChange(bytes)}>
            {formatBytes(bytes)}{bytes === suggestion ? " (제안)" : ""}
          </button>
        ))}
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>정하지 않음</button>
      </div>
      <div className="chips">
        <label>직접 입력 <input type="number" min={0.1} step={0.1} inputMode="decimal" value={custom} onChange={(event) => setCustom(event.target.value)} /> GB</label>
        <button type="button" disabled={!(customBytes > 0)} onClick={() => onChange(customBytes)}>정하기</button>
      </div>
      {value !== null && !options.includes(value) && <p>지금 한도 {formatBytes(value)}</p>}
    </fieldset>
  );
}

// 용량 한도를 넘었을 때 방을 열면 주 1회 보여줍니다.
export function BudgetBanner({ things, totalBytes, onCopy, onGrow, onHide }: { things: Thing[]; totalBytes: number; onCopy: (path: string) => Promise<boolean>; onGrow: (budgetBytes: number) => void; onHide: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const largest = things.filter((thing) => !thing.missing).sort((a, b) => b.size - a.size).slice(0, 5);
  const grown = suggestBudget(totalBytes);
  return (
    <section className="banner budget-banner" role="region" aria-labelledby="budget-banner-title">
      <p>
        <strong id="budget-banner-title">용량 한도를 넘었어요.</strong> 가장 큰 파일 {largest.length}개예요. Folduct는 파일을 지우지 않으니, 필요하면 {isNative() ? "Finder" : "폴더"}에서 직접 정리해 주세요.
      </p>
      <ul>
        {largest.map((thing) => (
          <li key={thing.id}>
            <span>{thing.name} · {formatBytes(thing.size)}</span>
            {/* 실패는 페이지 알림이 경로와 함께 알려 주고, 여기서는 정말 복사됐을 때만 바꿉니다. */}
            <button type="button" onClick={() => void onCopy(thing.path).then((ok) => ok && setCopied(thing.path))}>{copied === thing.path ? "복사했어요" : "경로 복사"}</button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" className="primary" onClick={() => onGrow(grown)}>한도 늘리기 ({formatBytes(grown)})</button>
        <button type="button" onClick={onHide}>이번 주 숨기기</button>
      </div>
    </section>
  );
}
