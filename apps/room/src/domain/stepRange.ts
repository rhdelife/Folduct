// 서랍 조건의 범위 바(크기·영상 길이). 손으로 숫자를 치지 않고 정해 둔 눈금 사이에서 두 손잡이로 고르게 해요(2026-11-17 요청).
// 눈금 자리 0은 '처음부터'(아래 조건 없음), 마지막 자리(steps.length + 1)는 '끝까지'(위 조건 없음)예요. 저장 값은 예전처럼 MB·분 숫자예요.
export const sizeSteps = [1, 5, 10, 50, 100, 500, 1024, 5120];
export const lengthSteps = [1, 3, 5, 10, 20, 30, 60, 120];

export const stepEnd = (steps: number[]) => steps.length + 1;

// 저장된 값을 가장 가까운 눈금 자리로. 비었으면 아래는 0, 위는 끝 자리예요.
export function stepAt(steps: number[], value: number | undefined, side: "low" | "high"): number {
  if (value === undefined) return side === "low" ? 0 : stepEnd(steps);
  let best = 0;
  steps.forEach((step, at) => Math.abs(step - value) < Math.abs(steps[best] - value) && (best = at));
  return best + 1;
}

// 눈금 자리를 저장 값으로. 양 끝 자리는 조건 없음이에요.
export const stepValue = (steps: number[], at: number): number | undefined => (at <= 0 || at >= stepEnd(steps) ? undefined : steps[at - 1]);

export const formatMB = (mb: number) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10}GB` : `${mb}MB`);
export const formatMinutes = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10}시간` : `${min}분`);

// 바 옆에 보이는 지금 범위 글.
export function rangeText(low: number | undefined, high: number | undefined, format: (value: number) => string): string {
  if (low === undefined && high === undefined) return "전체";
  if (high === undefined) return `${format(low!)} 이상`;
  if (low === undefined) return `${format(high)} 미만`;
  return `${format(low)} ~ ${format(high)}`;
}
