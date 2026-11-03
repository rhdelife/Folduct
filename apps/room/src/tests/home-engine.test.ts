import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armWheel, clampPos, createEngine, cubicOut, idleMs, nextRest, range, rowRest, travelMs, tweenPos, wheelSlopPx } from "../components/home/engine";

describe("집 화면 엔진: 계산", () => {
  it("다음 쉼터는 방향으로 pos를 넘어선 첫 쉼터예요", () => {
    expect(nextRest(0, 1)).toBe(rowRest);
    expect(nextRest(1, 1)).toBe(rowRest);
    expect(nextRest(rowRest, -1)).toBe(0);
    expect(nextRest(1, -1)).toBe(0);
    expect(nextRest(rowRest, 1)).toBeNull();
    expect(nextRest(0, -1)).toBeNull();
    expect(nextRest(100, 0)).toBeNull();
  });

  it("양 끝을 넘은 입력은 버려요", () => {
    expect(clampPos(-50)).toBe(0);
    expect(clampPos(9000)).toBe(rowRest);
    expect(clampPos(100)).toBe(100);
  });

  it("움직임은 cubic-out이고 끝에서 정확히 멈춰요", () => {
    expect(tweenPos(0, 1000, 0, 1000)).toBe(0);
    expect(tweenPos(0, 1000, 500, 1000)).toBeCloseTo(875);
    expect(tweenPos(0, 1000, 2000, 1000)).toBe(1000);
    expect(tweenPos(1000, 0, 500, 1000)).toBeCloseTo(125);
    expect(tweenPos(0, 1000, -5, 1000)).toBe(0);
    expect(cubicOut(1)).toBe(1);
    expect(range(5, 0, 10)).toBe(0.5);
    expect(range(-5, 0, 10)).toBe(0);
  });
});

describe("휠 문턱", () => {
  it("한 방향으로 이어질 때만 모으고, 멈추거나 방향이 바뀌면 다시 셉니다", () => {
    const first = armWheel(null, 20, 0);
    expect(first.sum).toBe(20);
    expect(armWheel(first, 30, 100).sum).toBe(50);
    expect(armWheel(first, 30, 300).sum).toBe(30);
    expect(armWheel(first, -30, 100).sum).toBe(30);
  });
});

describe("집 화면 엔진: 움직임", () => {
  let reduce = false;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    reduce = false;
    vi.stubGlobal("matchMedia", () => ({ matches: reduce }));
    vi.stubGlobal("requestAnimationFrame", (run: (now: number) => void) => setTimeout(() => run(performance.now()), 16) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("아주 작은 입력도 줄 쉼터까지 가서 멈춰요", () => {
    const engine = createEngine();
    engine.input(1);
    vi.advanceTimersByTime(100);
    expect(engine.pos).toBe(1);
    vi.advanceTimersByTime(idleMs + travelMs + 50);
    expect(engine.pos).toBe(rowRest);
    vi.advanceTimersByTime(5000);
    expect(engine.pos).toBe(rowRest);
  });

  it("어떤 휠도 줄 쉼터를 지나가지 못하고, 뒤로 밀면 맨 위로 돌아가요", () => {
    const engine = createEngine();
    engine.wheel(5000, 0);
    expect(engine.pos).toBe(rowRest);
    expect(engine.target).toBe(rowRest);
    vi.advanceTimersByTime(idleMs + 50);
    engine.wheel(5000, 100);
    expect(engine.pos).toBe(rowRest);
    engine.wheel(-wheelSlopPx, 9000);
    vi.advanceTimersByTime(idleMs + travelMs + 50);
    expect(engine.pos).toBe(0);
  });

  it("가다가 뒤집으면 지난 자리로 돌아가요", () => {
    const engine = createEngine();
    engine.input(300);
    vi.advanceTimersByTime(20);
    engine.input(-10);
    expect(engine.target).toBe(0);
    vi.advanceTimersByTime(idleMs + travelMs + 50);
    expect(engine.pos).toBe(0);
  });

  it("살짝 건드린 휠은 움직이지 않아요", () => {
    const engine = createEngine();
    engine.wheel(1, 0);
    engine.wheel(5, 16);
    engine.wheel(wheelSlopPx - 7, 32);
    vi.advanceTimersByTime(idleMs + travelMs + 50);
    expect(engine.pos).toBe(0);
  });

  it("step과 goTo는 쉼터로 가고, 같은 자리면 다시 시작하지 않아요", () => {
    const engine = createEngine();
    engine.step(1);
    expect(engine.target).toBe(rowRest);
    engine.step(1);
    vi.advanceTimersByTime(travelMs + 50);
    expect(engine.pos).toBe(rowRest);
    const seen = vi.fn();
    engine.subscribe(seen);
    engine.goTo(rowRest);
    vi.advanceTimersByTime(100);
    expect(seen).not.toHaveBeenCalled();
    engine.goTo(0);
    vi.advanceTimersByTime(travelMs + 50);
    expect(engine.pos).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("동작 줄이기에서는 건너뛰고, 입력이 이어져도 한 번만 넘어가요", () => {
    reduce = true;
    const engine = createEngine();
    engine.input(100);
    engine.input(100);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(rowRest);
    engine.input(-100);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(rowRest);
    vi.advanceTimersByTime(idleMs + 10);
    engine.input(-100);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(0);
  });

  it("손가락이 닿아 있으면 자동 진행을 미루고, 떼면 흘러가요", () => {
    const engine = createEngine();
    engine.hold(true);
    engine.input(120);
    vi.advanceTimersByTime(1500);
    expect(engine.pos).toBe(120);
    engine.hold(false);
    vi.advanceTimersByTime(idleMs + travelMs + 50);
    expect(engine.pos).toBe(rowRest);
  });

  it("방이 없으면 움직이지 않고, 어디 있었든 맨 위로 와요", () => {
    const engine = createEngine();
    engine.wheel(5000, 0);
    engine.lock(true);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(0);
    engine.input(100);
    engine.step(1);
    engine.goTo(rowRest);
    vi.advanceTimersByTime(500);
    expect(engine.pos).toBe(0);
    engine.lock(false);
    engine.goTo(rowRest);
    vi.advanceTimersByTime(travelMs + 50);
    expect(engine.pos).toBe(rowRest);
  });
});
