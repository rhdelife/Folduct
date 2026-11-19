import { describe, expect, it } from "vitest";
import { addWork, dayLevel, formatWork, formatWorkShort, normalizeWorkLog, periodName, periodRows, periodWork, workAmount, yearMonths, yearWork } from "../domain/worklog";

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

describe("작업 기록 카드 보기 기준", () => {
  // 2026-11-18은 수요일이에요.
  const now = new Date(2026, 10, 18, 12).getTime();
  it("주는 월~일 한 줄, 달은 월요일부터 시작하는 요일 7칸 달력, 해는 열두 줄이에요", () => {
    expect(periodRows("week", now)).toEqual([["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]]);
    const month = periodRows("month", now);
    // 11월 1일은 일요일이라 앞에 빈 칸 여섯이에요.
    expect(month[0]).toEqual(["", "", "", "", "", "", "2026-11-01"]);
    expect(month.every((row) => row.length === 7)).toBe(true);
    expect(month.flat().filter(Boolean)).toHaveLength(30);
    expect(periodRows("year", now)).toHaveLength(12);
  });
  it("고른 기간 안의 날만 더해요", () => {
    const log = { "2026-11-17": { a: 60_000, b: 30_000 }, "2026-11-02": { a: 10_000 }, "2026-10-31": { a: 5_000 } };
    expect(periodWork(log, "week", now).totalMs).toBe(90_000);
    expect(periodWork(log, "month", now).totalMs).toBe(100_000);
    expect(periodWork(log, "year", now)).toMatchObject({ totalMs: 105_000 });
    expect(periodWork(log, "week", now).days.size).toBe(1);
  });
});

describe("기간 이름", () => {
  it("'올해·이번 달' 대신 연도·영문 달 이름·주 날짜 범위로 써요", () => {
    const now = new Date(2026, 10, 18, 15).getTime();
    expect(periodName("year", now)).toBe("2026");
    expect(periodName("month", now)).toBe("November");
    expect(periodName("week", now)).toBe("Nov 16–22");
    expect(periodName("week", new Date(2026, 8, 30, 9).getTime())).toBe("Sep 28 – Oct 4");
  });
});

describe("카드 점 색·진하기", () => {
  it("날마다 일한 방을 오래 한 순서로 모두 고르고, 1·2·4시간을 넘을 때마다 진해져요", () => {
    const now = new Date(2026, 10, 18, 15).getTime();
    const log = { "2026-11-17": { a: 30 * 60_000, b: 90 * 60_000, c: 0 }, "2026-11-18": { a: 5 * 3_600_000 } };
    const work = periodWork(log, "week", now);
    expect([...work.tops]).toEqual([["2026-11-17", ["b", "a"]], ["2026-11-18", ["a"]]]);
    expect([59, 60, 119, 120, 239, 240].map((minutes) => dayLevel(minutes * 60_000))).toEqual([1, 2, 2, 3, 3, 4]);
  });
});
