import { localDay } from "./care";
import type { WorkLog } from "./worklog";

// 홈 '추세' 판: 작업 기록(날짜 → 방 → 밀리초)을 기간마다 모아 봐요. 기록에 시각이 없어 '일' 기간은 두지 않아요.
export type Period = "all" | "year" | "month" | "week";
export const periods: { value: Period; label: string }[] = [
  { value: "all", label: "합계" },
  { value: "year", label: "년" },
  { value: "month", label: "월" },
  { value: "week", label: "주" },
];
export type Bucket = { label: string; ms: number };

const dayTotal = (log: WorkLog, day: string) => Object.values(log[day] ?? {}).reduce((sum, ms) => sum + ms, 0);
// 정오로 맞춰 두면 하루를 더하고 빼도 서머타임에 날짜가 밀리지 않아요.
const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();
const shift = (day: number, by: number) => {
  const date = new Date(day);
  date.setDate(date.getDate() + by);
  return date.getTime();
};
const monthLabel = (y: number, m: number) => `${y}년 ${m + 1}월`;

export const todayWork = (log: WorkLog, now: number) => dayTotal(log, localDay(now));

// 기간의 첫날·끝날(포함). 합계는 기록의 첫날부터 오늘까지예요. 주는 월요일부터예요.
function range(log: WorkLog, period: Period, now: number): { from: number; to: number } {
  const date = new Date(now);
  const [y, m, d] = [date.getFullYear(), date.getMonth(), date.getDate()];
  if (period === "week") {
    const from = noon(y, m, d - ((date.getDay() + 6) % 7));
    return { from, to: shift(from, 6) };
  }
  if (period === "month") return { from: noon(y, m, 1), to: noon(y, m + 1, 0) };
  if (period === "year") return { from: noon(y, 0, 1), to: noon(y, 11, 31) };
  const first = Object.keys(log).sort()[0];
  const [fy, fm, fd] = first ? first.split("-").map(Number) : [y, m + 1, d];
  return { from: Math.min(noon(fy, fm - 1, fd), noon(y, m, d)), to: noon(y, m, d) };
}

// 기간 안의 기록된 날 [날짜, 그날 합계].
function daysIn(log: WorkLog, period: Period, now: number): [string, number][] {
  const { from, to } = range(log, period, now);
  const [start, end] = [localDay(from), localDay(to)];
  return Object.keys(log)
    .filter((day) => day >= start && day <= end)
    .map((day) => [day, dayTotal(log, day)] as [string, number])
    .filter(([, ms]) => ms > 0);
}

export const periodTotal = (log: WorkLog, period: Period, now: number) => daysIn(log, period, now).reduce((sum, [, ms]) => sum + ms, 0);

// 그래프 칸: 주·월은 하루씩, 년은 달마다, 합계는 기록의 첫 달부터 이번 달까지 달마다.
export function buckets(log: WorkLog, period: Period, now: number): Bucket[] {
  const { from, to } = range(log, period, now);
  const worked = new Map(daysIn(log, period, now));
  if (period === "week" || period === "month") {
    const list: Bucket[] = [];
    for (let day = from; day <= to; day = shift(day, 1)) {
      const date = new Date(day);
      list.push({ label: `${date.getMonth() + 1}월 ${date.getDate()}일`, ms: worked.get(localDay(day)) ?? 0 });
    }
    return list;
  }
  const start = new Date(from);
  const end = new Date(to);
  const list: Bucket[] = [];
  for (let y = start.getFullYear(), m = start.getMonth(); y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth()); m === 11 ? ((y += 1), (m = 0)) : (m += 1)) {
    const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
    let ms = 0;
    for (const [day, total] of worked) if (day.startsWith(prefix)) ms += total;
    list.push({ label: monthLabel(y, m), ms });
  }
  return list;
}

// 작업한 날 하루 평균과, 요일마다(월~일) 그 요일에 작업한 날의 평균.
export function weekdayAverage(log: WorkLog, period: Period, now: number): { average: number; byWeekday: number[] } {
  const days = daysIn(log, period, now);
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (const [day, ms] of days) {
    const [y, m, d] = day.split("-").map(Number);
    const at = (new Date(y, m - 1, d).getDay() + 6) % 7;
    sums[at] += ms;
    counts[at] += 1;
  }
  const total = sums.reduce((sum, ms) => sum + ms, 0);
  return { average: days.length ? total / days.length : 0, byWeekday: sums.map((ms, at) => (counts[at] ? ms / counts[at] : 0)) };
}

// 방마다 기간 합계, 오래 일한 방부터.
export function roomTotals(log: WorkLog, period: Period, now: number): [string, number][] {
  const totals = new Map<string, number>();
  for (const [day] of daysIn(log, period, now)) for (const [room, ms] of Object.entries(log[day])) totals.set(room, (totals.get(room) ?? 0) + ms);
  return [...totals].sort((a, b) => b[1] - a[1]);
}
