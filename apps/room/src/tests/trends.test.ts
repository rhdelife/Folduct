import { describe, expect, it } from "vitest";
import { buckets, periodTotal, roomTotals, todayWork, weekdayAverage } from "../domain/trends";
import type { WorkLog } from "../domain/worklog";

const hour = 60 * 60 * 1000;
// 2026-11-13은 금요일이에요.
const now = new Date(2026, 10, 13, 15).getTime();
const log: WorkLog = {
  "2026-11-13": { a: hour },
  "2026-11-12": { a: hour, b: 2 * hour },
  "2026-11-11": { b: hour },
  "2026-11-09": { a: 4 * hour },
  "2026-11-02": { a: 2 * hour },
  "2026-03-05": { c: 3 * hour },
};

describe("추세", () => {
  it("오늘 시간을 세요", () => {
    expect(todayWork(log, now)).toBe(hour);
  });

  it("주는 월요일부터 하루씩, 년은 달마다 모아요", () => {
    const week = buckets(log, "week", now);
    expect(week.map((b) => b.ms / hour)).toEqual([4, 0, 1, 3, 1, 0, 0]);
    expect(week[0].label).toBe("11월 9일");
    const year = buckets(log, "year", now);
    expect(year).toHaveLength(12);
    expect(year[2]).toEqual({ label: "2026년 3월", ms: 3 * hour, rooms: { c: 3 * hour } });
    // 칸마다 방별 시간도 모아요(막대를 방 색으로 쌓아요).
    expect(week[0].rooms).toEqual({ a: 4 * hour });
    expect(year[10].rooms).toEqual({ a: 8 * hour, b: 3 * hour });
    expect(year[10].ms).toBe(11 * hour);
    expect(buckets(log, "month", now)).toHaveLength(30);
    // 합계는 기록의 첫 달(3월)부터 이번 달까지예요.
    expect(buckets(log, "all", now).map((b) => b.label)).toEqual(["2026년 3월", "2026년 4월", "2026년 5월", "2026년 6월", "2026년 7월", "2026년 8월", "2026년 9월", "2026년 10월", "2026년 11월"]);
    expect(periodTotal(log, "all", now)).toBe(14 * hour);
    expect(periodTotal(log, "week", now)).toBe(9 * hour);
  });

  it("작업한 날 평균과 요일별 평균, 방별 합계를 내요", () => {
    const { average, byWeekday } = weekdayAverage(log, "month", now);
    expect(average).toBe((11 * hour) / 5);
    // 월요일은 11/2(2시간)·11/9(4시간)의 평균이에요.
    expect(byWeekday[0]).toBe(3 * hour);
    expect(byWeekday[5]).toBe(0);
    expect(roomTotals(log, "month", now)).toEqual([["a", 8 * hour], ["b", 3 * hour]]);
  });
});
