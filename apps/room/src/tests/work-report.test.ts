import { describe, expect, it } from "vitest";
import { currentPeriod, lastPeriod, normalizeEvery, normalizeNotes, normalizeReports, periodLabel, periodWork, reportDue, reportInput, shiftPeriod, withReport, type WorkNote } from "../domain/workReport";
import { addWork } from "../domain/worklog";

// 2026-11-13은 금요일이에요.
const friday = new Date(2026, 10, 13, 15).getTime();

describe("보고 기간", () => {
  it("하루·주(월~일)·달을 세요", () => {
    expect(currentPeriod("day", friday)).toEqual({ from: "2026-11-13", to: "2026-11-13" });
    expect(currentPeriod("week", friday)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(currentPeriod("month", friday)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(currentPeriod("week", new Date(2026, 10, 15, 23).getTime())).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });

  it("막 끝난 기간은 어제·지난주·지난달이에요", () => {
    expect(lastPeriod("day", friday)).toEqual({ from: "2026-11-12", to: "2026-11-12" });
    expect(lastPeriod("week", friday)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(lastPeriod("month", new Date(2026, 0, 5, 12).getTime())).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("앞뒤로 넘겨요", () => {
    expect(shiftPeriod("month", { from: "2026-02-01", to: "2026-02-28" }, 1)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(shiftPeriod("week", { from: "2026-11-09", to: "2026-11-15" }, -1)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
  });

  it("끈 상태거나 이미 만든 기간이면 만들 때가 아니에요", () => {
    expect(reportDue("off", [], friday)).toBeNull();
    expect(reportDue("week", [], friday)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(reportDue("week", [{ from: "2026-11-02", to: "2026-11-08", text: "t", at: 1, model: "m" }], friday)).toBeNull();
  });

  it("보이는 이름", () => {
    expect(periodLabel({ from: "2026-11-02", to: "2026-11-08" })).toBe("11월 2일 ~ 11월 8일");
    expect(periodLabel({ from: "2026-11-13", to: "2026-11-13" })).toBe("11월 13일");
  });
});

describe("기간 안의 작업과 보내는 내용", () => {
  const hour = 3_600_000;
  const log = addWork(addWork(addWork({}, "2026-11-10", "a", 2 * hour), "2026-11-11", "b", hour), "2026-11-20", "a", hour);
  const notes: WorkNote[] = [{ id: "1", day: "2026-11-11", roomId: "a", text: "표지 고침", at: 2 }, { id: "2", day: "2026-11-30", roomId: null, text: "밖", at: 3 }];
  const names = new Map([["a", "졸업 작품"]]);
  const week = { from: "2026-11-09", to: "2026-11-15" };

  it("기간 밖은 빼고, 지운 방은 이름 대신 지운 방으로 모아요", () => {
    const work = periodWork(log, notes, week, names);
    expect(work.totalMs).toBe(3 * hour);
    expect(work.rooms).toEqual([["졸업 작품", 2 * hour], ["지운 방", hour]]);
    expect(work.notes.map((note) => note.id)).toEqual(["1"]);
  });

  it("시간·적은 줄만 보내고 방 id는 보내지 않아요", () => {
    const input = reportInput(week, periodWork(log, notes, week, names), names);
    expect(input).toContain("졸업 작품: 120분");
    expect(input).toContain("[졸업 작품] 표지 고침");
    expect(input).not.toMatch(/\ba:|\bb:/);
  });
});

describe("저장된 값 읽기", () => {
  it("망가진 줄과 보고는 버려요", () => {
    expect(normalizeNotes([{ id: "1", day: "2026-11-13", text: " 한 일 " }, { id: "2", day: "어제", text: "x" }, { id: "3", day: "2026-11-13", text: "  " }, 3])).toEqual([{ id: "1", day: "2026-11-13", roomId: null, text: "한 일", at: 0 }]);
    expect(normalizeNotes("x")).toEqual([]);
    expect(normalizeReports([{ from: "2026-11-02", to: "2026-11-08", text: "t" }, { from: "x" }])).toEqual([{ from: "2026-11-02", to: "2026-11-08", text: "t", at: 0, model: "" }]);
    expect(normalizeEvery("week")).toBe("week");
    expect(normalizeEvery("hourly")).toBe("off");
  });

  it("같은 기간 보고는 바꿔 끼워요", () => {
    const old = { from: "2026-11-02", to: "2026-11-08", text: "옛", at: 1, model: "m" };
    expect(withReport([old], { ...old, text: "새", at: 2 })).toEqual([{ ...old, text: "새", at: 2 }]);
  });
});
