// 고른 항목 Set에서 ids를 켜거나 끈 새 Set. 여러 대화상자의 체크 칸이 같이 써요.
export function toggled<T>(set: ReadonlySet<T>, ids: readonly T[], on: boolean): Set<T> {
  const next = new Set(set);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
