import { vaseIndex, vasePaths } from "../art/vases";
import type { RoomFace } from "./model";
import { hash } from "./sky";

// 방의 얼굴: 화병 모양과 목 색. 이름을 읽지 않아도 어떤 프로젝트인지 알아보게 합니다. 크기는 용량, 안쪽 층은 파일 형식의 몫이에요.
export const faceColors = ["남색", "초록", "와인", "보라", "황토", "청록", "벽돌", "먹색"];
export const faceColorVar = (color: number) => `var(--face-${color + 1})`;

// 예전 방은 방 id로 정해지던 모양을 그대로 씁니다. 익숙한 화병이 바뀌지 않게요.
export function defaultFace(id: string): RoomFace {
  return { shape: vaseIndex(id), color: Math.floor(hash(id, 12) * faceColors.length) };
}

const inRange = (value: unknown, count: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < count;

export function normalizeFace(value: unknown, id: string): RoomFace {
  const face = (value ?? {}) as Partial<RoomFace>;
  const fallback = defaultFace(id);
  return { shape: inRange(face.shape, vasePaths.length) ? face.shape : fallback.shape, color: inRange(face.color, faceColors.length) ? face.color : fallback.color, ...(typeof face.mark === "number" ? { mark: face.mark } : {}) };
}

// 가장 덜 쓰인 번호 중 하나. 같은 순서로 만들어도 방마다 조금씩 다르게 고릅니다.
function leastUsed(used: number[], count: number, seed: number): number {
  const counts = Array.from({ length: count }, (_, at) => used.filter((item) => item === at).length);
  const fewest = Math.min(...counts);
  const open = counts.flatMap((uses, at) => (uses === fewest ? [at] : []));
  return open.at(Math.floor(seed * open.length))!;
}

// 새 방은 이미 있는 방과 되도록 겹치지 않는 얼굴을 받습니다.
export function pickFace(taken: RoomFace[], id: string): RoomFace {
  return {
    shape: leastUsed(taken.map((face) => face.shape), vasePaths.length, hash(id, 13)),
    color: leastUsed(taken.map((face) => face.color), faceColors.length, hash(id, 14)),
  };
}
