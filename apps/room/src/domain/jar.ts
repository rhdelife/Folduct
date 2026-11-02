// 한 병: 내 파일 전체를 큰 화병 하나에 형식별 층으로 담습니다. 큰 층이 아래로 가라앉아요.
// 좌표는 화병과 같습니다. 바닥이 y=100, 어깨가 y=-52이고 목은 비워 둡니다.
const floor = 100;
const shoulder = -52;
// 아무리 작은 층도 평균 두께의 이만큼은 받아 누를 수 있습니다.
const minShare = 0.55;

export type JarLayer = { at: number; y: number; height: number };

// 47KB와 5GB가 함께 있어 실제 비율로는 그릴 수 없습니다. 두께는 용량의 로그를 따르고, 숫자는 옆에 적어요.
export function jarLayers(sizes: { count: number; bytes: number }[]): JarLayer[] {
  const filled = sizes.map((size, at) => ({ at, bytes: size.bytes, count: size.count })).filter((size) => size.count > 0).sort((a, b) => b.bytes - a.bytes);
  if (filled.length === 0) return [];
  const span = floor - shoulder;
  const least = (span / filled.length) * minShare;
  const weights = filled.map(({ bytes }) => Math.log2(1 + bytes / 1024));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const spare = span - least * filled.length;
  let bottom = floor;
  return filled.map(({ at }, index) => {
    const height = least + (total > 0 ? (spare * weights[index]) / total : spare / filled.length);
    bottom -= height;
    return { at, y: bottom, height };
  });
}
