import type { DoorItem } from "./doorstep";

// 지금 하고 있는 작업 하나. 플로팅 창의 시작·멈춤·끝내기가 이 값만 바꿉니다. 없으면 꺼진 상태예요.
// since는 시간을 세기 시작한 시각이고, 멈춰 있으면 null입니다. 쌓인 시간은 workedMs에 있어요.
// watchFrom은 마지막으로 시작하거나 다시 시작한 시각이에요. 이 뒤에 들어온 파일만 이 작업의 파일로 봅니다.
export type Session = { roomId: string; status: "working" | "paused"; workedMs: number; since: number | null; watchFrom: number };

export const startSession = (roomId: string, now: number): Session => ({ roomId, status: "working", workedMs: 0, since: now, watchFrom: now });

export const workedTime = (session: Session, now: number): number => session.workedMs + (session.since === null ? 0 : Math.max(0, now - session.since));

export const pauseSession = (session: Session, now: number): Session => ({ ...session, status: "paused", workedMs: workedTime(session, now), since: null });

export const resumeSession = (session: Session, now: number): Session => (session.status === "working" ? session : { ...session, status: "working", since: now, watchFrom: now });

// 작업 중에 틈틈이 저장합니다. 앱이 갑자기 꺼져도 그때까지의 시간은 남아요.
export const checkpointSession = (session: Session, now: number): Session => (session.status === "working" ? { ...session, workedMs: workedTime(session, now), since: now } : session);

// 앱을 다시 켜면 멈춤으로 돌아옵니다. 꺼져 있던 시간을 작업 시간으로 세지 않아요.
export const restoreSession = (session: Session): Session => ({ ...session, status: "paused", since: null });

export function normalizeSession(value: unknown): Session | null {
  const session = value as Partial<Session> | null | undefined;
  if (typeof session?.roomId !== "string" || !session.roomId) return null;
  const workedMs = typeof session.workedMs === "number" && session.workedMs > 0 ? session.workedMs : 0;
  const since = typeof session.since === "number" ? session.since : null;
  const watchFrom = typeof session.watchFrom === "number" ? session.watchFrom : (since ?? 0);
  return since !== null && session.status === "working" ? { roomId: session.roomId, status: "working", workedMs, since, watchFrom } : { roomId: session.roomId, status: "paused", workedMs, since: null, watchFrom };
}

// 작업 중에 들어온 새 파일. 멈춘 동안이나 시작 전에 들어온 파일은 현관 줄에만 남아요. since는 그 파일을 찾기 직전에 폴더를 읽은 시각입니다.
export function arrivals(items: DoorItem[], session: Session | null): DoorItem[] {
  if (session?.status !== "working") return [];
  return items.filter((item) => item.since >= session.watchFrom).sort((a, b) => a.since - b.since || a.lastModified - b.lastModified);
}

// 작은 창 설정. askEvery는 작업 상태를 묻는 주기(분)이고 0이면 묻지 않아요.
// floating이면 작은 창을 화면에 늘 띄워 두고, 아니면(기본) 메뉴 막대 아이콘을 누를 때만 그 아래에 열어요.
// 늘 떠 있는 창이 화면을 가린다는 말에 기본을 껐어요. 예전 hidden 값은 읽지 않아 모두 아이콘 창으로 시작해요.
export const askChoices = [0, 5, 10, 30] as const;
export type PetSettings = { askEvery: number; floating: boolean };
export const defaultPet: PetSettings = { askEvery: 10, floating: false };

export function normalizePet(value: unknown): PetSettings {
  const pet = value as Partial<PetSettings> | null | undefined;
  return { askEvery: askChoices.some((choice) => choice === pet?.askEvery) ? pet!.askEvery! : defaultPet.askEvery, floating: pet?.floating === true };
}

export function formatWorked(ms: number): string {
  const total = Math.floor(ms / 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const clock = `${two(Math.floor(total / 60) % 60)}:${two(total % 60)}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}
