// styles.css :root 토큰 읽기.
export const cssToken = (name: string, from: Element = document.documentElement): string => getComputedStyle(from).getPropertyValue(name).trim();

// 시간 토큰을 ms 숫자로. 빌드가 640ms를 .64s로 줄여 써서, 숫자만 읽으면 0.64ms가 되어 움직임이 바로 끝나 버렸어요.
export function toMs(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return /ms$/i.test(value) ? n : /s$/i.test(value) ? n * 1000 : n;
}

export const tokenMs = (name: string, from?: Element): number => toMs(cssToken(name, from));
