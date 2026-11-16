import { useRef, type ReactNode } from "react";
import { version } from "../../package.json";
import type { Kind, Room } from "../domain/model";
import type { RoomStat } from "../domain/sky";
import type { OpenRoomMenu } from "./ContextMenu";
import { KindLegend, SizeKey } from "./KindLegend";
import { HomeSummary, RoomRanking } from "./SkyPanel";
import { useModal } from "./useModal";
import { Icon } from "./Icon";

// 왼쪽에서 열리는 메뉴. 도구와 방으로 바로 갑니다. 요약과 범례는 접어서 맨 아래에 둡니다.
export function HomeMenu({
  rooms,
  stats,
  now,
  kinds,
  actions,
  onClose,
  onOpenRoom,
  onRoomMenu,
}: {
  rooms: Room[];
  stats: Map<string, RoomStat>;
  now: number;
  kinds: Set<Kind>;
  actions: ReactNode;
  onClose: () => void;
  onOpenRoom: (id: string) => void;
  onRoomMenu: OpenRoomMenu;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog);
  // 메뉴 안에서 끌다가 바깥에서 놓아도 닫히지 않게, 누른 자리까지 바깥일 때만 닫습니다.
  const pressedOutside = useRef(false);
  return (
    <dialog
      ref={dialog}
      className="sheet menu"
      aria-labelledby="menu-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-body">
        <header className="menu-head">
          <h2 id="menu-title">메뉴</h2>
          <button type="button" className="quiet icon-close" aria-label="닫기" onClick={onClose}><Icon name="close" /></button>
        </header>
        <section className="menu-section" aria-labelledby="menu-tools">
          <h2 className="menu-label" id="menu-tools">정리와 도구</h2>
          <div className="menu-actions">{actions}</div>
        </section>
        {rooms.length > 0 && (
          <>
            <RoomRanking rooms={rooms} stats={stats} onOpenRoom={onOpenRoom} now={now} onRoomMenu={onRoomMenu} />
            <details className="done-group menu-about">
              <summary>요약과 보는 법</summary>
              <HomeSummary rooms={rooms} stats={stats} now={now} />
              <div className="legend-strip">
                <KindLegend kinds={kinds} />
                <SizeKey />
              </div>
            </details>
          </>
        )}
        <p className="soft">버전 {version}</p>
      </div>
    </dialog>
  );
}
