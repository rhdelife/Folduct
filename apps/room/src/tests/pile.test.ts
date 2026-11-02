import { describe, expect, it } from "vitest";
import { pileMaxSheets, pileSheets } from "../domain/pile";

const GB = 1024 ** 3;
const size = (bytes: number, count = 100) => ({ bytes, count });

describe("형식별 종이 더미", () => {
  it("빈 형식은 더미가 없고, 파일이 없으면 더미도 없어요", () => {
    expect(pileSheets([size(0, 0), size(0, 0)])).toEqual([]);
    expect(pileSheets([size(0, 0), size(100)]).map((pile) => pile.at)).toEqual([1]);
  });

  it("큰 더미가 먼저 오고, 가장 큰 더미가 최대 장수예요", () => {
    const piles = pileSheets([size(1024), size(5 * GB), size(1024 ** 2)]);
    expect(piles.map((pile) => pile.at)).toEqual([1, 2, 0]);
    expect(piles[0].sheets).toBe(pileMaxSheets);
    expect(piles[1].sheets).toBeLessThan(piles[0].sheets);
    expect(piles[2].sheets).toBeLessThan(piles[1].sheets);
  });

  it("아무리 큰 형식도 최대 장수를 넘지 않아요", () => {
    for (const pile of pileSheets([size(5 * 1024 * GB), size(GB)])) expect(pile.sheets).toBeLessThanOrEqual(pileMaxSheets);
  });

  it("파일 수보다 많이 쌓지 않아요", () => {
    expect(pileSheets([size(5 * GB, 1)])[0].sheets).toBe(1);
    expect(pileSheets([size(5 * GB, 3)])[0].sheets).toBe(3);
  });

  it("아주 작은 형식도 한 장은 보여요", () => {
    const piles = pileSheets([size(5 * 1024 * GB), size(1)]);
    expect(piles[1].sheets).toBe(1);
  });

  it("0바이트만 있어도 NaN 없이 한 장씩이에요", () => {
    expect(pileSheets([size(0), size(0)]).map((pile) => pile.sheets)).toEqual([1, 1]);
  });
});
