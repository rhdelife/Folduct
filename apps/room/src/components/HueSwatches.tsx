import type { CSSProperties } from "react";
import { hueColors, hues, type Hue } from "../domain/hue";

// 이미지를 색으로 모아 보는 네모 줄. 누르면 그 색 이미지만, 다시 누르면 모두 보여요.
// 색은 네모를 누르거나 키보드로 줄에 들어올 때(onReach) 읽기 시작해요. 스치기만 해서는 방의 이미지를 다 읽지 않아요. 다 읽은 뒤 그 색 이미지가 없는 네모는 흐려져요.
export function HueSwatches({ value, found, total, onReach, onPick }: { value: Hue | ""; found: Map<string, Hue | null>; total: number; onReach: () => void; onPick: (hue: Hue | "") => void }) {
  const counts = new Map<Hue | null, number>();
  for (const hue of found.values()) counts.set(hue, (counts.get(hue) ?? 0) + 1);
  const done = found.size === total;
  const reading = found.size > 0 && !done;
  return (
    <div className="room-hue" role="group" aria-label="이미지를 색으로 모아 보기" aria-busy={reading} onFocus={onReach}>
      {hues.map((name) => {
        const count = counts.get(name) ?? 0;
        // 고른 색은 비어 있어도 다시 눌러 풀 수 있어야 해요.
        const empty = done && count === 0 && value !== name;
        const label = found.size > 0 ? `${name} ${count}개` : name;
        return (
          <button key={name} type="button" className="room-hue-swatch" style={{ "--swatch": hueColors[name] } as CSSProperties} aria-label={label} title={label} aria-pressed={value === name} aria-disabled={empty} onClick={() => !empty && onPick(value === name ? "" : name)} />
        );
      })}
      {reading && <span className="room-hue-read" style={{ "--read": found.size / total } as CSSProperties} aria-hidden="true" />}
    </div>
  );
}
