// 방 오브제: 배경을 뺀 이미지를 실루엣과 망점 두 장으로 바꿉니다. 색은 그릴 때 입혀서 저장한 그림은 흰색 틀뿐이에요. 화면과 무관한 계산만 둡니다.
export type Pixels = { width: number; height: number; data: ArrayLike<number> };
export type Box = { x: number; y: number; w: number; h: number };
export type Dot = { x: number; y: number; r: number };

// source는 다시 굵기를 고를 때 쓰는 원본, height는 정사각형 안에서 물체가 차지하는 높이 비율(0~1)입니다.
export type RoomMark = { source: string; cell: number; silhouette: string; dots: string; height: number };

export const markSize = 256;
export const dotSizes = [{ label: "잘게", cell: 6 }, { label: "보통", cell: 8 }, { label: "굵게", cell: 11 }];
export const defaultCell = 8;

const solidAlpha = 128;
const clearAlpha = 16;

// 배경이 빠진 이미지인지: 투명한 곳과 물체가 모두 있어야 합니다.
export function isCutout({ width, height, data }: Pixels): boolean {
  let clear = 0;
  let solid = 0;
  for (let at = 3; at < width * height * 4; at += 4) {
    if (data[at] < clearAlpha) clear += 1;
    else if (data[at] >= solidAlpha) solid += 1;
  }
  const least = width * height * 0.01;
  return clear >= least && solid >= least;
}

export function subjectBox({ width, height, data }: Pixels): Box | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < solidAlpha) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

// 정사각형 안에 비율을 지켜 넣습니다. 물체는 가로 가운데, 바닥에 붙어요. 층이 바닥부터 차오르니까요.
export function fitToSquare(width: number, height: number, size: number): Box {
  const scale = size / Math.max(width, height);
  const w = width * scale;
  const h = height * scale;
  return { x: (size - w) / 2, y: size - h, w, h };
}

const luminance = (data: ArrayLike<number>, at: number) => (0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]) / 255;

// 격자를 반 칸씩 엇갈려 찍습니다. 어두울수록 점이 커요. 물체 안의 밝기 범위를 넓혀, 어두운 사진이나 밝은 사진도 또렷하게 나옵니다.
export function halftoneDots({ width, height, data }: Pixels, cell: number): Dot[] {
  let darkest = 1;
  let lightest = 0;
  for (let at = 0; at < width * height * 4; at += 4) {
    if (data[at + 3] < solidAlpha) continue;
    const lum = luminance(data, at);
    darkest = Math.min(darkest, lum);
    lightest = Math.max(lightest, lum);
  }
  const range = lightest - darkest;
  const dots: Dot[] = [];
  let row = 0;
  for (let y = cell / 2; y < height; y += cell, row += 1) {
    for (let x = cell / 2 + (row % 2 ? cell / 2 : 0); x < width; x += cell) {
      const at = (Math.floor(y) * width + Math.floor(x)) * 4;
      if (data[at + 3] < solidAlpha) continue;
      const light = range > 0 ? (luminance(data, at) - darkest) / range : 0.5;
      dots.push({ x, y, r: cell * (0.12 + 0.5 * (1 - light)) });
    }
  }
  return dots;
}

// 층 높이는 화병 좌표(바닥 y=100, 위 y=-100) 기준입니다. 물체가 정사각형을 다 채우지 않으면 그 높이 안으로 줄입니다.
export function fitBand<T extends { y: number; height: number }>(band: T, markHeight: number): T {
  return { ...band, y: 100 - (100 - band.y) * markHeight, height: band.height * markHeight };
}
