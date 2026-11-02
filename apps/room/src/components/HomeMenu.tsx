import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { captionWords } from "../domain/home";
import type { Kind, Room } from "../domain/model";
import type { RoomStat } from "../domain/sky";
import type { OpenRoomMenu } from "./ContextMenu";
import { scenes } from "./home/engine";
import { KindLegend, SizeKey } from "./KindLegend";
import { HomeSummary, RoomRanking } from "./SkyPanel";
import { useModal } from "./useModal";

// 왼쪽에서 열리는 메뉴. 스크롤 없이 장면과 방으로 바로 갑니다. 요약과 범례는 접어서 맨 아래에 둡니다.
export function HomeMenu({
  rooms,
  stats,
  now,
  kinds,
  actions,
  current,
  onGo,
  onClose,
  onOpenRoom,
  onRoomMenu,
}: {
  rooms: Room[];
  stats: Map<string, RoomStat>;
  now: number;
  kinds: Set<Kind>;
  actions: ReactNode;
  current: number;
  onGo: (scene: number) => void;
  onClose: () => void;
  onOpenRoom: (id: string) => void;
  onRoomMenu: OpenRoomMenu;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sceneWords = useMemo(() => captionWords(rooms, now), [rooms, now]);
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
        {rooms.length > 0 && (
          <nav className="menu-section" aria-labelledby="menu-go">
            <h2 className="menu-label" id="menu-go">화면</h2>
            <ul className="menu-nav">
              {/* 맨 아래 장면은 이 메뉴와 같은 바로가기뿐이라 뺍니다. */}
              {scenes.slice(0, sceneWords.length).map((scene, index) => (
                <li key={scene.name}>
                  <button type="button" aria-current={current === index ? "true" : undefined} onClick={() => onGo(index)}>
                    <span className="menu-nav-name">{scene.label}</span>
                    <span className="menu-nav-note">{sceneWords[index]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
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
      </div>
    </dialog>
  );
}
