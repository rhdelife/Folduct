// Eagle처럼 이미지마다 많이 쓴 색을 뽑아, 색을 하나 고르면 그 색 이미지만 모아 봐요.
// 색 이름은 글자로만 보여 줘요. Folduct에서 칠하는 색은 파일 형식 몫이고, 이미지의 색은 미리보기 자체가 보여 줘요.

export const hues = ["빨강", "주황", "노랑", "초록", "파랑", "보라", "분홍", "갈색", "흰색", "회색", "검정"] as const;
export type Hue = (typeof hues)[number];

const plain = new Set<Hue>(["흰색", "회색", "검정"]);

export function hueOf(r: number, g: number, b: number): Hue {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  if (light < 0.16) return "검정";
  if (light > 0.92) return "흰색";
  if (sat < 0.18) return light > 0.8 ? "흰색" : light < 0.25 ? "검정" : "회색";
  const d = max - min;
  const R = r / 255, G = g / 255, B = b / 255;
  const deg = (60 * (max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4) + 360) % 360;
  if (deg >= 12 && deg < 45 && light < 0.42) return "갈색";
  if (deg < 12 || deg >= 345) return "빨강";
  if (deg < 45) return "주황";
  if (deg < 68) return "노랑";
  if (deg < 170) return "초록";
  if (deg < 255) return "파랑";
  if (deg < 290) return "보라";
  return "분홍";
}

// RGBA 화소에서 가장 넓은 색. 흰 바탕 위 사물처럼 흰색·회색·검정이 가장 넓어도, 다른 색이 1/5을 넘으면 그 색으로 봐요.
export function mainHue(pixels: ArrayLike<number>): Hue | null {
  const count = new Map<Hue, number>();
  let seen = 0;
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    if (pixels[at + 3] < 128) continue; // 투명한 곳은 세지 않아요.
    const hue = hueOf(pixels[at], pixels[at + 1], pixels[at + 2]);
    count.set(hue, (count.get(hue) ?? 0) + 1);
    seen += 1;
  }
  if (seen === 0) return null;
  const ranked = [...count].sort((a, b) => b[1] - a[1]);
  const colorful = ranked.find(([hue]) => !plain.has(hue));
  return colorful && colorful[1] >= seen / 5 ? colorful[0] : ranked[0][0];
}
