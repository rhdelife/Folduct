export function textLength(value: string): number {
  return Array.from(value).length;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
