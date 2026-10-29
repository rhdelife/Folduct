import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";

export type ToastAction = { label: string; run: () => void };
type ToastItem = { id: number; message: string; action?: ToastAction };

let nextId = 0;

// 글자 수만큼 오래 보여 주고(최대 10초), 되돌리기 같은 할 일이 있으면 적어도 8초.
export function toastMs(message: string, hasAction: boolean) {
  const ms = Math.min(10_000, 4_000 + 50 * message.length);
  return hasAction ? Math.max(8_000, ms) : ms;
}

// 잠깐 지나가는 결과만 알립니다. 페이지에만 둡니다: 모달 대화상자가 열리면 페이지가 inert라 보이지 않으니,
// 대화상자는 자기 안에 결과를 보여 줘요. 새 알림은 이전 알림을 바꿔 씁니다.
export function useToast() {
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const toast = useCallback((message: string, action?: ToastAction) => setCurrent({ id: ++nextId, message, action }), []);
  // 이미 다른 알림으로 바뀌었으면 그대로 둡니다.
  const close = useCallback((id: number) => setCurrent((cur) => (cur?.id === id ? null : cur)), []);
  // 알림 영역은 늘 붙어 있어야 화면 읽기 프로그램이 바뀐 내용을 읽어 줍니다.
  const toastRegion = (
    <div className="toast-region" role="status" aria-live="polite">
      {current && <Toast key={current.id} item={current} onClose={close} />}
    </div>
  );
  return { toast, toastRegion };
}

function Toast({ item, onClose }: { item: ToastItem; onClose: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const left = useRef(toastMs(item.message, item.action !== undefined));
  const paused = hovered || focused;

  // 마우스가 올라가 있거나 안의 버튼에 포커스가 있으면 남은 시간을 멈춥니다.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onClose(item.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [paused, item.id, onClose]);

  return (
    <div
      className="toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span>{item.message}</span>
      {item.action && (
        <button type="button" className="link" onClick={() => { onClose(item.id); item.action!.run(); }}>
          {item.action.label}
        </button>
      )}
      <button type="button" className="quiet" onClick={() => onClose(item.id)}>닫기</button>
    </div>
  );
}
