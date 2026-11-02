import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Kind, Room } from "../domain/model";
import type { RoomStat } from "../domain/sky";
import type { OpenRoomMenu } from "./ContextMenu";
import { KindLegend, SizeKey } from "./KindLegend";
import { HomeSummary, RoomRanking } from "./SkyPanel";
import { useModal } from "./useModal";

// 왼쪽에서 열리는 메뉴. 집 화면에 늘 보이던 요약·순위·범례와 가끔 쓰는 동작을 이 안으로 모았습니다.
export function HomeMenu({
  rooms,
  stats,
  now,
  kinds,
  actions,
  onClose,
  onSelectRoom,
  onRoomMenu,
}: {
  rooms: Room[];
  stats: Map<string, RoomStat>;
  now: number;
  kinds: Set<Kind>;
  actions: ReactNode;
  onClose: () => void;
  onSelectRoom: (id: string) => void;
  onRoomMenu: OpenRoomMenu;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // 장면 안 버튼으로 열면 닫힐 때 포커스가 그 장면으로 돌아가, 엔진이 고른 방으로 가던 길을 되돌립니다. 돌아올 자리를 어디서나 살아 있는 머리 버튼으로 옮겨요.
  useLayoutEffect(() => {
    if (document.activeElement?.closest("[data-scene]")) document.querySelector<HTMLElement>(".home-actions button")?.focus();
  }, []);
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
          <button type="button" className="quiet" onClick={onClose}>닫기</button>
        </header>
        <div className="menu-actions">{actions}</div>
        {rooms.length > 0 && (
          <>
            <HomeSummary rooms={rooms} stats={stats} />
            <RoomRanking rooms={rooms} stats={stats} now={now} onSelectRoom={onSelectRoom} onRoomMenu={onRoomMenu} />
            <div className="legend-strip">
              <KindLegend kinds={kinds} />
              <SizeKey />
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
