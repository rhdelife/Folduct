import type { Room } from "../../domain/model";
import { formatWork } from "../../domain/worklog";
import { BrandMark, Icon } from "../Icon";

// 머리 왼쪽은 오늘 작업 시간을 크게. 새 파일·안 쓴 파일은 왼쪽 아래 '진행 중' 탭에 있어요.
export type HomeView = "home" | "drawer";

// 홈과 Drawer는 머리줄 탭으로 오가요. 지금 화면은 색이 아니라 굵은 글자와 밑줄로 알려요. 좁은 창에서는 탭이 아래 가운데로 내려가요.
export function HomeHeader({ rooms, ready, today, view, onView, onWeekly, onMenu, onNew, onSettings }: { rooms: Room[]; ready: boolean; today: number; view: HomeView; onView: (view: HomeView) => void; onWeekly: () => void; onMenu: () => void; onNew: () => void; onSettings: () => void }) {
  const awake = rooms.length > 0;
  return (
    <header className={`home-header${awake ? " has-caption" : ""}`}>
      <div className="home-brand">
        <BrandMark size={32} />
        <h1 className="sr-only">Folduct</h1>
      </div>
      {awake && (
        <nav className="home-tabs" aria-label="화면">
          <button type="button" className="quiet" aria-current={view === "home" ? "page" : undefined} onClick={() => onView("home")}>홈</button>
          <button type="button" className="quiet" aria-current={view === "drawer" ? "page" : undefined} onClick={() => onView("drawer")}>Drawer</button>
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
