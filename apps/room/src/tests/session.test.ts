import { describe, expect, it } from "vitest";
import { checkpointSession, defaultPet, formatWorked, normalizePet, normalizeSession, pauseSession, restoreSession, resumeSession, startSession, workedTime } from "../domain/session";

describe("작업 시간", () => {
  it("작업 중인 시간만 쌓이고 멈춘 시간은 세지 않아요", () => {
    const started = startSession("r", 1000);
    expect(workedTime(started, 4000)).toBe(3000);
    const paused = pauseSession(started, 4000);
    expect(paused).toMatchObject({ status: "paused", workedMs: 3000, since: null });
    expect(workedTime(paused, 90000)).toBe(3000);
    const resumed = resumeSession(paused, 90000);
    expect(workedTime(resumed, 92000)).toBe(5000);
  });

  it("시계가 뒤로 가도 시간이 줄지 않아요", () => {
    expect(workedTime(startSession("r", 5000), 1000)).toBe(0);
  });

  it("틈틈이 저장해도 시간은 그대로예요", () => {
    const saved = checkpointSession(startSession("r", 1000), 4000);
    expect(saved).toMatchObject({ workedMs: 3000, since: 4000 });
    expect(workedTime(saved, 5000)).toBe(4000);
  });

  it("작업 중인데 다시 시작해도 시간이 초기화되지 않아요", () => {
    const started = startSession("r", 1000);
    expect(resumeSession(started, 9000)).toBe(started);
  });

  it("앱을 다시 켜면 멈춤이고, 꺼져 있던 시간은 세지 않아요", () => {
    const restored = restoreSession(checkpointSession(startSession("r", 1000), 4000));
    expect(restored).toMatchObject({ status: "paused", workedMs: 3000, since: null });
    expect(workedTime(restored, 999999)).toBe(3000);
  });
});

describe("저장된 작업 읽기", () => {
  it("없거나 망가지면 꺼진 상태예요", () => {
    for (const value of [undefined, null, 3, {}, { roomId: "" }]) expect(normalizeSession(value)).toBeNull();
  });

  it("망가진 칸은 멈춤과 0으로 고쳐요", () => {
    expect(normalizeSession({ roomId: "r", status: "working", workedMs: "많이", since: "어제" })).toEqual({ roomId: "r", status: "paused", workedMs: 0, since: null });
    expect(normalizeSession({ roomId: "r", status: "working", workedMs: 5, since: 10 })).toEqual({ roomId: "r", status: "working", workedMs: 5, since: 10 });
  });
});

describe("플로팅 설정 읽기", () => {
  it("없거나 망가지면 기본값이에요", () => {
    for (const value of [undefined, null, 3, { askEvery: 7 }, { askEvery: "자주", hidden: "네" }]) expect(normalizePet(value)).toEqual(defaultPet);
  });

  it("고를 수 있는 주기와 숨김은 그대로 읽어요", () => {
    expect(normalizePet({ askEvery: 0, hidden: true })).toEqual({ askEvery: 0, hidden: true });
    expect(normalizePet({ askEvery: 5 })).toEqual({ askEvery: 5, hidden: false });
  });
});

describe("시간 글자", () => {
  it("한 시간 전에는 분:초, 넘으면 시:분:초예요", () => {
    expect(formatWorked(42_000)).toBe("00:42");
    expect(formatWorked(3_725_000)).toBe("1:02:05");
  });
});
