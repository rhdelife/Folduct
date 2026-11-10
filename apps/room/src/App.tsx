import { Component, lazy, Suspense, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Intro, replayIntroEvent } from "./components/Intro";
import { isNative } from "./gateways/native";
import { Home } from "./pages/Home";
import { getIntroOn } from "./storage/db";

// 방 화면은 첫 화면에 필요 없어서 따로 받습니다. 집이 그려진 뒤 쉴 때 미리 받아 두면 방을 열 때 비어 보이지 않아요.
const loadRoomPage = () => import("./pages/RoomPage").then((m) => ({ default: m.RoomPage }));
const RoomPage = lazy(loadRoomPage);
window.setTimeout(() => void loadRoomPage(), 1500);

// 데스크톱 창에서만 켜는 CSS(튕김 끄기 등)의 기준입니다.
document.documentElement.dataset.shell = isNative() ? "native" : "web";

// 주소: #/ 는 집, #/room/<id> 는 방 하나. 나머지 주소는 집으로 바꿔 둡니다.
function readRoute(): string | null {
  const id = window.location.hash.match(/^#\/room\/([\w-]+)$/)?.[1] ?? null;
  if (id === null && !/^(#\/?)?$/.test(window.location.hash)) window.location.replace("#/");
  return id;
}

export default function App() {
  const [roomId, setRoomId] = useState(readRoute);
  // 집으로 돌아오면 방금 있던 방의 주름관으로 포커스를 돌려줍니다.
  const [lastRoomId, setLastRoomId] = useState(roomId);
  // 인트로는 집으로 켤 때만 나옵니다. 방 주소로 바로 열었거나 방에서 돌아올 때는 나오지 않아요.
  const [intro, setIntro] = useState<"checking" | "playing" | "leaving" | "off">(roomId ? "off" : "checking");
  const leaveIntro = useCallback(() => setIntro("leaving"), []);
  const endIntro = useCallback(() => setIntro("off"), []);
  useEffect(() => {
    if (intro !== "checking") return;
    // 설정을 못 읽으면 인트로 없이 집으로 갑니다. 저장소 오류는 집 화면이 알려요.
    getIntroOn().then((on) => setIntro(on ? "playing" : "off"), () => setIntro("off"));
  }, [intro]);
  // 다시 보기는 켜기 설정과 상관없이 한 번 틉니다. 인트로 동안 집이 내려가며 열린 환경설정 창도 함께 닫혀요.
  useEffect(() => {
    const replay = () => setIntro("playing");
    window.addEventListener(replayIntroEvent, replay);
    return () => window.removeEventListener(replayIntroEvent, replay);
  }, []);
  useEffect(() => {
    const onHash = () => {
      const id = readRoute();
      setRoomId(id);
      if (id) setLastRoomId(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function open(id: string) {
    window.history.pushState({ from: "home" }, "", `#/room/${id}`);
    setRoomId(id);
    setLastRoomId(id);
    window.scrollTo(0, 0);
  }

  // 집에서 들어왔으면 뒤로 가기 한 칸과 같게, 아니면(주소로 바로 열었거나 방을 지웠으면) 기록을 쌓지 않고 집으로.
  function back() {
    if ((window.history.state as { from?: string } | null)?.from === "home") window.history.back();
    else window.location.replace("#/");
    window.scrollTo(0, 0);
  }

  // 주간 정리 창이 인트로 위에 뜨지 않게, 집은 인트로가 걷힐 때부터 그립니다.
  const homeReady = intro === "leaving" || intro === "off";
  return (
    <>
      <ErrorBoundary key={roomId ?? "home"}>
        {roomId ? (
          <Suspense fallback={null}>
            <RoomPage key={roomId} roomId={roomId} onBack={back} />
          </Suspense>
        ) : homeReady && <Home returnTo={lastRoomId} entered={intro === "off"} onOpen={open} />}
      </ErrorBoundary>
      {!roomId && (intro === "playing" || intro === "leaving") && (
        <ErrorBoundary onFail={endIntro}>
          <Intro leaving={intro === "leaving"} onLeave={leaveIntro} onDone={endIntro} />
        </ErrorBoundary>
      )}
    </>
  );
}

// 그리다 실패해도 빈 화면 대신 돌아갈 길을 보여 줍니다. 저장된 기록은 건드리지 않습니다.
class ErrorBoundary extends Component<{ children: ReactNode; onFail?: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.props.onFail?.();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page-status" role="alert">
        <p>화면을 그리다 문제가 생겼어요. 방 기록은 그대로 있어요.</p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              window.location.replace("#/");
              this.setState({ failed: false });
            }}
          >
            집으로
          </button>
          <button type="button" onClick={() => window.location.reload()}>다시 불러오기</button>
        </div>
      </main>
    );
  }
}
