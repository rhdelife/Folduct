import { describe, expect, it } from "vitest";
import { addWork, formatWork, formatWorkShort, normalizeWorkLog, workAmount, yearMonths, yearWork } from "../domain/worklog";

const min = 60_000;
const hour = 60 * min;

describe("작업 시간 쌓기", () => {
  it("같은 날 같은 방은 더하고, 다른 방은 따로 둬요", () => {
    let log = addWork({}, "2026-11-04", "a", 10 * min);
    log = addWork(log, "2026-11-04", "a", 5 * min);
    log = addWork(log, "2026-11-04", "b", 1 * min);
    expect(log).toEqual({ "2026-11-04": { a: 15 * min, b: 1 * min } });
  });

  it("0이나 망가진 값은 쌓지 않아요", () => {
    const log = { "2026-11-04": { a: min } };
    expect(addWork(log, "2026-11-04", "a", 0)).toBe(log);
    expect(addWork(log, "2026-11-04", "a", -5)).toBe(log);
    expect(addWork(log, "2026-11-04", "a", Number.NaN)).toBe(log);
  });
});

describe("저장된 기록 읽기", () => {
  it("없거나 망가지면 빈 기록이에요", () => {
    for (const value of [undefined, null, 3, "기록", []]) expect(normalizeWorkLog(value)).toEqual({});
  });

  it("망가진 칸만 버려요", () => {
    expect(normalizeWorkLog({ "2026-11-04": { a: 5, b: "많이", c: -1 }, "2026-11-05": 3, "2026-11-06": { d: "x" } })).toEqual({ "2026-11-04": { a: 5 } });
  });
});

describe("한 해 합계", () => {
  const log = { "2026-01-01": { a: hour }, "2026-11-04": { a: hour, b: 3 * hour }, "2025-12-31": { a: 9 * hour } };

  it("그해 것만 모아 방별로 많은 순이에요", () => {
    const year = yearWork(log, 2026);
    expect(year.totalMs).toBe(5 * hour);
    expect(year.days.size).toBe(2);
    expect(year.days.get("2026-11-04")).toBe(4 * hour);
    expect(year.rooms).toEqual([["b", 3 * hour], ["a", 2 * hour]]);
  });

  it("기록이 없으면 비어 있어요", () => {
    expect(yearWork({}, 2026)).toMatchObject({ totalMs: 0, rooms: [] });
  });
});

describe("시간 글자", () => {
  it("큰 숫자는 분, 소수 한 자리, 시간 순으로 바뀌어요", () => {
    expect(workAmount(0)).toEqual({ value: "0", unit: "시간" });
    expect(workAmount(10_000)).toEqual({ value: "1", unit: "분" });
    expect(workAmount(35 * min)).toEqual({ value: "35", unit: "분" });
    expect(workAmount(100 * min)).toEqual({ value: "1.7", unit: "시간" });
    expect(workAmount(42.4 * hour)).toEqual({ value: "42", unit: "시간" });
  });

  it("줄 글자는 시간과 분이에요", () => {
    expect(formatWork(10_000)).toBe("1분");
    expect(formatWork(hour)).toBe("1시간");
    expect(formatWork(130 * min)).toBe("2시간 10분");
  });
});

describe("일력 칸", () => {
  it("한 줄이 한 달이고 윤년도 맞아요", () => {
    const months = yearMonths(2028);
    expect(months).toHaveLength(12);
    expect(months[1]).toHaveLength(29);
    expect(yearMonths(2026)[1]).toHaveLength(28);
    expect(months.flat()).toHaveLength(366);
    expect(months[10][3]).toBe("2028-11-04");
  });
  it("그래프 시간은 영어 단위 짧은 꼴이에요", () => {
    const min = 60_000;
    expect(formatWorkShort(0)).toBe("0m");
    expect(formatWorkShort(10_000)).toBe("1m");
    expect(formatWorkShort(222 * min)).toBe("3h 42m");
    expect(formatWorkShort(120 * min)).toBe("2h");
    expect(formatWorkShort((38 * 60 + 5) * min)).toBe("1d 14h");
    expect(formatWorkShort(48 * 60 * min)).toBe("2d");
  });
});
