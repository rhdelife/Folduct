import { textLength } from "./text";

export function limitText(value: string, max: number, composing: boolean): { value: string; commit: boolean; atLimit: boolean } {
  const length = textLength(value);
  if (composing) return { value, commit: false, atLimit: length >= max };
  const limited = Array.from(value).slice(0, max).join("");
  return { value: limited, commit: true, atLimit: length >= max };
}
