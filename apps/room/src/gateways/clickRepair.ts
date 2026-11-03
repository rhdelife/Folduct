// macOS 한글 입력기를 쓰면 입력칸이 선택된 상태의 빠른 클릭에서 WebKit이 mouseup을 mousedown보다 먼저 보냅니다.
// 그러면 click이 생기지 않아 첫 클릭이 사라져요. 순서가 뒤집힌 경우만 알아채서 눌림을 마저 끝냅니다.
const reversedWithinMs = 50;

export function clickOrder() {
  let pressed = false;
  let orphan: { target: unknown; at: number } | null = null;
  return {
    // 눌린 적 없이 뗀 자리를 기억합니다.
    up(target: unknown, at: number) {
      if (!pressed) orphan = { target, at };
      pressed = false;
    },
    // 방금 뗀 자리가 이제야 눌렸으면 순서가 뒤집힌 클릭입니다.
    down(target: unknown, at: number): boolean {
      const reversed = orphan !== null && orphan.target === target && at - orphan.at < reversedWithinMs;
      orphan = null;
      pressed = !reversed;
      return reversed;
    },
  };
}

export function repairClicks() {
  const order = clickOrder();
  addEventListener("mouseup", (event) => {
    if (event.isTrusted) order.up(event.target, event.timeStamp);
  }, true);
  addEventListener("mousedown", (event) => {
    if (!event.isTrusted || !order.down(event.target, event.timeStamp)) return;
    const { target, clientX, clientY, screenX, screenY } = event;
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, screenX, screenY, detail: 1 };
    // 눌림의 기본 동작(포커스 옮기기)과 다른 처리기가 끝난 뒤에 이어 줍니다.
    setTimeout(() => {
      target?.dispatchEvent(new PointerEvent("pointerup", init));
      target?.dispatchEvent(new MouseEvent("mouseup", init));
      target?.dispatchEvent(new MouseEvent("click", init));
    });
  }, true);
}
