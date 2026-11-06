import { describe, expect, it } from "vitest";
import { WheelStepper, type WheelInput } from "../domain/wheelStep";

type Ev = [t: number, dy: number, dx?: number, mode?: number];
const ev = ([timeStamp, deltaY, deltaX = 0, deltaMode = 0]: Ev): WheelInput => ({ timeStamp, deltaX, deltaY, deltaMode });

// 0이 아닌 걸음만 모아요.
function steps(events: Ev[], stepper = new WheelStepper()) {
  return events.map((e) => stepper.push(ev(e))).filter((s) => s !== 0);
}

// 트랙패드 한 번 쓸기: 손가락이 미는 8프레임, 그다음 프레임마다 5%씩 잦아드는 관성.
function swipe(t0: number, sign: 1 | -1, inertiaMs: number, axis: "x" | "y" = "y"): Ev[] {
  const drag = [2, 5, 10, 18, 25, 22, 15, 10];
  const out: number[] = [...drag];
  for (let k = 0; k * 16 < inertiaMs; k++) out.push(10 * 0.95 ** k);
  return out.map((v, i) => (axis === "y" ? [t0 + i * 16, sign * v] : [t0 + i * 16, 0, sign * v]));
}

describe("휠 한 칸", () => {
  it("400ms 간격의 마우스 칸은 칸마다 한 칸씩 가요", () => {
    expect(steps([[0, 4], [400, 4], [800, 4]])).toEqual([1, 1, 1]);
  });

  it("80ms 간격으로 4칸 빨리 굴리면 두 칸 가요(200ms에 한 번까지)", () => {
    expect(steps([[0, 4], [80, 4], [160, 4], [240, 4]])).toEqual([1, 1]);
  });

  it("계속 굴리면 칸마다가 아니라 200ms 남짓마다 한 칸씩 가요", () => {
    const spin: Ev[] = Array.from({ length: 10 }, (_, i) => [i * 50, 4 + i * 4]);
    expect(steps(spin)).toEqual([1, 1, 1]);
  });

  it("화면 배율 때문에 한 칸이 2px로 와도 칸마다 가요", () => {
    expect(steps([[0, 2], [500, 2], [1000, -2]])).toEqual([1, 1, -1]);
    expect(steps([[0, 2], [80, 2], [160, 2], [240, 2]])).toEqual([1, 1]);
  });

  it("줄 단위(deltaMode 1) 값도 한 칸이에요", () => {
    expect(steps([[0, 3, 0, 1]])).toEqual([1]);
  });
});

describe("트랙패드", () => {
  it("한 번 쓸면 1.5초 관성이 이어져도 한 칸만 가요", () => {
    expect(steps(swipe(0, 1, 1500))).toEqual([1]);
  });

  it("관성이 이어지는 중에 다시 쓸면 한 칸 더 가요", () => {
    // 손가락이 닿으면 macOS가 관성을 멈추고, 새로 쓴 값이 작게 시작해 커져요.
    const first = swipe(0, 1, 600);
    const end = first[first.length - 1][0];
    expect(steps([...first, ...swipe(end + 16, 1, 1500)])).toEqual([1, 1]);
  });

  it("관성이 아직 셀 때 다시 쓸어도 한 칸 더 가요", () => {
    const first = swipe(0, 1, 120);
    const end = first[first.length - 1][0];
    expect(steps([...first, ...swipe(end + 16, 1, 1500)])).toEqual([1, 1]);
  });

  it("세로로 쓴 바로 뒤에 옆으로 쓸어도 가요", () => {
    const down = swipe(0, 1, 600);
    const end = down[down.length - 1][0];
    expect(steps([...down, ...swipe(end + 16, 1, 800, "x")])).toEqual([1, 1]);
    expect(steps([...down, ...swipe(end + 16, -1, 800, "x")])).toEqual([1, -1]);
  });

  it("옆으로만 쓸어도 한 칸이에요", () => {
    expect(steps(swipe(0, -1, 1000, "x"))).toEqual([-1]);
  });

  it("대각선으로 쓸어 축이 오가도 한 방향으로 한 칸만 가요", () => {
    // 오른쪽(+x)·위(-y)로 비스듬히: 두 축 크기가 엇갈려요. 처음 값이 옆으로 더 커서 옆 축을 따라요.
    const diag: Ev[] = [2, 5, 10, 18, 25, 22, 15, 10].map((v, i) => [i * 16, i % 2 ? -v : -v * 0.8, i % 2 ? v * 0.8 : v]);
    expect(steps(diag)).toEqual([1]);
  });

  it("휘어지게 쓸어 도중에 축이 바뀌어도 되돌아가지 않아요", () => {
    // 왼쪽으로 쓸다가 점점 아래로 휘어요(각도 0°→72°), 그 각도로 관성이 이어져요.
    const mags = [2, 5, 10, 18, 25, 22, 15, 10, ...Array.from({ length: 40 }, (_, k) => 10 * 0.95 ** k)];
    const curve: Ev[] = mags.map((m, i) => {
      const angle = (Math.min(i, 7) / 7) * 1.26;
      return [i * 16, m * Math.sin(angle), -m * Math.cos(angle)];
    });
    expect(steps(curve)).toEqual([-1]);
    // 옆으로 쓰는 중에 한 프레임만 세로로 튀어도 한 칸이에요.
    expect(steps([[0, 0, -2], [16, 0, -5], [32, 0, -10], [48, 0, -18], [64, 0, -25], [80, 3, 0], [96, 0, -15], [112, 0, -10]])).toEqual([-1]);
  });

  it("세로로 쓴 뒤에 비스듬히 옆으로 쓰면 옆 방향을 따라요", () => {
    const down = swipe(0, 1, 300);
    const end = down[down.length - 1][0];
    const tilted: Ev[] = [2, 5, 10, 18, 25, 22, 15, 10].map((m, i) => [end + 1000 + i * 16, 0.55 * m, -0.83 * m]);
    expect(steps([...down, ...tilted])).toEqual([1, -1]);
  });

  it("밀렸던 관성 값이 한꺼번에 들어와도 가지 않아요", () => {
    // 화면이 바빠 한 값이 60ms 늦게 오고, 밀린 값들이 2ms 간격으로 몰려 들어와요.
    const base = swipe(0, 1, 1500);
    const at = base.findIndex(([t]) => t >= 400);
    const late: Ev[] = base.slice(at, at + 6).map(([, v], i) => [base[at][0] + 60 + i * 2, v]);
    const rest = base.slice(at + 6).map(([t, v]): Ev => [t + 60, v]);
    expect(steps([...base.slice(0, at), ...late, ...rest])).toEqual([1]);
  });

  it("바쁜 틈에 몰려 온 관성 값으로는 가지 않아요", () => {
    // 100ms 동안 화면이 멈춰 관성 6프레임이 한 값으로 와요.
    const base = swipe(0, 1, 1500);
    const at = base.findIndex(([t]) => t >= 400);
    const lumped: Ev = [base[at + 5][0], base.slice(at, at + 6).reduce((s, [, v]) => s + v, 0)];
    expect(steps([...base.slice(0, at), lumped, ...base.slice(at + 6)])).toEqual([1]);
  });
});

describe("작은 값과 방향", () => {
  it("1px씩 오는 고해상도 값은 모여서 한 칸이 돼요", () => {
    const s = new WheelStepper();
    expect([0, 16, 32].map((t) => s.push(ev([t, 1])))).toEqual([0, 0, 1]);
    expect(steps(Array.from({ length: 60 }, (_, i): Ev => [48 + i * 16, 1]), s)).toEqual([]);
  });

  it("4px 여섯 번은 한 칸이에요(0도 6도 아니에요)", () => {
    expect(steps(Array.from({ length: 6 }, (_, i): Ev => [i * 16, 4]))).toEqual([1]);
  });

  it("살짝 건드리고 멈추면 가지 않아요", () => {
    expect(steps([[0, 1], [16, 1], [600, 1]])).toEqual([]);
  });

  it("반대로 굴리면 바로 돌아와요", () => {
    expect(steps([[0, 4], [100, -4]])).toEqual([1, -1]);
    expect(steps([[0, 4], [100, -4], [500, 4]])).toEqual([1, -1, 1]);
  });

  it("관성 끝에 섞인 작은 반대 값은 무시해요", () => {
    const base = swipe(0, 1, 1500);
    base.splice(40, 0, [base[40][0] - 8, -1]);
    expect(steps(base)).toEqual([1]);
  });
});

