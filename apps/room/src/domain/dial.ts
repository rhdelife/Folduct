import { colorGroups } from "../art/palette";
import { kindParts } from "../art/vases";
import { dayMs, lastActivity, localDay } from "./care";
import type { Kind, Room, Thing } from "./model";

// 방 모음의 화병와 다이얼. 화면과 무관한 계산만 둡니다.

export const dialSlots = 7;
export const dialPitch = 360 / dialSlots;

// 다이얼 위 각도. 0도가 12시, 양수가 시계 방향입니다.
// 일곱 장까지는 12시를 중심으로 왼쪽부터 놓습니다. 일곱 장부터는 띠가 한 바퀴 이상이라 ±180도(늘 화면 밖)에서 다음 방과 갈마듭니다.
export function dialAngle(index: number, count: number, spin: number): number {
  if (count < dialSlots) return (index - (count - 1) / 2) * dialPitch + spin;
  const total = count * dialPitch;
  const angle = (((index * dialPitch + spin) % total) + total) % total;
  return angle > total / 2 ? angle - total : angle;
}

export const onDial = (angle: number) => Math.abs(angle) < 180;

// 방이 적으면 끝 화병가 12시를 넘지 않게 멈춥니다. 빈 다이얼만 남는 일이 없어요.
export function clampSpin(spin: number, count: number): number {
  if (count >= dialSlots) return spin;
  const limit = Math.max(20, ((count - 1) / 2) * dialPitch);
  return Math.min(limit, Math.max(-limit, spin));
}

// 12시에서 시계 방향으로 세로줄 순서를 매깁니다. 다이얼 밖 화병는 줄에 서지 않아요.
export function columnOrder(angles: number[]): number[] {
  const order = angles.map(() => 0);
  angles
    .map((angle, index) => ({ index, angle, turn: (angle + dialPitch / 2 + 720) % 360 }))
    .filter(({ angle }) => onDial(angle))
    .sort((a, b) => a.turn - b.turn)
    .forEach(({ index }, place) => void (order[index] = place));
  return order;
}

export type DialGeometry = { width: number; height: number; radius: number; center: number; miniRadius: number; miniScale: number; ringCenter: number; focusTop: number; focusScale: number; nameGap: number; vh: number };

// 반지름도 가로 오프셋도 vh입니다. 좁은 창에서도 곡선이 같고, 대부분 화면 밖에 있어 더 돌릴 게 있다는 걸 알려요.
// 낮은 창에서는 큰 화병를 조금 올려 버튼이 아래 작은 화병에 닿지 않게 합니다.
export function dialGeometry(viewWidth: number, viewHeight: number): DialGeometry {
  const vh = viewHeight / 100;
  const [width, radius, center, miniRadius, miniScale, focusTop, focusScale, nameGap] =
    viewWidth > 1024 ? [170, 46, 102, 7, 0.18, 32, 1.32, 16] : viewWidth > 600 ? [130, 40, 102, 6, 0.2, 30, 1.18, 14] : [122, 38, 82, 5.5, 0.22, 28, 1.05, 10];
  return { width, height: width * 1.25, radius: radius * vh, center: center * vh, miniRadius: miniRadius * vh, miniScale, ringCenter: 88 * vh, focusTop: (viewHeight < 600 ? focusTop - 5 : focusTop) * vh, focusScale, nameGap, vh };
}

export type Pose = { x: number; y: number; rot: number; scale: number };

const sin = (degrees: number) => Math.sin((degrees * Math.PI) / 180);
const cos = (degrees: number) => Math.cos((degrees * Math.PI) / 180);

export const dialPose = (angle: number, g: DialGeometry): Pose => ({ x: g.radius * sin(angle), y: g.center - g.radius * cos(angle), rot: angle, scale: 1 });
export const ringPose = (angle: number, g: DialGeometry): Pose => ({ x: g.miniRadius * sin(angle), y: g.ringCenter - g.miniRadius * cos(angle), rot: angle, scale: g.miniScale });
export const focusPose = (g: DialGeometry): Pose => ({ x: 0, y: g.focusTop, rot: 0, scale: g.focusScale });
export const columnPose = (place: number, g: DialGeometry): Pose => ({ x: 0, y: (8 + 18 * place) * g.vh, rot: 0, scale: 0.55 });
export const mixPose = (a: Pose, b: Pose, t: number): Pose => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, rot: a.rot + (b.rot - a.rot) * t, scale: a.scale + (b.scale - a.scale) * t });

// 이름은 커진 화병 바로 아래에 옵니다.
export const nameTop = (g: DialGeometry) => g.focusTop + (g.height * (1 + g.focusScale)) / 2 + g.nameGap;

export type DialFacts = { kind: Kind; lastAt: number; latest: Thing | null; biggest: Thing | null };

// 화병 바탕을 정할 가장 큰 형식과, 자세히 보기에 올릴 파일. 파일이 없으면 기타 색입니다.
export function roomFacts(room: Room): DialFacts {
  const parts = kindParts(room.things);
  const top = parts.reduce<(typeof parts)[number] | null>((best, part) => (!best || part.size > best.size ? part : best), null);
  const kind = colorGroups.find((group) => group.label === top?.label)?.kinds[0] ?? "unknown";
  const alive = room.things.filter((thing) => !thing.missing);
  const latest = alive.reduce<Thing | null>((best, thing) => (lastActivity(thing) > 0 && (!best || lastActivity(thing) > lastActivity(best)) ? thing : best), null);
  const biggest = alive.reduce<Thing | null>((best, thing) => (!best || thing.size > best.size ? thing : best), null);
  return { kind, lastAt: latest ? lastActivity(latest) : 0, latest, biggest };
}

// 화병이 찬 높이. 한도가 있으면 지도와 같이 한도 대비 용량이고, 없으면 한도처럼 보이지 않게 조금 덜 채웁니다.
export const vaseFill = (room: Room, bytes: number) => (room.budgetBytes ? bytes / room.budgetBytes : 0.8);

// 최근 며칠 중 방을 쓴 날. 오래된 날이 앞입니다. 정오에서 빼서 서머타임에도 하루씩 넘어가요.
export function recentWork(workDays: string[], now: number, days = 14): boolean[] {
  const noon = new Date(now).setHours(12, 0, 0, 0);
  const worked = new Set(workDays);
  return Array.from({ length: days }, (_, i) => worked.has(localDay(noon - (days - 1 - i) * dayMs)));
}
