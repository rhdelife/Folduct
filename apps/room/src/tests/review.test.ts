import { describe, expect, it } from "vitest";
import { dayMs, reviewDays, sweepDue } from "../domain/care";

describe("Review 주기", () => {
  it("고른 적 없거나 고를 수 없는 값은 7일로 읽어요", () => {
    expect([undefined, null, 7, 3, 14, 30, 5, "7", 0, Number.NaN].map(reviewDays)).toEqual([7, 7, 7, 3, 14, 30, 7, 7, 7, 7]);
  });

  it("마지막 Review에서 고른 주기만큼 지나야 다시 떠요", () => {
    const last = 1_000 * dayMs;
    expect(sweepDue(last, last + 6 * dayMs)).toBe(false);
    expect(sweepDue(last, last + 7 * dayMs)).toBe(true);
    expect(sweepDue(last, last + 3 * dayMs, 3)).toBe(true);
    expect(sweepDue(last, last + 13 * dayMs, 14)).toBe(false);
    expect(sweepDue(null, last, 3)).toBe(false);
  });
});
