import { useEffect, useState } from "react";

export type LayoutMode = "wide" | "overlay" | "compact";

function modeOf(width: number): LayoutMode {
  if (width < 1024) return "compact";
  if (width < 1280) return "overlay";
  return "wide";
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => modeOf(window.innerWidth));

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1023px)");
    const overlay = window.matchMedia("(min-width: 1024px) and (max-width: 1279px)");
    const apply = () => setMode(modeOf(window.innerWidth));
    apply();
    compact.addEventListener("change", apply);
    overlay.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      compact.removeEventListener("change", apply);
      overlay.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  return mode;
}
