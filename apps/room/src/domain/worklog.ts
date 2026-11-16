// 작업 시간 기록. 날짜 → 방 → 밀리초입니다. 방 기록과 따로 두어, 방 화면의 저장이 플로팅 창이 쓴 시간을 덮어쓰지 않아요.
// 방을 지워도 그동안 일한 시간은 전체 합계에 남습니다.
export type WorkLog = Record<string, Record<string, number>>;

export function addWork(log: WorkLog, day: string, roomId: string, ms: number): WorkLog {
  if (!(ms > 0)) return log;
  const rooms = log[day] ?? {};
  return { ...log, [day]: { ...rooms, [roomId]: (rooms[roomId] ?? 0) + ms } };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function normalizeWorkLog(value: unknown): WorkLog {
  if (!isRecord(value)) return {};
  const log: WorkLog = {};
  for (const [day, rooms] of Object.entries(value)) {
    if (!isRecord(rooms)) continue;
    const kept = Object.entries(rooms).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0);
    if (kept.length > 0) log[day] = Object.fromEntries(kept);
  }
  return log;
}

export type YearWork = { totalMs: number; days: Map<string, number>; rooms: [string, number][] };

// 한 해의 합계. 방은 오래 일한 순입니다.
export function yearWork(log: WorkLog, year: number): YearWork {
  const days = new Map<string, number>();
  const rooms = new Map<string, number>();
  let totalMs = 0;
  for (const [day, byRoom] of Object.entries(log)) {
    if (!day.startsWith(`${year}-`)) continue;
    for (const [roomId, ms] of Object.entries(byRoom)) {
      totalMs += ms;
      days.set(day, (days.get(day) ?? 0) + ms);
      rooms.set(roomId, (rooms.get(roomId) ?? 0) + ms);
    }
  }
  return { totalMs, days, rooms: [...rooms].sort((a, b) => b[1] - a[1]) };
}

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;

// 큰 숫자. 한 시간 전에는 분으로, 10시간 전에는 소수 한 자리로 보여 줘요.
export function workAmount(ms: number): { value: string; unit: string } {
  if (ms <= 0) return { value: "0", unit: "시간" };
  if (ms < hourMs) return { value: String(Math.max(1, Math.round(ms / minuteMs))), unit: "분" };
  const hours = ms / hourMs;
  return { value: String(hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)), unit: "시간" };
}

// 작업 기록 그래프의 시간: 영어 단위 짧은 꼴(3h 42m, 1d 14h, 25m). 큰 숫자는 숫자와 단위를 따로 그려 단위를 작게 써요.
export function workParts(ms: number): { n: number; u: "d" | "h" | "m" }[] {
  const minutes = ms > 0 ? Math.max(1, Math.round(ms / minuteMs)) : 0;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return [{ n: Math.floor(hours / 24), u: "d" as const }, ...(hours % 24 ? [{ n: hours % 24, u: "h" as const }] : [])];
  if (hours > 0) return [{ n: hours, u: "h" as const }, ...(minutes % 60 ? [{ n: minutes % 60, u: "m" as const }] : [])];
  return [{ n: minutes, u: "m" }];
}
export const formatWorkShort = (ms: number) => workParts(ms).map(({ n, u }) => `${n}${u}`).join(" ");

export function formatWork(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / minuteMs));
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}분`;
  return minutes % 60 === 0 ? `${hours}시간` : `${hours}시간 ${minutes % 60}분`;
}

// 한 줄이 한 달, 점 하나가 하루입니다.
export function yearMonths(year: number): string[][] {
  const two = (value: number) => String(value).padStart(2, "0");
  return Array.from({ length: 12 }, (_, month) =>
    Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, day) => `${year}-${two(month + 1)}-${two(day + 1)}`),
  );
}
