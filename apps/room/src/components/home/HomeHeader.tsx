import type { Room } from "../../domain/model";
import { formatWork } from "../../domain/worklog";
import { isNative } from "../../gateways/native";
import { Icon } from "../Icon";
import { useWorkSession } from "./WorkControl";

// 머리 왼쪽은 오늘 작업 시간을 크게. 새 파일·안 쓴 파일은 왼쪽 아래 '진행 중' 탭에 있어요.
export type HomeView = "home" | "drawer" | "icons";

// 홈과 Drawer는 머리줄 탭으로 오가요. 지금 화면은 색이 아니라 굵은 글자와 밑줄로 알려요. 좁은 창에서는 탭이 아래 가운데로 내려가요.
// 작업 아이콘(.work-tab)은 왼쪽 아래 작업 기록 카드가 숨는 좁은·낮은 창에서만 보여요. 누르면 작업 판이 열리고, 작업 중이면 아이콘이 검은 알약이 돼요.
export function HomeHeader({ rooms, ready, today, view, onView, workOpen, onWork, onWeekly, onMenu, onNew, onSettings }: { rooms: Room[]; ready: boolean; today: number; view: HomeView; onView: (view: HomeView) => void; workOpen: boolean; onWork: () => void; onWeekly: () => void; onMenu: () => void; onNew: () => void; onSettings: () => void }) {
  const awake = rooms.length > 0;
  const session = useWorkSession();
  return (
    <header className={`home-header${awake ? " has-caption" : ""}`}>
      {/* 머리줄 로고는 뺐어요(2026-11-17 요청). 탭이 왼쪽 끝에서 시작해요. */}
      <h1 className="sr-only">Folduct</h1>
      {awake && (
        <nav className="home-tabs" aria-label="화면">
          <button type="button" className="quiet" aria-current={view === "home" ? "page" : undefined} onClick={() => onView("home")}>Home</button>
          <button type="button" className="quiet" aria-current={view === "drawer" ? "page" : undefined} onClick={() => onView("drawer")}>Drawer</button>
          {/* 파일 형식 아이콘을 그리고 모아 두는 페이지(2026-11-17부터 창이 아니라 탭 화면). */}
          <button type="button" className="quiet" aria-current={view === "icons" ? "page" : undefined} onClick={() => onView("icons")}>Icons</button>
          {isNative() && (
            <button type="button" className={`quiet work-tab${session ? " on" : ""}`} aria-label={session ? (session.status === "working" ? "작업 중" : "작업 멈춤") : "작업"} title={session ? "작업 중" : "작업"} aria-expanded={workOpen} aria-controls="work-bar" onClick={onWork}>
              <Icon name="work" size={20} />
            </button>
          )}
        </nav>
      )}
      <div className={`home-caption${awake ? " visible" : ""}`}>
        <div className="caption-layer">
          <strong>{today > 0 ? `오늘 ${formatWork(today)}` : "오늘은 아직 시작 전이에요"}</strong>
        </div>
      </div>
      <div className="home-actions">
        {ready && awake && (
          <button type="button" className="quiet" aria-haspopup="dialog" onClick={onWeekly}>
            주간 정리
          </button>
        )}
        <button type="button" className="quiet" aria-haspopup="dialog" disabled={!ready} onClick={onMenu}>메뉴</button>
        <button type="button" className="quiet" onClick={onNew}>+ 새 방</button>
        <button type="button" className="quiet settings-button" aria-label="환경설정" title="환경설정" aria-haspopup="dialog" onClick={onSettings}>
          <Icon name="settings" size={20} />
        </button>
      </div>
    </header>
  );
}
