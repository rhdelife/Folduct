// 형식별 종이 더미: 형식 하나가 더미 하나입니다. 큰 더미부터 놓아요.
export const pileMaxSheets = 8;

export type Pile = { at: number; sheets: number };

// 47KB와 5GB가 함께 있어 실제 비율로는 그릴 수 없습니다. 장수는 용량의 로그를 따르고 숫자는 옆에 적어요.
// 파일이 1개인 형식이 여러 장으로 보이면 안 되니, 파일 수보다 많이 쌓지 않습니다.
export function pileSheets(sizes: { count: number; bytes: number }[]): Pile[] {
  const weight = (bytes: number) => Math.log2(1 + bytes / 1024);
  const filled = sizes.map((size, at) => ({ at, bytes: size.bytes, count: size.count })).filter((size) => size.count > 0).sort((a, b) => b.bytes - a.bytes);
  const top = filled.length > 0 ? weight(filled[0].bytes) : 0;
  return filled.map(({ at, bytes, count }) => ({ at, sheets: Math.min(count, top > 0 ? Math.max(1, Math.round((weight(bytes) / top) * pileMaxSheets)) : 1) }));
}
