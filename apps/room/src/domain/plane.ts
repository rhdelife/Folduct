import type { Spot, Thing } from "./model";

// 방은 floor×floor 칸의 평평한 판입니다. 화면에는 960×600 판으로 그리고 틀 너비에 맞춰 줄입니다.
export const plane = { floor: 10, width: 960, height: 600 } as const;

export function toScreen(spot: Spot): { left: number; top: number } {
  return { left: (spot.x / plane.floor) * plane.width, top: (spot.y / plane.floor) * plane.height };
}

// 화면에서 끈 거리(px)를 판 위 칸 거리로 바꿉니다. toScreen의 역변환입니다.
export function screenDeltaToFloor(dx: number, dy: number): Spot {
  return { x: (dx / plane.width) * plane.floor, y: (dy / plane.height) * plane.floor };
}

export function clampSpot(spot: Spot): Spot {
  const clamp = (value: number, min: number) => Math.min(plane.floor - min, Math.max(min, value));
  return { x: clamp(spot.x, 0.6), y: clamp(spot.y, 0.9) };
}

// 정리 상자 자리(왼쪽 아래)는 비워 둡니다.
export const boxSpot: Spot = { x: 0.9, y: 8.6 };

export function freeSpot(things: Thing[], seed: number): Spot {
  const taken = things.filter((thing) => thing.spot && !thing.box).map((thing) => thing.spot!);
  const near = (a: Spot, b: Spot) => Math.abs(a.x - b.x) < 1.1 && Math.abs(a.y - b.y) < 1.1;
  for (let ring = 0; ring < 40; ring += 1) {
    const step = seed + ring * 7;
    const candidate = clampSpot({ x: 2 + ((step * 3) % 7) + (step % 2) * 0.5, y: 1.5 + ((step * 5) % 7) });
    if (!near(candidate, boxSpot) && !taken.some((spot) => near(spot, candidate))) return candidate;
  }
  return clampSpot({ x: 2 + (seed % 7), y: 2 + ((seed * 3) % 6) });
}

// 아래쪽에 있는 물건이 앞에 보입니다.
export function depth(spot: Spot): number {
  return Math.round(spot.y * 10) + 10;
}
