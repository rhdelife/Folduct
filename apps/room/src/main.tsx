import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { repairClicks } from "./gateways/clickRepair";
import "./styles.css";

repairClicks();

// 플로팅 창은 같은 앱의 다른 주소로 뜹니다. 서로 필요 없는 코드를 싣지 않게 나눠 받아요.
const isPet = window.location.hash === "#/pet";
if (isPet) document.documentElement.dataset.window = "pet";
const Root = lazy(() => (isPet ? import("./components/Pet").then((m) => ({ default: m.Pet })) : import("./App")));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
);
