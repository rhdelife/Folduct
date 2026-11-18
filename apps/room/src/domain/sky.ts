import { dayMs, lastActivity, localDay, relativeDay, roomLastActivity, roomUsage, sizeRatio, thingAge, withinWeek, type RoomUsage } from "./care";
import type { CareSettings, Room, Thing } from "./model";

// 집 화면의 지도. 방은 받침 위에 선 주름관, 파일은 크기만큼의 작은 별이고, 손대지 않은 파일은 방에서 멀어집니다.
export const sky = { width: 1000, height: 680, centerX: 500, centerY: 340 } as const;

export type Point = { x: number; y: number };
export type Star = { thing: Thing; x: number; y: number; r: number; stale: boolean; days: number };

// 같은 글자는 늘 같은 0~1 값을 돌려줍니다(FNV-1a). 새로고침해도 별자리가 그대로입니다.
export function hash(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 마지막에 한 번 더 섞어 비슷한 글자("t1", "t2")도 멀리 흩어지게 합니다.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 지도는 무대 전체를 씁니다. sky 좌표는 무대의 비율일 뿐이라 세로로 긴 폰에서도 위아래를 다 써요. 크기는 화면에서 나온 단위(1280에서 1)로 잽니다.
// stack: 왼쪽 아래 작업 기록 카드가 실제로 보이는지. 카드는 창 크기로 보이는데(styles.css .home-stack), 미리보기 창이 열리면 판(w)만 좁아져서 따로 알려 줘요.
export type View = { w: number; h: number; stack?: boolean };
export const baseView: View = { w: 1280, h: 840 };
export function stageUnit({ w, h }: View): number {
  return Math.max(w, lerp(0.9, 1, clamp((w - 480) / 544, 0, 1)) * h) / 1280;
}
export const toPx = (point: Point, view: View): Point => ({ x: (point.x / sky.width) * view.w, y: (point.y / sky.height) * view.h });
export const toSky = (point: Point, view: View): Point => ({ x: (point.x / view.w) * sky.width, y: (point.y / view.h) * sky.height });

export type Box = { x: number; y: number; hw: number; hh: number };

// 방 자리. 주름관이 판 가운데를 물결처럼 가로지릅니다. 좁은 창에서는 둘씩 줄을 지어요. 많으면 해바라기로 채웁니다.
export function roomSpots(count: number, view: View = baseView): Point[] {
  const { w, h } = view;
  const spot = (x: number, y: number) => {
    const at = toSky({ x, y }, view);
    return { x: clamp(at.x, 60, sky.width - 60), y: clamp(at.y, 90, sky.height - 60) };
  };
  if (count <= 8) {
    const columns = w < 720 ? Math.min(2, count) : count;
    const rows = Math.ceil(count / columns);
    return Array.from({ length: count }, (_, i) => {
      const column = i % columns;
      const row = Math.floor(i / columns);
      const across = columns > 1 ? column / (columns - 1) : 0.5;
      const reach = columns > 2 ? 0.36 : columns > 1 ? 0.22 : 0;
      const wave = rows > 1 ? (column % 2 ? 0.03 : -0.03) : 0.09 * Math.sin(i * 2.3 + 0.6) * (count > 1 ? 1 : 0);
      return spot(w * (0.5 + reach * (2 * across - 1)), h * (0.54 + (rows > 1 ? (row - (rows - 1) / 2) * (0.62 / rows) : 0) + wave));
    });
  }
  return Array.from({ length: count }, (_, i) => {
    const radius = Math.sqrt((i + 0.5) / count);
    const angle = i * 2.39996 - Math.PI / 2;
    return spot(w / 2 + w * 0.43 * radius * Math.cos(angle), h / 2 + h * 0.41 * radius * Math.sin(angle));
  });
}

// 파일이 방에서 퍼지는 거리. 판 전체에 흩어지도록 넉넉합니다. 다듬는 건 heroLayout의 relax가 해요.
export function clusterSpread(count: number): number {
  return clamp(560 / Math.sqrt(Math.max(1, count)), 90, 520);
}

export function roomRadius(room: Room, scale = 1): number {
  return (20 + 28 * sizeRatio(roomUsage(room).totalBytes)) * scale;
}

// 주름관 높이의 절반. 고르면 주름관이 vaseLift배로 커지므로, 파일은 커진 주름관 바깥에 미리 자리를 잡습니다(고를 때 파일이 움직이지 않아요).
export const vaseLift = 1.5;
export function vaseHalf(radius: number): number {
  return radius * 1.35;
}

// 주름관 크기 1이 화면 단위 1에서 차지하는 px(1000칸 지도를 1280에 펼친 값).
export const vaseUnit = 1.28;

// 방 이름표 자리(주름관 아래). roomStars의 첫 자리 잡기에만 쓰는 어림값이고, 겹침은 heroLayout이 실제 이름으로 다시 봅니다.
export const labelHalfWidth = 100;
export const labelHeight = 60;
export function starRadius(bytes: number, scale = 1): number {
  return (4 + 8 * sizeRatio(bytes)) * scale;
}

export type Placed = { room: Room; at: Point; scale: number; spread: number; limit: number };

// 왼쪽 아래 '작업 시작' 단추와 탭 카드 자리예요. 좁거나 낮은 창에서는 숨겨요. 크기와 창 기준은 styles.css의 .home-stack에 맞춰요.
export function calendarSpot(view: View): Box[] {
  return (view.stack ?? (view.w >= 720 && view.h >= 640)) ? [{ x: 168, y: view.h - 130, hw: 150, hh: 130 }] : [];
}

// 홈에 둘 수 있는 방의 수. 지금 하는 일만 보여 주려는 약속이에요. 숫자는 여기서만 정합니다.
export const homeLimit = 5;

// 자리가 모자랄 때 먼저 골라 둘 방. 사용자가 방금 고른 방, 내 방, 샘플 순서이고, 같으면 최근에 쓴 순서입니다.
// 샘플 파일 날짜는 늘 최근이라, 샘플을 띄우기만 해도 내 방이 밀려났어요.
export function roomsToKeep(active: Room[], prefer: (string | null)[]): string[] {
  const rank = (room: Room) => (prefer.includes(room.id) ? 2 : room.source === "sample" ? 0 : 1);
  return [...active].sort((a, b) => rank(b) - rank(a) || roomLastActivity(b) - roomLastActivity(a)).slice(0, homeLimit).map((room) => room.id);
}

// 큰 파일부터 띄웁니다(방 안 줄과 같은 순서). 상자 속·사라진 파일은 하늘에 띄우지 않습니다.
// 오른쪽 목록도 이 물건들을 꼭 넣어, 지도에 뜬 파일마다 목록 줄이 있습니다.
export function pickStarThings(room: Room, limit: number): Thing[] {
  const live = room.things.filter((thing) => !thing.missing && !thing.box);
  return live.sort((a, b) => b.size - a.size).slice(0, limit);
}

export function roomStars(room: Room, center: Point, spread: number, now: number, limit = 40, scale = 1): Star[] {
  const picked = pickStarThings(room, limit);
  const half = vaseHalf(roomRadius(room, scale));
  // 세로는 0.8배로 눌러 놓으니, 위아래로도 커진 주름관에 닿지 않게 그만큼 더 띄웁니다.
  const inner = (half * vaseLift) / 0.8 + 8 * scale;
  return picked.map((thing) => {
    const { stale, days } = thingAge(thing, room, now);
    // 제자리 물건은 방 둘레 어디에나, 손대지 않은 물건은 하늘 바깥쪽으로 흘러가 다른 방과 섞이지 않습니다.
    const outward = Math.atan2(center.y - sky.centerY, center.x - sky.centerX);
    // 머리글 곁에 있는 방은 바깥쪽이 따로 없으니 둘레 어디로든 흘러갑니다.
    const lone = Math.abs(center.x - sky.centerX) < 230 && Math.abs(center.y - sky.centerY) < 100;
    const angle = !stale || lone ? hash(thing.id) * Math.PI * 2 : outward + (hash(thing.id) - 0.5) * Math.PI * 0.9;
    const jitter = hash(thing.id, 7);
    const r = starRadius(thing.size, scale);
    // 방 별의 고리 바깥부터 띄우고, 오래된 파일은 더 멀리 보냅니다.
    const distance = inner + r + spread * (stale ? 1.0 + 0.25 * jitter : 0.5 * jitter);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance * 0.8;
    // 이름표 자리에 떨어진 파일은 좌우로 비켜 줍니다. 이름표는 주름관이 커지면 함께 내려갑니다.
    const onLabel = Math.abs(dx) < labelHalfWidth + r && dy + r > half && dy - r < half * vaseLift + labelHeight;
    const side = (dx < 0 ? -1 : 1) * (labelHalfWidth + r + 4 + 30 * jitter);
    return {
      thing,
      stale,
      days,
      r,
      x: clamp(center.x + (onLabel ? side : dx), 14, sky.width - 14),
      y: clamp(center.y + dy, 14, sky.height - 14),
    };
  });
}

// 상자 밖 물건 중 오래된 것의 수.
export function staleCount(room: Room, now: number): number {
  return room.things.filter((thing) => !thing.box && thingAge(thing, room, now).stale).length;
}

export type RoomProgress = { lastActivityAt: number | null; recentCount: number };

// 있는 파일 중 마지막 활동과 최근 7일에 쓴 파일 수. 파일 기록으로는 몇 퍼센트 했는지 알 수 없어 비율은 내지 않습니다.
export function roomProgress(room: Room, now: number): RoomProgress {
  const live = room.things.filter((thing) => !thing.missing && !thing.box).map(lastActivity);
  return {
    lastActivityAt: live.reduce((latest, at) => Math.max(latest, at), 0) || null,
    recentCount: live.filter((at) => withinWeek(at, now)).length,
  };
}

// 활동을 모르는 방은 null이라 줄째 숨깁니다.
export function progressText({ lastActivityAt, recentCount }: RoomProgress, now: number): string | null {
  if (lastActivityAt === null) return null;
  return `마지막 작업 ${relativeDay(lastActivityAt, now)}${recentCount > 0 ? ` · 최근 7일에 ${recentCount}개 사용` : ""}`;
}

export type RoomStat = { usage: RoomUsage; stale: number; progress: RoomProgress };

// 집 화면이 한 번만 계산해 지도·요약·목록에 나눠 줍니다.
export function roomStats(rooms: Room[], now: number): Map<string, RoomStat> {
  return new Map(rooms.map((room) => [room.id, { usage: roomUsage(room), stale: staleCount(room, now), progress: roomProgress(room, now) }]));
}

// 지도 방 사이를 화살표로 옮겨 다닙니다. 양 끝에서는 반대쪽으로 넘어가고, 모르는 방에서는 첫 방부터 시작합니다.
export function stepRoom(ids: string[], currentId: string | null, key: string): string | null {
  if (ids.length === 0) return null;
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  if (step === 0) return null;
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  if (index < 0) return ids[0];
  return ids[(index + step + ids.length) % ids.length];
}

export function recentDays(now: number, count = 14): string[] {
  return Array.from({ length: count }, (_, i) => localDay(now - (count - 1 - i) * dayMs));
}

// 집 전체: 그날 쓴 방의 수.
export function homeActivity(rooms: Room[], now: number): { day: string; value: number }[] {
  return recentDays(now).map((day) => ({ day, value: rooms.filter((room) => room.workDays.includes(day)).length }));
}

// 방 하나: 그날 손대거나 고치거나 방 밖에서 연 물건 수(같은 날 여러 번이어도 한 번)와, 그날 방을 썼는지.
export function roomActivity(room: Room, now: number): { day: string; value: number; worked: boolean }[] {
  const counts = new Map<string, number>();
  for (const thing of room.things) {
    if (thing.missing) continue;
    for (const day of new Set([thing.touchedAt ?? 0, thing.lastModified, thing.lastUsedAt ?? 0].map((at) => localDay(at)))) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return recentDays(now).map((day) => ({
    day,
    value: counts.get(day) ?? 0,
    worked: room.workDays.includes(day),
  }));
}
