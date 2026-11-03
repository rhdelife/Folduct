import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captionPose, captions, captionStepper } from "../components/home/HomeHeader";
import { armWheel, clampPos, createEngine, cubicOut, gateWheel, idleMs, legMs, liveScene, nearestStop, nextRest, range, rests, rowRest, sceneOpen, scenes, segmentMs, sheetLift, smooth, stops, tweenPos, tweenTarget, wheelSlopPx, type WheelStream } from "../components/home/engine";

describe("집 화면 엔진: 계산", () => {
  it("다음 쉼터는 방향으로 pos를 넘어선 첫 쉼터예요", () => {
    expect(nextRest(0, 1)).toBe(rowRest);
    expect(nextRest(1, 1)).toBe(rowRest);
    expect(nextRest(rowRest, 1)).toBe(1350);
    expect(nextRest(1350, 1)).toBe(2095);
    expect(nextRest(1349, 1)).toBe(1350);
    expect(nextRest(1350, -1)).toBe(rowRest);
    expect(nextRest(rowRest, -1)).toBe(0);
    expect(nextRest(2000, -1)).toBe(1350);
    expect(nextRest(2995, 1)).toBeNull();
    expect(nextRest(0, -1)).toBeNull();
    expect(nextRest(2000, 0)).toBeNull();
  });

  it("양 끝을 넘은 입력은 버려요", () => {
    expect(clampPos(-50)).toBe(0);
    expect(clampPos(9000)).toBe(2995);
    expect(clampPos(2000)).toBe(2000);
  });

  it("방향이 뒤집히면 같은 자리에서 반대쪽 자리로 가요", () => {
    expect(tweenTarget(2000, 1)).toEqual({ to: 2095, ms: segmentMs[2] });
    expect(tweenTarget(2000, -1)).toEqual({ to: 1350, ms: segmentMs[2] });
    expect(tweenTarget(2995, 1)).toBeNull();
    expect(tweenTarget(0, -1)).toBeNull();
  });

  it("시간은 거리가 아니라 구간이 정하고, 여러 구간을 건너뛰면 한 번에 가요", () => {
    expect(tweenTarget(2094, 1)!.ms).toBe(segmentMs[2]);
    expect(tweenTarget(1351, 1)!.ms).toBe(segmentMs[2]);
    expect(tweenTarget(100, 1)!.ms).toBe(segmentMs[0]);
    expect(tweenTarget(rowRest, 1)!.ms).toBe(segmentMs[1]);
    expect(segmentMs.length).toBe(rests.length - 1);
    expect(legMs(2995, 0)).toBe(1800);
    expect(legMs(0, 2995)).toBe(1800);
    expect(legMs(0, 1350)).toBe(1800);
  });

  it("움직임은 cubic-out이고 끝에서 정확히 멈춰요", () => {
    expect(tweenPos(0, 1000, 0, 1000)).toBe(0);
    expect(tweenPos(0, 1000, 500, 1000)).toBeCloseTo(875);
    expect(tweenPos(0, 1000, 2000, 1000)).toBe(1000);
    expect(tweenPos(1000, 0, 500, 1000)).toBeCloseTo(125);
    expect(tweenPos(0, 1000, -5, 1000)).toBe(0);
    expect(cubicOut(1)).toBe(1);
    expect(smooth(0.5)).toBe(0.5);
    expect(range(5, 0, 10)).toBe(0.5);
    expect(range(-5, 0, 10)).toBe(0);
    expect(nearestStop(1400)).toBe(1);
    expect(nearestStop(2800)).toBe(3);
    expect(nearestStop(rowRest)).toBe(0);
  });

  it("장면은 자리마다 하나만 살아 있고, 살아 있는 동안 늘 보여요", () => {
    stops.forEach((stop, index) => expect(liveScene(stop), `stop ${index}`).toBe(index));
    // 줄 쉼터는 첫 화면 안에 있어요. 공책은 아직 그리지 않습니다.
    expect(liveScene(rowRest)).toBe(0);
    expect(rowRest).toBeLessThan(scenes[1].show[0]);
    expect(rests.filter((rest) => rest !== rowRest)).toEqual(stops);
    scenes.forEach((scene, index) => {
      expect(scene.live[0], scene.name).toBe(index === 0 ? 0 : scenes[index - 1].live[1]);
      expect(scene.show[0], scene.name).toBeLessThanOrEqual(scene.live[0]);
    });
    expect(scenes[scenes.length - 1].live[1]).toBe(2995);
    for (let pos = 0; pos <= 2995; pos += 10) {
      const { show } = scenes[liveScene(pos)];
      expect(pos >= show[0] && pos <= show[1], `pos ${pos}`).toBe(true);
    }
  });

  it("쪽 이동 칸과 머리글은 맨 아래만 빼고 같은 이름이에요", () => {
    expect(captions.map((caption) => caption.title)).toEqual(["내 방", "손댈 것", "형식별"]);
    expect(scenes.filter((scene) => scene.name !== "footer").map((scene) => scene.label)).toEqual(captions.map((caption) => caption.title));
  });

  it("판은 마지막 구간에서만 들려요", () => {
    expect(sheetLift(2095) === 0).toBe(true);
    expect(sheetLift(2545)).toBeCloseTo(-58);
    expect(sheetLift(2995)).toBeCloseTo(-116);
  });
});

describe("머리글", () => {
  const caption = { stop: 3350, in: 2350, out: 3575, backIn: 3725, backOut: 2750 };

  it("앞으로 갈 때는 자기 자리에서 다 나타나고, 다음 구간 첫머리에 위로 빠져요", () => {
    expect(captionPose(caption, 2350, 1)).toEqual({ opacity: 0, rise: 0 });
    expect(captionPose(caption, 2850, 1).opacity).toBeCloseTo(0.5);
    expect(captionPose(caption, 3350, 1)).toEqual({ opacity: 1, rise: 0 });
    expect(captionPose(caption, 3575, 1)).toEqual({ opacity: 1, rise: 1 });
  });

  it("뒤로 갈 때는 제자리에서 옅어지고, 멈춘 자리에서는 방향과 상관없이 또렷해요", () => {
    expect(captionPose(caption, 3725, -1)).toEqual({ opacity: 0, rise: 0 });
    expect(captionPose(caption, 3350, -1)).toEqual({ opacity: 1, rise: 0 });
    expect(captionPose(caption, 2750, -1)).toEqual({ opacity: 0, rise: 0 });
    expect(captionPose(caption, 3350, 0)).toEqual({ opacity: 1, rise: 0 });
  });

  it("끝쪽 머리글은 빠져나가지 않아요", () => {
    expect(captionPose({ stop: 5600, in: 5250, out: null, backIn: null, backOut: 5390 }, 6500, 1)).toEqual({ opacity: 1, rise: 0 });
    expect(captionPose({ stop: 5600, in: 5250, out: null, backIn: null, backOut: 5390 }, 6500, -1)).toEqual({ opacity: 1, rise: 0 });
    expect(captionPose({ stop: 1350, in: 1300, out: 1950, backIn: 2350, backOut: null }, 500, -1)).toEqual({ opacity: 1, rise: 0 });
    // 되감아 첫 화면에 돌아오면 첫 줄만 남습니다.
    expect(captions.map((caption) => captionPose(caption, 0, -1).opacity)).toEqual([1, 0, 0]);
  });

  it("줄 쉼터에서는 앞으로 와도 뒤로 와도 내 방 머리글만 또렷해요", () => {
    for (const dir of [1, -1]) expect(captions.map((caption) => captionPose(caption, rowRest, dir))).toEqual([{ opacity: 1, rise: 0 }, { opacity: 0, rise: 0 }, { opacity: 0, rise: 0 }]);
    expect(captionPose(captions[0], 1350, 1).rise).toBe(1);
    expect(captionPose(captions[0], 1350, -1).opacity).toBe(0);
  });
});

describe("머리글: 방향을 뒤집어도 튀지 않아요", () => {
  // 화면 위로 나간 줄은 눈에 보이지 않습니다.
  const apparent = ({ opacity, rise }: { opacity: number; rise: number }) => (rise >= 0.15 ? 0 : opacity * (1 - rise / 0.15));
  const list = [{ stop: 3350, in: 2350, out: 3575, backIn: 3725, backOut: 2750 }];
  const worstJump = (trace: [number, number][]) => {
    const step = captionStepper(list);
    let now = 0;
    let last: number | null = null;
    let worst = 0;
    for (const [pos, dir] of trace) {
      now += 16;
      const seen = apparent(step(pos, dir, now).poses[0]);
      if (last !== null) worst = Math.max(worst, Math.abs(seen - last));
      last = seen;
    }
    return worst;
  };

  it("다 올라간 뒤 뒤집으면 제자리에서 옅게 나타나요. 큰 휠 한 번이어도요", () => {
    const hold = (pos: number, count: number) => Array.from({ length: count }, (): [number, number] => [pos, -1]);
    expect(worstJump([[3489, 1], ...hold(3389, 20)])).toBeLessThan(0.1);
    const step = captionStepper(list);
    step(3489, 1, 0);
    expect(step(3489, -1, 16).poses[0].opacity).toBe(0);
    expect(step(3389, -1, 400).poses[0]).toEqual(captionPose(list[0], 3389, -1));
  });

  it("거꾸로 가다 앞으로 뒤집어도 이어져요", () => {
    const step = captionStepper(list);
    step(3400, -1, 0);
    const first = step(3400, 1, 16);
    expect(first.blending).toBe(true);
    expect(apparent(first.poses[0])).toBeGreaterThan(0.6);
    const done = step(3420, 1, 500);
    expect(done.blending).toBe(false);
    expect(done.poses[0]).toEqual(captionPose(list[0], 3420, 1));
  });

  it("잇는 동안 다시 뒤집으면 지금 보이는 모습에서 이어요", () => {
    expect(worstJump([[3489, 1], [3489, -1], [3489, -1], [3489, 1], [3489, 1], [3489, -1], [3489, -1]])).toBeLessThan(0.1);
  });

  it("동작 줄이기에서는 잇지 않고 바로 바뀌어요", () => {
    const step = captionStepper(list);
    step(3489, 1, 0, 0);
    const { poses, blending } = step(3389, -1, 16, 0);
    expect(blending).toBe(false);
    expect(poses[0]).toEqual(captionPose(list[0], 3389, -1));
  });

  it("방향이 그대로면 멈춘 자리의 모습 그대로예요", () => {
    const step = captionStepper(list);
    expect(step(3350, 1, 0).poses[0]).toEqual({ opacity: 1, rise: 0 });
    expect(step(3350, -1, 16).poses[0]).toEqual({ opacity: 1, rise: 0 });
  });
});

describe("휠 관문: 한 번 튕기면 한 장면", () => {
  // list의 입력을 gap ms 간격으로 흘려 pos가 어디까지 가는지 봅니다. 자동 진행은 없다고 봐요.
  const run = (from: number, list: number[], gap = 16, start = 0) => {
    let stream: WheelStream | null = null;
    let pos = from;
    let now = start;
    for (const delta of list) {
      const gated: { stream: WheelStream; delta: number } = gateWheel(stream, pos, delta, now);
      stream = gated.stream;
      pos += gated.delta;
      now += gap;
    }
    return pos;
  };
  const flick = (peak: number, keep: number) => {
    const out: number[] = [];
    for (let delta = peak; delta >= 1; delta *= keep) out.push(Math.round(delta));
    return out;
  };

  it("첫 화면에서는 어떤 흐름도 줄 쉼터를 지나가지 못해요", () => {
    for (const keep of [0.94, 0.96, 0.98]) expect(run(0, flick(220, keep)), `keep ${keep}`).toBe(rowRest);
    expect(run(0, [5000])).toBe(rowRest);
    expect(run(0, Array(200).fill(60), 40)).toBe(rowRest);
    expect(run(stops[1], flick(220, 0.96).map((delta) => -delta))).toBe(rowRest);
    expect(run(stops[1], Array(200).fill(-60), 40)).toBe(rowRest);
  });

  it("줄 쉼터에서 새로 밀면 공책까지 가요", () => {
    expect(run(rowRest, flick(220, 0.96))).toBe(stops[1]);
    expect(run(rowRest, flick(220, 0.96).map((delta) => -delta))).toBe(0);
  });

  it("줄 쉼터는 정말 닿았을 때만 넘겨요. 천천히 굴리는 휠이 그 앞에서 지나치지 않아요", () => {
    expect(gateWheel(null, rowRest - 50, 2, 0).stream.wall).toBe(rowRest);
    expect(gateWheel(null, rowRest + 50, -2, 0).stream.wall).toBe(rowRest);
    expect(gateWheel(null, rowRest - 4, 2, 0).stream.wall).toBe(stops[1]);
    expect(gateWheel(null, rowRest + 4, -2, 0).stream.wall).toBe(0);
  });

  it("긴 관성 꼬리는 다음 자리에서 멈추고 나머지는 버려요", () => {
    for (const keep of [0.94, 0.96, 0.97, 0.98]) {
      expect(run(stops[1], flick(220, keep)), `keep ${keep}`).toBe(stops[2]);
      expect(run(stops[2], flick(220, keep)), `keep ${keep}`).toBe(stops[3]);
    }
    expect(run(stops[3], flick(220, 0.96).map((delta) => -delta))).toBe(stops[2]);
  });

  it("손가락으로 밀다가 놓는 흐름도 한 장면이에요", () => {
    const rise = [8, 20, 40, 70, 110, 150, 180];
    expect(run(stops[2], [...rise, ...flick(180, 0.96)])).toBe(stops[3]);
  });

  it("다음 자리에 못 미치면 그만큼만 가요. 나머지는 자동 진행 몫이에요", () => {
    const sum = flick(60, 0.9).reduce((total, delta) => total + delta, 0);
    expect(run(0, flick(60, 0.9))).toBe(sum);
  });

  it("아무리 큰 휠 한 번도 다음 자리까지만 가요", () => {
    expect(run(stops[2], [5000])).toBe(stops[3]);
    expect(run(stops[2], [-5000])).toBe(stops[1]);
    expect(run(stops[3], [5000])).toBe(stops[3]);
  });

  it("꼬리 위에 다시 튕기면 한 장면 더 가요", () => {
    expect(run(stops[1], [...flick(220, 0.95), ...flick(220, 0.95)])).toBe(stops[3]);
  });

  it("줄지 않고 오래 굴리면 자리를 지나가요", () => {
    expect(run(stops[1], Array(60).fill(60), 40)).toBeGreaterThan(stops[2]);
    expect(run(stops[1], Array(10).fill(60), 40)).toBeLessThanOrEqual(stops[2]);
  });

  it("드문드문 오는 꼬리도 같은 흐름이고, 쉬었다 치는 휠은 새 흐름이에요", () => {
    let stream: WheelStream | null = null;
    let pos: number = stops[1];
    let now = 0;
    for (const delta of flick(220, 0.96)) {
      const gated: { stream: WheelStream; delta: number } = gateWheel(stream, pos, delta, now);
      stream = gated.stream;
      pos += gated.delta;
      now += 16;
    }
    expect(pos).toBe(stops[2]);
    const late = gateWheel(stream, pos, 1, now + 200);
    expect(late.delta).toBe(0);
    const again = gateWheel(late.stream, pos, 2, now + 800);
    expect(again.delta).toBe(2);
    expect(again.stream.wall).toBe(stops[3]);
  });

  it("끝자락에서 새로 밀면 멈춘 것으로 보고 그다음 자리로 가요", () => {
    expect(gateWheel(null, stops[2] - 10, 2, 0).stream.wall).toBe(stops[3]);
    expect(gateWheel(null, stops[2] - 200, 2, 0).stream.wall).toBe(stops[2]);
    expect(gateWheel(null, stops[2] + 10, -2, 0).stream.wall).toBe(stops[1]);
    expect(gateWheel(null, stops[3] - 10, 2, 0).stream.wall).toBe(stops[3]);
    expect(gateWheel(null, 10, -2, 0).stream.wall).toBe(0);
  });

  it("방향이 바뀌면 그쪽의 다음 자리가 벽이에요", () => {
    const forward = gateWheel(null, 2000, 50, 0);
    expect(forward.stream.wall).toBe(stops[2]);
    const back = gateWheel(forward.stream, 2050, -50, 16);
    expect(back.stream.wall).toBe(stops[1]);
    expect(back.delta).toBe(-50);
  });

  it("벽을 이미 넘어 있으면 거꾸로 끌지 않아요", () => {
    const stale: WheelStream = { at: 0, start: 0, dir: 1, rate: 1, peak: 1, low: Infinity, wall: 1350 };
    expect(gateWheel(stale, 2095, 40, 16).delta).toBe(0);
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

  it("아주 작은 입력도 줄 쉼터까지 가서 멈추고, 공책으로 넘어가지 않아요", () => {
    const engine = createEngine();
    engine.input(1);
    vi.advanceTimersByTime(100);
    expect(engine.pos).toBe(1);
    vi.advanceTimersByTime(idleMs + segmentMs[0] + 50);
    expect(engine.pos).toBe(rowRest);
    expect(engine.moving).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(engine.pos).toBe(rowRest);
  });

  it("줄 쉼터에서 첫 화면은 그대로 살아 있고, 뒤로 밀면 맨 위로 돌아가요", () => {
    const engine = createEngine();
    engine.wheel(5000, 0);
    expect(engine.pos).toBe(rowRest);
    expect(engine.target).toBe(rowRest);
    vi.advanceTimersByTime(idleMs + 50);
    expect(sceneOpen(engine, 0)).toBe(true);
    expect(sceneOpen(engine, 1)).toBe(false);
    engine.wheel(-wheelSlopPx, 9000);
    vi.advanceTimersByTime(idleMs + segmentMs[0] + 50);
    expect(engine.pos).toBe(0);
  });

  it("줄 쉼터로 가다 뒤집으면 맨 위로, 공책으로 가다 뒤집으면 줄 쉼터로 돌아가요", () => {
    const engine = createEngine();
    engine.input(300);
    vi.advanceTimersByTime(20);
    engine.input(-10);
    vi.advanceTimersByTime(idleMs + segmentMs[0] + 50);
    expect(engine.pos).toBe(0);
    const away = createEngine(1);
    away.input(-300);
    vi.advanceTimersByTime(idleMs + segmentMs[1] + 50);
    expect(away.pos).toBe(rowRest);
  });

  it("쪽 이동은 줄 쉼터에서 멈추지 않아요. 내 방을 누르면 맨 위로 가요", () => {
    const engine = createEngine();
    engine.goTo(1);
    expect(engine.target).toBe(stops[1]);
    vi.advanceTimersByTime(2000);
    expect(engine.pos).toBe(stops[1]);
    expect(sceneOpen(engine, 1)).toBe(true);
    engine.goTo(0);
    vi.advanceTimersByTime(2000);
    expect(engine.pos).toBe(0);
    engine.step(1);
    vi.advanceTimersByTime(segmentMs[0] + 50);
    expect(engine.pos).toBe(rowRest);
    engine.goTo(0);
    vi.advanceTimersByTime(segmentMs[0] + 50);
    expect(engine.pos).toBe(0);
    engine.step(1);
    vi.advanceTimersByTime(segmentMs[0] + 50);
    engine.goTo(1);
    vi.advanceTimersByTime(segmentMs[1] + 50);
    expect(engine.pos).toBe(stops[1]);
  });

  it("가는 도중에 뒤집으면 지난 자리로 돌아가요", () => {
    const engine = createEngine(1);
    engine.input(100);
    vi.advanceTimersByTime(500);
    expect(engine.pos).toBeGreaterThan(1450);
    engine.input(-100);
    vi.advanceTimersByTime(idleMs + segmentMs[2] + 50);
    expect(engine.pos).toBe(1350);
    expect(engine.dir).toBe(-1);
  });

  it("끝을 넘는 입력은 쌓이지 않아요", () => {
    const engine = createEngine(3);
    engine.input(500);
    vi.advanceTimersByTime(idleMs + 50);
    expect(engine.pos).toBe(2995);
    engine.input(-1);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(2994);
  });

  it("step은 가던 자리에서 한 칸 더 가고, goTo는 같은 자리면 다시 시작하지 않아요", () => {
    const engine = createEngine();
    engine.step(1);
    engine.step(1);
    expect(engine.target).toBe(1350);
    engine.step(1);
    vi.advanceTimersByTime(4000);
    expect(engine.pos).toBe(2095);
    engine.goTo(2);
    vi.advanceTimersByTime(40);
    expect(engine.pos).toBe(2095);
  });

  it("같은 값으로는 구독자를 부르지 않고, 끝나면 프레임을 멈춰요", () => {
    const engine = createEngine();
    const seen = vi.fn();
    engine.subscribe(seen);
    vi.advanceTimersByTime(100);
    expect(seen).not.toHaveBeenCalled();
    engine.goTo(4);
    vi.advanceTimersByTime(2000);
    const calls = seen.mock.calls.length;
    expect(calls).toBeGreaterThan(10);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("동작 줄이기에서는 건너뛰고, 입력이 이어져도 한 번만 넘어가요", () => {
    reduce = true;
    const engine = createEngine();
    engine.input(100);
    engine.input(100);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(rowRest);
    engine.input(100);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(rowRest);
    vi.advanceTimersByTime(idleMs + 10);
    engine.input(100);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(1350);
    vi.advanceTimersByTime(idleMs + 10);
    engine.goTo(0);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(0);
    engine.input(100);
    vi.advanceTimersByTime(idleMs + 40);
    engine.input(-100);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(0);
    engine.goTo(6);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(2995);
  });

  it("손가락이 닿아 있으면 자동 진행을 미루고, 떼면 흘러가요", () => {
    const engine = createEngine();
    engine.hold(true);
    engine.input(120);
    vi.advanceTimersByTime(1500);
    expect(engine.pos).toBe(120);
    expect(engine.moving).toBe(true);
    engine.hold(false);
    vi.advanceTimersByTime(100);
    expect(engine.pos).toBe(120);
    vi.advanceTimersByTime(idleMs + segmentMs[0] + 50);
    expect(engine.pos).toBe(rowRest);
    expect(engine.moving).toBe(false);
  });

  it("움직이지 않은 손가락을 떼도 아무 일 없어요", () => {
    const engine = createEngine(1);
    engine.hold(true);
    engine.hold(false);
    vi.advanceTimersByTime(1000);
    expect(engine.pos).toBe(1350);
    expect(engine.moving).toBe(false);
  });

  it("흘러가는 동안에는 떠나는 장면도 지나치는 장면도 잠그고, 닿을 장면만 열어요", () => {
    const engine = createEngine(3);
    const open = () => scenes.map((_, index) => index).filter((index) => sceneOpen(engine, index));
    expect(open()).toEqual([3]);
    engine.goTo(0);
    expect(open()).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(engine.pos).toBeGreaterThan(scenes[0].live[1]);
    expect(open()).toEqual([]);
    vi.advanceTimersByTime(3000);
    expect(open()).toEqual([0]);
    engine.goTo(1);
    vi.advanceTimersByTime(segmentMs[0] - 100);
    expect(engine.moving).toBe(true);
    expect(open()).toEqual([1]);
  });

  it("움직이는 중인지와 향하는 자리를 알려 줘요", () => {
    const engine = createEngine(2);
    expect(engine.moving).toBe(false);
    expect(engine.target).toBe(2095);
    engine.goTo(0);
    expect(engine.moving).toBe(true);
    expect(engine.target).toBe(0);
    engine.step(1);
    expect(engine.target).toBe(rowRest);
    vi.advanceTimersByTime(4000);
    expect(engine.moving).toBe(false);
    expect(engine.target).toBe(rowRest);
    engine.input(-10);
    expect(engine.moving).toBe(true);
    expect(engine.target).toBe(0);
  });

  it("살짝 건드린 휠은 첫 화면을 넘기지 않아요", () => {
    const engine = createEngine();
    engine.wheel(1, 0);
    engine.wheel(5, 16);
    engine.wheel(wheelSlopPx - 7, 32);
    vi.advanceTimersByTime(idleMs + segmentMs[0] + 50);
    expect(engine.pos).toBe(0);
    expect(engine.moving).toBe(false);
  });

  it("살짝 건드린 휠은 다른 장면도 움직이거나 다음 자리로 흘려보내지 않아요", () => {
    const engine = createEngine(2);
    engine.wheel(10, 0);
    vi.advanceTimersByTime(idleMs + segmentMs[2] + 50);
    expect(engine.pos).toBe(stops[2]);
    engine.wheel(-10, 5000);
    vi.advanceTimersByTime(idleMs + segmentMs[1] + 50);
    expect(engine.pos).toBe(stops[2]);
  });

  it("작은 값도 한 방향으로 모이면 넘어가고, 그다음 값은 흐름 그대로 받아요", () => {
    const engine = createEngine(2);
    for (let at = 0; at < 12 * 16; at += 16) engine.wheel(5, at);
    expect(engine.pos).toBe(stops[2] + 5);
    engine.wheel(1, 12 * 16);
    expect(engine.pos).toBe(stops[2] + 6);
    vi.advanceTimersByTime(idleMs + segmentMs[3] + 50);
    expect(engine.pos).toBe(stops[3]);
  });

  it("가던 길에 반대로 살짝 건드려도 되돌아가지 않아요", () => {
    const engine = createEngine();
    engine.goTo(1);
    vi.advanceTimersByTime(1000);
    engine.wheel(-3, 1000);
    expect(engine.target).toBe(stops[1]);
    vi.advanceTimersByTime(segmentMs[0]);
    expect(engine.pos).toBe(stops[1]);
  });

  it("벽에 닿아 자리에 멈추면 다음 장면으로 넘어가지 않아요", () => {
    const engine = createEngine(1);
    engine.wheel(5000, 0);
    vi.advanceTimersByTime(idleMs + 4000);
    expect(engine.pos).toBe(2095);
    engine.wheel(wheelSlopPx, 5000);
    vi.advanceTimersByTime(idleMs + 2000);
    expect(engine.pos).toBe(2995);
  });

  it("첫 화면의 휠은 pos를 그대로 따라가 줄 쉼터에서 멈추고, 새로 밀면 공책에서 멈춰요", () => {
    const engine = createEngine();
    engine.wheel(100, 0);
    expect(engine.pos).toBe(100);
    engine.wheel(5000, 16);
    expect(engine.pos).toBe(rowRest);
    vi.advanceTimersByTime(idleMs + segmentMs[0] + 50);
    expect(engine.pos).toBe(rowRest);
    engine.wheel(wheelSlopPx, 9000);
    vi.advanceTimersByTime(idleMs + segmentMs[1] + 50);
    expect(engine.pos).toBe(1350);
    engine.wheel(wheelSlopPx, 20000);
    vi.advanceTimersByTime(idleMs + segmentMs[2] + 50);
    expect(engine.pos).toBe(2095);
  });

  it("끝자락에서 새로 미는 휠은 기다리지 않고 다음 장면으로 가요", () => {
    const engine = createEngine(1);
    engine.goTo(2);
    vi.advanceTimersByTime(segmentMs[2] - 300);
    expect(engine.pos).toBeLessThan(2095);
    engine.wheel(wheelSlopPx, 100000);
    vi.advanceTimersByTime(idleMs + segmentMs[3] + 50);
    expect(engine.pos).toBe(2995);
  });

  it("뒤로 가는 휠은 공책으로 가는 박자를 바로 멈춰요", () => {
    const engine = createEngine();
    engine.wheel(100, 0);
    vi.advanceTimersByTime(1000);
    engine.wheel(-100, 1000);
    vi.advanceTimersByTime(idleMs + segmentMs[0] + 50);
    expect(engine.pos).toBe(0);
  });

  it("동작 줄이기에서도 휠은 줄 쉼터에 멈췄다가 다음 흐름에 공책으로 가요", () => {
    reduce = true;
    const engine = createEngine();
    for (let delta = 200, at = 0; delta >= 1; delta *= 0.96, at += 16) {
      engine.wheel(Math.round(delta), at);
      vi.advanceTimersByTime(16);
    }
    expect(engine.pos).toBe(rowRest);
    vi.advanceTimersByTime(idleMs + 10);
    expect(engine.pos).toBe(rowRest);
    engine.wheel(wheelSlopPx, 50000);
    expect(engine.pos).toBe(1350);
  });

  it("동작 줄이기에서 긴 꼬리는 한 장면만 넘어가요", () => {
    reduce = true;
    const engine = createEngine(1);
    for (let delta = 200, at = 0; delta >= 1; delta *= 0.96, at += 16) {
      engine.wheel(Math.round(delta), at);
      vi.advanceTimersByTime(16);
    }
    expect(engine.pos).toBe(2095);
  });

  it("가던 자리에 바로 닿고 구독자는 그 자리에서 알아요", () => {
    const engine = createEngine(1);
    const seen: number[] = [];
    engine.subscribe(() => seen.push(engine.pos));
    engine.goTo(0);
    vi.advanceTimersByTime(100);
    engine.arrive();
    expect(seen.at(-1)).toBe(0);
    expect(engine.moving).toBe(false);
    const calls = seen.length;
    vi.advanceTimersByTime(100);
    expect(seen.length).toBe(calls);
  });

  it("방이 없으면 움직이지 않고, 어디 있었든 첫 화면으로 와요", () => {
    const engine = createEngine(4);
    engine.lock(true);
    vi.advanceTimersByTime(30);
    expect(engine.pos).toBe(0);
    engine.input(100);
    engine.wheel(100);
    engine.step(1);
    engine.goTo(3);
    vi.advanceTimersByTime(500);
    expect(engine.pos).toBe(0);
    expect(engine.moving).toBe(false);
    engine.lock(false);
    engine.goTo(1);
    vi.advanceTimersByTime(6000);
    expect(engine.pos).toBe(1350);
  });
});
