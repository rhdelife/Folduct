import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { isNative } from "./gateways/native";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";

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
  // 집으로 돌아오면 방금 있던 방을 골라 둡니다.
  const [lastRoomId, setLastRoomId] = useState(roomId);
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

  return (
    <ErrorBoundary key={roomId ?? "home"}>
      {roomId ? <RoomPage key={roomId} roomId={roomId} onBack={back} /> : <Home returnTo={lastRoomId} onOpen={open} />}
    </ErrorBoundary>
  );
}

// 그리다 실패해도 빈 화면 대신 돌아갈 길을 보여 줍니다. 저장된 기록은 건드리지 않습니다.
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
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
