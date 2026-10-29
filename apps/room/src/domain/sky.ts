import { dayMs, localDay, roomUsage, sizeRatio, thingStage, type RoomUsage, type Stage } from "./care";
import type { Room, Thing } from "./model";

// 집 화면의 밤하늘. 방은 큰 별, 파일은 크기만큼의 작은 별이고, 손대지 않은 파일은 방에서 멀어집니다.
export const sky = { width: 1000, height: 680, centerX: 580, centerY: 380 } as const;

export type Point = { x: number; y: number };
export type Star = { thing: Thing; x: number; y: number; r: number; stage: Stage; days: number };

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

// 해바라기 씨 배치: 방이 몇 개든 가운데부터 고르게 퍼집니다.
export function roomSpots(count: number, size = 240): Point[] {
  if (count === 1) return [{ x: sky.centerX, y: sky.centerY }];
  return Array.from({ length: count }, (_, i) => {
    const radius = size * Math.sqrt((i + 0.5) / count);
    const angle = i * 2.39996 - Math.PI / 2;
    return {
      x: clamp(sky.centerX + radius * Math.cos(angle) * 1.25, 130, sky.width - 110),
      y: clamp(sky.centerY + radius * Math.sin(angle) * 0.95, 110, sky.height - 90),
    };
  });
}

export function clusterSpread(count: number): number {
  return clamp(230 / Math.sqrt(Math.max(1, count)), 80, 170);
}

export function roomRadius(room: Room, scale = 1): number {
  return (20 + 28 * sizeRatio(roomUsage(room).totalBytes)) * scale;
}

export function starRadius(bytes: number, scale = 1): number {
  return (4 + 8 * sizeRatio(bytes)) * scale;
}

export type Placed = { room: Room; at: Point; scale: number; spread: number; limit: number };

// 방이 적으면 모두 해바라기 배치. 많으면 진행 중인 방을 가운데에, 완료한 방은 바깥 고리에 작게 둡니다.
export function layoutRooms(rooms: Room[]): Placed[] {
  const active = rooms.filter((room) => !room.care.done);
  const done = rooms.filter((room) => room.care.done);
  if (rooms.length <= 8) {
    const spots = roomSpots(rooms.length);
    const spread = clusterSpread(rooms.length);
    return [...active, ...done].map((room, i) => ({ room, at: spots[i], scale: 1, spread, limit: 40 }));
  }
  const inner = roomSpots(active.length, 165);
  const scale = active.length <= 4 ? 1 : Math.max(0.6, Math.sqrt(4 / active.length));
  const spread = clamp(150 / Math.sqrt(Math.max(1, active.length)), 45, 120);
  // 가운데 방들의 별이 서로 섞이지 않게, 방마다 띄우는 파일 수를 줄입니다(전부는 오른쪽 목록에 있어요).
  const limit = clamp(Math.floor(100 / Math.max(1, active.length)), 8, 24);
  const rings = done.length > 22 ? 2 : 1;
  const perRing = Math.ceil(done.length / rings);
  return [
    ...active.map((room, i) => ({ room, at: inner[i], scale, spread, limit })),
    ...done.map((room, i) => {
      const ring = rings === 2 ? i % 2 : 0;
      const step = rings === 2 ? Math.floor(i / 2) : i;
      // 왼쪽 위(요약 글자 자리)는 비우고 나머지 둘레에 고르게 놓습니다.
      const angle = ((-80 + ((step + 0.5 + ring * 0.5) / perRing) * 275) * Math.PI) / 180;
      const rx = ring ? 335 : 410;
      const ry = ring ? 225 : 285;
      return {
        room,
        at: { x: clamp(sky.centerX + rx * Math.cos(angle), 40, sky.width - 40), y: clamp(sky.centerY + ry * Math.sin(angle), 40, sky.height - 40) },
        scale: 0.5,
        spread: 40,
        limit: 40,
      };
    }),
  ];
}

// 바닥에 놓인 물건부터, 남은 자리는 선반의 큰 파일로 채웁니다. 상자 속·사라진 파일은 하늘에 띄우지 않습니다.
// 오른쪽 목록도 이 물건들을 꼭 넣어, 지도에 뜬 파일마다 목록 줄이 있습니다.
export function pickStarThings(room: Room, limit: number): Thing[] {
  const live = room.things.filter((thing) => !thing.missing && !thing.box);
  return [...live.filter((thing) => thing.spot), ...live.filter((thing) => !thing.spot).sort((a, b) => b.size - a.size)].slice(0, limit);
}

export function roomStars(room: Room, center: Point, spread: number, now: number, limit = 40, scale = 1): Star[] {
  const picked = pickStarThings(room, limit);
  const inner = roomRadius(room, scale) + 14 * scale;
  return picked.map((thing) => {
    const { stage, days } = thingStage(thing, room.care, room.workDays, now);
    // 제자리 물건은 방 둘레 어디에나, 손대지 않은 물건은 하늘 바깥쪽으로 흘러가 다른 방과 섞이지 않습니다.
    const outward = Math.atan2(center.y - sky.centerY, center.x - sky.centerX);
    const lone = center.x === sky.centerX && center.y === sky.centerY;
    const angle = stage === "normal" || lone ? hash(thing.id) * Math.PI * 2 : outward + (hash(thing.id) - 0.5) * Math.PI * 0.9;
    const jitter = hash(thing.id, 7);
    const r = starRadius(thing.size, scale);
    // 방 별의 고리 바깥부터 띄우고, 오래 손대지 않을수록 더 멀리 보냅니다.
    const distance = inner + r + spread * (stage === "fallen" ? 1.0 + 0.25 * jitter : stage === "tilted" ? 0.65 + 0.2 * jitter : 0.5 * jitter);
    return {
      thing,
      stage,
      days,
      r,
      x: clamp(center.x + Math.cos(angle) * distance, 14, sky.width - 14),
      y: clamp(center.y + Math.sin(angle) * distance * 0.8, 14, sky.height - 14),
    };
  });
}

// 바닥에 놓인(상자 밖) 물건 중 기울어진 것과 쓰러진 것의 수.
export function roomMess(room: Room, now: number): { tilted: number; fallen: number } {
  let tilted = 0;
  let fallen = 0;
  for (const thing of room.things) {
    if (!thing.spot || thing.box) continue;
    const stage = thingStage(thing, room.care, room.workDays, now).stage;
    if (stage === "tilted") tilted += 1;
    if (stage === "fallen") fallen += 1;
  }
  return { tilted, fallen };
}

export type RoomStat = { usage: RoomUsage; mess: { tilted: number; fallen: number } };

// 집 화면이 한 번만 계산해 지도·요약·목록에 나눠 줍니다.
export function roomStats(rooms: Room[], now: number): Map<string, RoomStat> {
  return new Map(rooms.map((room) => [room.id, { usage: roomUsage(room), mess: roomMess(room, now) }]));
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

// 집 전체: 그날 손댄 방의 수.
export function homeActivity(rooms: Room[], now: number): { day: string; value: number }[] {
  return recentDays(now).map((day) => ({ day, value: rooms.filter((room) => room.workDays.includes(day)).length }));
}

// 방 하나: 그날 마지막으로 손댄 물건 수와, 그날 방을 썼는지.
export function roomActivity(room: Room, now: number): { day: string; value: number; worked: boolean }[] {
  return recentDays(now).map((day) => ({
    day,
    value: room.things.filter((thing) => thing.touchedAt !== null && localDay(thing.touchedAt) === day).length,
    worked: room.workDays.includes(day),
  }));
}
