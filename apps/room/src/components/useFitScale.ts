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

// 방 캔버스: 틀 전체를 판으로 씁니다. 물건 크기(배율)는 기준 판이 틀에 들어가는 비율로 정하고, 판은 그 배율로 틀을 꽉 채우는 크기예요.
export function useFitCanvas<T extends HTMLElement>(base: { width: number; height: number }, max: number, min: number) {
  const ref = useRef<T>(null);
  const [fit, setFit] = useState({ scale: 1, width: base.width, height: base.height });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const scale = Math.max(min, Math.floor(Math.min(max, el.clientWidth / base.width, el.clientHeight / base.height) * 100) / 100);
      setFit({ scale, width: el.clientWidth / scale, height: el.clientHeight / scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [base.width, base.height, max, min]);
  return [ref, fit] as const;
}
