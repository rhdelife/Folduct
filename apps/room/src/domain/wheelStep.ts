// 휠 한 칸(트랙패드는 한 번 쓸기)을 프로도 한 칸으로 바꿉니다. DOM 없이 값과 시각만 봐요.
// 새 손짓으로 보는 때: 잠깐 조용했다가 다시 올 때, 방향이 바뀔 때, 관성이 잦아들다 다시 세질 때(새로 쓸기),
// 띄엄띄엄 오는 마우스 칸이 이어질 때. 한 칸 간 뒤 coolMs 동안은 같은 흐름에서 또 가지 않아요.
export type WheelInput = { deltaX: number; deltaY: number; deltaMode: number; timeStamp: number };

// macOS 마우스 한 칸은 4px 남짓(NSEvent 0.1줄 × 40px)이라 그보다 조금 작게. 이보다 작은 값은 모여야 한 칸이에요.
export const notchPx = 3;
// 쉬었다가 오거나 마우스 칸 간격으로 띄엄띄엄 온 값은 하나만으로도 한 칸이에요. 화면 배율에 따라 한 칸이 2px로 줄어도 가요.
// 1px 한두 번(살짝 건드림)은 넘지 않아요.
export const notchMinPx = 1.5;
// 이만큼 조용하면 다음 값은 새 손짓이에요.
export const restMs = 250;
// 한 칸 간 뒤 이만큼은 같은 흐름에서 다시 가지 않아요. 마우스를 계속 굴리면 이 간격마다 한 칸씩 가요.
export const coolMs = 200;
// 트랙패드와 관성은 프레임마다(8~17ms) 오고, 마우스 칸은 이보다 띄엄띄엄 와요.
export const notchGapMs = 40;
// 잦아든 바닥보다 이만큼 세지면 새로 쓸었다고 봐요. 손가락이 흔들리는 정도로는 넘지 않게 배수와 차이를 함께 봐요.
export const riseX = 3;
export const risePx = 4;

export class WheelStepper {
  private at = -Infinity;
  private axis: "x" | "y" = "y";
  private dir = 0;
  private sum = 0;
  private armed = false;
  private stepAt = -Infinity;
  private low = Infinity;
  private lowSize = Infinity;
  private prev = 0;

  push(event: WheelInput): -1 | 0 | 1 {
    const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
    const x = event.deltaX * scale;
    const y = event.deltaY * scale;
    const t = event.timeStamp;
    const dt = t - this.at;
    this.at = t;
    // 새 손짓은 더 큰 축을 따라요. 한 손짓 안에서는 대각선으로 쓸 때 축이 오가지 않게, 다른 축이 확실히 클 때만 바꿔요.
    const was = this.axis;
    if (dt > restMs) {
      if (x !== 0 || y !== 0) this.axis = Math.abs(x) > Math.abs(y) ? "x" : "y";
    } else if (Math.abs(was === "x" ? y : x) > 2 * Math.abs(was === "x" ? x : y)) this.axis = was === "x" ? "y" : "x";
    const d = this.axis === "x" ? x : y;
    if (d === 0) return 0;
    // 한 프레임(16ms)에 간 거리. 바쁜 틈에 몰려 온 값도 같은 속도로 봐요.
    const r = (Math.abs(d) * 16) / Math.max(dt, 16);
    const prev = this.prev;
    this.prev = r;
    const dir = Math.sign(d);
    let fresh = false;
    // 이번 값 하나가 마우스 한 칸처럼 띄엄띄엄 왔는지.
    let single = false;
    if (dt > restMs) fresh = single = true;
    else if (this.axis !== was && dir !== this.dir) {
      // 휘어지게 쓸다 축이 바뀐 것은 되돌아가는 게 아니에요. 새 축의 방향만 기억하고, 정말 새로 쓰는지는 세지는지로 봐요.
      this.dir = dir;
      this.low = Infinity;
      this.lowSize = Infinity;
      return 0;
    } else if (dir !== this.dir) {
      // 관성 끝에 섞이는 작은 반대 값은 무시해요.
      if (Math.abs(d) < notchPx) return 0;
      fresh = true;
    } else if (t - this.stepAt >= coolMs) {
      const notch = dt >= notchGapMs && r >= prev;
      // 새로 쓸면 값도 속도도 함께 세져요. 바쁜 틈에 한데 몰린 값(값만 큼)이나, 밀렸다가 한꺼번에 들어온 값(속도만 큼)은 새 손짓이 아니에요.
      const size = Math.abs(d);
      const rise = r >= riseX * this.low && r >= this.low + risePx && size >= riseX * this.lowSize && size >= this.lowSize + risePx;
      fresh = !this.armed && (notch || rise);
      single = fresh && notch;
      this.low = Math.min(this.low, r);
      this.lowSize = Math.min(this.lowSize, size);
    }
    if (fresh) {
      this.armed = true;
      this.sum = 0;
      this.dir = dir;
      this.low = Infinity;
      this.lowSize = Infinity;
    }
    if (!this.armed) return 0;
    this.sum += d;
    if (Math.abs(this.sum) < (single ? notchMinPx : notchPx)) return 0;
    this.armed = false;
    this.sum = 0;
    this.stepAt = t;
    this.low = Infinity;
    this.lowSize = Infinity;
    return dir as -1 | 1;
  }
}

// 장면을 넘긴 뒤나 목록이 끝에 닿은 뒤, 휠이 이만큼 멈출 때까지는 같은 흐름으로 봐요.
export const sceneQuietMs = 300;
// 장면을 넘긴 직후 이만큼 안에 오는 반대 값은 휠이 튄 거예요.
export const sceneBounceMs = 80;

// 집의 두 장면(방 지도와 서랍장) 사이를 휠로 넘길지 정해요. "list"는 목록 종이가 스크롤하고, 0은 막기만 하고, ±1은 그쪽 장면으로 가요.
// 장면이 둘뿐이라 넘긴 뒤 같은 방향 값은 갈 곳이 없어요. 새 손짓은 부호로만 봐요. WheelStepper의 세짐 판단은 관성 끝에서 헛걸음을 낼 수 있어서 쓰지 않아요.
export class SceneWheelGate {
  private quietUntil = 0;
  private listUntil = 0;
  private dir = 0;
  private movedAt = -Infinity;
  // 장면을 넘긴 뒤 막은 값 중 가장 작은 값. 잦아든 관성보다 확 세지면 새로 쓴 거예요.
  private low = Infinity;
  // 느리게 쓸 때 오는 작은 값을 같은 쪽으로 모은 것.
  private sum = 0;
  private sumAt = -Infinity;

  push(deltaY: number, t: number, listHasRoom: boolean): "list" | -1 | 0 | 1 {
    const dir = Math.sign(deltaY) as -1 | 1;
    const size = Math.abs(deltaY);
    const turning = dir !== this.dir && size >= notchPx && t - this.movedAt >= sceneBounceMs;
    // 목록 위에서 새로 쓰면 목록이 내려가요. 잘못 봐도 목록이 조금 내려갈 뿐 장면은 넘기지 않아요.
    const rising = listHasRoom && size >= riseX * this.low && size >= this.low + risePx;
    if (t < this.quietUntil && !turning && !rising) {
      this.quietUntil = t + sceneQuietMs;
      this.low = Math.min(this.low, size);
      return 0;
    }
    if (listHasRoom) {
      this.quietUntil = 0;
      this.listUntil = t + sceneQuietMs;
      return "list";
    }
    // 목록을 내리던 흐름이 끝에 닿아도 그 흐름으로는 장면을 넘기지 않아요.
    if (t < this.listUntil) {
      this.listUntil = t + sceneQuietMs;
      return 0;
    }
    // 느린 쓸기나 고해상도 휠의 작은 값은 같은 쪽으로 모여 notchPx가 되면 넘겨요. 1px 한두 번(살짝 건드림)은 넘지 않아요.
    if (size < notchMinPx) {
      this.sum = Math.sign(this.sum) === dir && t - this.sumAt <= restMs ? this.sum + deltaY : deltaY;
      this.sumAt = t;
      if (Math.abs(this.sum) < notchPx) return 0;
    }
    this.sum = 0;
    this.quietUntil = t + sceneQuietMs;
    this.dir = dir;
    this.movedAt = t;
    this.low = Infinity;
    return dir;
  }
}

// 손짓 첫머리에는 가로와 세로 값이 섞여 와요. 첫 값 하나로 축을 정하면 살짝 기운 세로 쓸기가 방을 고르거나 가로 쓸기가 장면을 넘겨요.
// 넘길 값이 오면 이만큼 더 모아 보고 큰 쪽으로 정해요.
export const axisMs = 50;

export class AxisWindow {
  private x = 0;
  private y = 0;
  private until = -Infinity;

  // 넘길 값이 왔어요. 그 값부터 모아요.
  open(deltaX: number, deltaY: number, t: number) {
    this.x = Math.abs(deltaX);
    this.y = Math.abs(deltaY);
    this.until = t + axisMs;
  }

  // 휠 값마다 불러요. 모으는 동안만 더해요.
  add(deltaX: number, deltaY: number, t: number) {
    if (t > this.until) return;
    this.x += Math.abs(deltaX);
    this.y += Math.abs(deltaY);
  }

  sideways() {
    return this.x > this.y;
  }
}
