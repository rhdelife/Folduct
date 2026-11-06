import { roomUsage } from "../../domain/care";
import { formatBytes, type Room } from "../../domain/model";
import { BrandMark, Icon } from "../Icon";

export function HomeHeader({ rooms, ready, overdue, newFiles, staleFiles, onWeekly, onMenu, onNew, onSettings }: { rooms: Room[]; ready: boolean; overdue: boolean; newFiles: number; staleFiles: number; onWeekly: () => void; onMenu: () => void; onNew: () => void; onSettings: () => void }) {
  const active = rooms.filter((room) => !room.care.done);
  const awake = rooms.length > 0;
  return (
    <header className={`home-header${awake ? " has-caption" : ""}`}>
      <div className="home-brand">
        <BrandMark size={32} />
        <h1 className="sr-only">Folduct</h1>
      </div>
      <div className={`home-caption${awake ? " visible" : ""}`}>
        <div className="caption-layer">
          <strong>방 {active.length}개 · {formatBytes(active.reduce((sum, room) => sum + roomUsage(room).totalBytes, 0))}</strong>
          <span>{[newFiles > 0 && `새 파일 ${newFiles}개가 기다려요`, staleFiles > 0 && `안 쓴 파일 ${staleFiles}개`].filter(Boolean).join(" · ") || "모두 제자리예요"}</span>
        </div>
      </div>
      <div className="home-actions">
        {ready && awake && (
          <button type="button" className="quiet" aria-haspopup="dialog" onClick={onWeekly}>
            주간 정리{overdue && <b> 할 때예요</b>}
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
