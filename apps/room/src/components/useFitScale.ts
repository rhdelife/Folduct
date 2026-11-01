import { useLayoutEffect, useRef, useState } from "react";

// 방 무대(고정 크기)를 담는 틀의 너비에 맞춰 배율을 정합니다. min보다 작아지면 틀이 가로로 스크롤돼요.
export function useFitScale<T extends HTMLElement>(width: number, max: number, min = 0) {
  const ref = useRef<T>(null);
  const [scale, setScale] = useState(0.5);
  // 그리기 전에 맞춰서 반 크기 한 프레임이 보이지 않게 합니다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 소수 둘째 자리에서 내림: 틀을 넘지 않고, 같은 값이면 React가 다시 그리지 않습니다.
    const fit = () => setScale(Math.max(min, Math.floor(Math.min(max, el.clientWidth / width) * 100) / 100));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, max, min]);
  return [ref, scale] as const;
}
