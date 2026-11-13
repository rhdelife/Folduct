import { localDay } from "./care";
import type { WorkLog } from "./worklog";

// 작업 보고: 고른 주기마다 지난 기간의 방별 작업 시간과 적어 둔 한 일을 모아 보여 주고, AI를 켜 두었으면 Claude가 짧게 정리해요.
// Claude에는 기간, 방 이름과 분, 날마다의 분, 사용자가 적은 줄만 보내요. 파일 이름·위치·내용은 보내지 않아요.

export type ReportEvery = "off" | "day" | "week" | "month";
export const reportChoices: [ReportEvery, string][] = [["off", "끄기"], ["day", "매일"], ["week", "매주"], ["month", "매달"]];

// 날짜는 그 기기의 하루(YYYY-MM-DD), from·to 모두 들어가요.
export type Period = { from: string; to: string };
export type WorkNote = { id: string; day: string; roomId: string | null; text: string; at: number };
export type WorkReport = Period & { text: string; at: number; model: string };

export const noteMaxLength = 200;

const dayMs = 86_400_000;
// 자정 근처의 서머타임을 피하려고 정오로 날짜를 셉니다.
const noon = (now: number) => {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  return date;
};

// 지금이 들어 있는 기간. 끈 상태면 주 단위로 보여 줘요.
export function currentPeriod(every: ReportEvery, now: number): Period {
  const today = noon(now);
  if (every === "day") return { from: localDay(today.getTime()), to: localDay(today.getTime()) };
  if (every === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12);
    return { from: localDay(first.getTime()), to: localDay(last.getTime()) };
  }
  // 주는 월요일부터 일요일까지예요.
  const monday = today.getTime() - ((today.getDay() + 6) % 7) * dayMs;
  return { from: localDay(monday), to: localDay(monday + 6 * dayMs) };
}

// 막 끝난 기간(어제, 지난주, 지난달).
export function lastPeriod(every: Exclude<ReportEvery, "off">, now: number): Period {
  return shiftPeriod(every, currentPeriod(every, now), -1);
}

// 앞(-1)이나 뒤(1) 기간.
export function shiftPeriod(every: ReportEvery, period: Period, step: -1 | 1): Period {
  const [year, month, day] = (step < 0 ? period.from : period.to).split("-").map(Number);
  return currentPeriod(every, new Date(year, month - 1, day + step, 12).getTime());
}

// 보고를 만들 때가 된 기간. 이미 만든 기간이면 null이에요.
export function reportDue(every: ReportEvery, reports: WorkReport[], now: number): Period | null {
  if (every === "off") return null;
  const period = lastPeriod(every, now);
  return reports.some((report) => report.from === period.from && report.to === period.to) ? null : period;
}

const inPeriod = (day: string, period: Period) => day >= period.from && day <= period.to;
const sorted = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]);

export type PeriodWork = { totalMs: number; rooms: [string, number][]; days: [string, number][]; notes: WorkNote[] };

// 기간 안의 작업. 방은 이름으로 바꿔 오래 일한 순으로, 지운 방은 "지운 방"으로 모아요.
export function periodWork(log: WorkLog, notes: WorkNote[], period: Period, roomNames: Map<string, string>): PeriodWork {
  const rooms = new Map<string, number>();
  const days = new Map<string, number>();
  let totalMs = 0;
  for (const [day, byRoom] of Object.entries(log)) {
    if (!inPeriod(day, period)) continue;
    for (const [roomId, ms] of Object.entries(byRoom)) {
      const name = roomNames.get(roomId) ?? "지운 방";
      rooms.set(name, (rooms.get(name) ?? 0) + ms);
      days.set(day, (days.get(day) ?? 0) + ms);
      totalMs += ms;
    }
  }
  return {
    totalMs,
    rooms: sorted(rooms),
    days: [...days].sort((a, b) => a[0].localeCompare(b[0])),
    notes: notes.filter((note) => inPeriod(note.day, period)).sort((a, b) => a.at - b.at),
  };
}

export const hasWork = (work: PeriodWork): boolean => work.totalMs > 0 || work.notes.length > 0;

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

// Claude에 보낼 내용. 이것 말고는 보내지 않아요.
export function reportInput(period: Period, work: PeriodWork, roomNames: Map<string, string>): string {
  const lines = [`기간: ${period.from} ~ ${period.to}`, `전체: ${work.totalMs > 0 ? minutes(work.totalMs) : 0}분`];
  if (work.rooms.length) lines.push("방별:", ...work.rooms.map(([name, ms]) => `- ${name}: ${minutes(ms)}분`));
  if (work.days.length) lines.push("날짜별:", ...work.days.map(([day, ms]) => `- ${day}: ${minutes(ms)}분`));
  if (work.notes.length) lines.push("적어 둔 한 일:", ...work.notes.map((note) => `- ${note.day}${note.roomId ? ` [${roomNames.get(note.roomId) ?? "지운 방"}]` : ""} ${note.text}`));
  return lines.join("\n");
}

export const reportSystem = [
  "사용자가 고른 기간의 작업 기록을 받아 짧은 작업 보고를 써요.",
  "한국어 해요체로, 머리말이나 제목 없이 3~5문장만 써요.",
  "얼마나 일했는지, 어디에 시간이 많이 갔는지, 적어 둔 한 일에서 무엇을 했는지를 담아요.",
  "기록에 없는 일을 지어내지 말고, 평가나 잔소리는 하지 않아요.",
].join("\n");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function normalizeNotes(value: unknown): WorkNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !isDay(item.day) || typeof item.text !== "string" || !item.text.trim()) return [];
    return [{ id: item.id, day: item.day, roomId: typeof item.roomId === "string" ? item.roomId : null, text: item.text.trim().slice(0, noteMaxLength), at: typeof item.at === "number" ? item.at : 0 }];
  });
}

export function normalizeReports(value: unknown): WorkReport[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isDay(item.from) || !isDay(item.to) || typeof item.text !== "string") return [];
    return [{ from: item.from, to: item.to, text: item.text, at: typeof item.at === "number" ? item.at : 0, model: typeof item.model === "string" ? item.model : "" }];
  });
}

export const normalizeEvery = (value: unknown): ReportEvery => (reportChoices.some(([every]) => every === value) ? (value as ReportEvery) : "off");

// 같은 기간을 다시 만들면 바꿔 끼워요. 새것이 앞이에요.
export const withReport = (reports: WorkReport[], report: WorkReport): WorkReport[] => [report, ...reports.filter((item) => item.from !== report.from || item.to !== report.to)];

export function periodLabel(period: Period): string {
  const short = (day: string) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`;
  return period.from === period.to ? short(period.from) : `${short(period.from)} ~ ${short(period.to)}`;
}
