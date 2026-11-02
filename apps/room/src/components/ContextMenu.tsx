import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";

export type OpenRoomMenu = (id: string, opener: HTMLElement, x: number, y: number) => void;

// edge: 화면 가장자리에서 띄우는 거리.
export function clampMenu(x: number, y: number, width: number, height: number, viewWidth: number, viewHeight: number, edge: number) {
  return { left: Math.max(edge, Math.min(x, viewWidth - width - edge)), top: Math.max(edge, Math.min(y, viewHeight - height - edge)) };
}

// 메뉴만 닫으려던 클릭이 뒤에 있는 것까지 누르지 않게, 뒤따르는 click 하나를 삼킵니다.
// click이 오지 않으면(끌기·스크롤) 다음 입력에서 풉니다. 키보드로 누른 click을 삼키면 안 됩니다.
export function swallowNextClick(target: EventTarget) {
  const capture = { capture: true };
  const release = () => {
    target.removeEventListener("click", stop, capture);
    target.removeEventListener("pointerdown", release, capture);
    target.removeEventListener("keydown", release, capture);
  };
  const stop = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    release();
  };
  target.addEventListener("click", stop, capture);
  target.addEventListener("pointerdown", release, capture);
  target.addEventListener("keydown", release, capture);
}

export function menuStep(key: string, at: number, count: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowUp") return (at - 1 + count) % count;
  return null;
}

export function isMenuKey(event: { key: string; shiftKey: boolean }) {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

// 오른쪽 클릭과 메뉴 키를 함께 받습니다. 키로 열면 요소 왼쪽 아래에 띄웁니다.
export function roomMenuTriggers(id: string, open: OpenRoomMenu) {
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      open(id, event.currentTarget, event.clientX, event.clientY);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!isMenuKey(event)) return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      open(id, event.currentTarget, box.left, box.bottom);
    },
  };
}

// 닫힐 때는 늘 연 요소로 포커스를 돌려줍니다. 항목을 고른 뒤 그 요소가 사라지면 포커스를 옮기는 일은 고른 쪽의 몫입니다.
export function ContextMenu({ x, y, opener, label, items, onClose }: { x: number; y: number; opener: HTMLElement; label: string; items: { label: string; onSelect: () => void }[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });

  const close = useCallback(() => {
    onClose();
    opener.focus({ preventScroll: true });
  }, [onClose, opener]);

  useLayoutEffect(() => {
    const box = menu.current!.getBoundingClientRect();
    const edge = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-2"));
    setAt(clampMenu(x, y, box.width, box.height, window.innerWidth, window.innerHeight, edge));
    menu.current!.querySelector("button")?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return;
      // 오른쪽 클릭은 click이 따라오지 않고, 다른 대상에서 새 메뉴를 그대로 엽니다.
      if (event.button === 0) swallowNextClick(window);
      close();
    };
    window.addEventListener("pointerdown", outside, true);
    // 안쪽 칸의 스크롤도 잡도록 capture로 듣습니다. 항목이 많아 메뉴 자체가 스크롤될 때는 닫지 않아요.
    const scrolled = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [close]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // preventDefault가 있어야 모달 창 안에서 Escape가 창까지 닫지 않습니다.
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll("button")];
    const next = menuStep(event.key, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next].focus();
  }

  const body = (
    <div ref={menu} className="context-menu" role="menu" aria-label={label} style={at} onKeyDown={onKeyDown} onContextMenu={(event) => event.preventDefault()}>
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
  // 모달 창이 열려 있으면 창 바깥은 inert라 눌리지 않으니, 그 창 안에 붙입니다.
  const dialog = opener.closest("dialog");
  return dialog ? createPortal(body, dialog) : body;
}
