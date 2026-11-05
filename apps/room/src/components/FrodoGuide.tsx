import { useEffect } from "react";
import { PoseArt } from "./RoomFace";
import { centerOf, cue } from "./useFrodo";

const guidePx = 64;
const controls = 'button, a[href], input, select, textarea, summary, label, [role="tab"]';
// 방 프로도가 직접 반응하는 것들은 빼고, 나머지 모든 조작을 도우미가 받습니다.
const ownReaction = ".room-node, .thing, .box-spot, .paper-art";

const controlOf = (target: EventTarget | null) => {
  const el = target instanceof Element ? target.closest(controls) : null;
  return el && !el.closest(ownReaction) ? el : null;
};

// 메뉴나 환경설정처럼 어느 방에도 속하지 않는 곳에서 반응하는 프로도입니다.
export function FrodoGuide() {
  return (
    <span className="frodo-guide" aria-hidden="true">
      <PoseArt pose="idle" actor="guide" px={guidePx} />
    </span>
  );
}

// 버튼을 하나씩 고치지 않고 문서 한 곳에서 받아, 앞으로 생길 버튼도 저절로 반응합니다.
export function useGuideEvents() {
  useEffect(() => {
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const el = controlOf(event.target);
      if (!el) return cue("guide", { look: null });
      cue("guide", { look: centerOf(el), ...(el.matches(".danger") ? { face: "worried" as const, ms: 1200 } : {}) });
    };
    const onFocus = (event: FocusEvent) => {
      const el = controlOf(event.target);
      if (el?.matches(":focus-visible")) cue("guide", { look: centerOf(el) });
    };
    const onClick = (event: MouseEvent) => {
      const el = controlOf(event.target);
      if (el) cue("guide", el.matches(".danger") ? { face: "worried", ms: 1200, body: "tilt" } : { body: "nod" });
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("click", onClick);
    };
  }, []);
}
