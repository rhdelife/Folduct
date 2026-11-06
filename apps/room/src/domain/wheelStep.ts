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
