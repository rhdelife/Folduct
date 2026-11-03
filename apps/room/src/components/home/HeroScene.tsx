import { useEffect, type RefObject } from "react";
import type { DoorItem } from "../../domain/doorstep";
import type { OpenRoomMenu } from "../ContextMenu";
import { DoorstepRow } from "../Doorstep";
import { BrandMark } from "../Icon";
import { SkyMap } from "../SkyMap";
import { SkyPanel } from "../SkyPanel";
import { useBetween, type SceneProps } from "./engine";

type HeroProps = SceneProps & {
  selectedId: string | null;
  panelId: string | null;
  focusId: string | null;
  panelRef: RefObject<HTMLElement | null>;
  doorItems: DoorItem[];
  onDoorMenu: OpenRoomMenu;
};

// 첫 화면: 방 지도와 고른 방 패널.
export function HeroScene({ rooms, stats, now, actions, selectedId, panelId, focusId, panelRef, doorItems, onDoorMenu }: HeroProps) {
  const selected = rooms.find((room) => room.id === selectedId) ?? null;
  const panelRoom = rooms.find((room) => room.id === panelId) ?? null;

  // 스크롤해 줄로 가면 고른 방을 닫습니다.
  const atRest = useBetween(0, 5);
  useEffect(() => {
    if (!atRest && selected) actions.selectRoom(null);
  }, [atRest]);

  return (
    <section className="scene scene-hero" aria-label="첫 화면">
      {rooms.length === 0 ? (
        <div className="home-empty">
          <BrandMark size={120} />
          <p>작업 폴더를 골라 첫 방을 만들어 보세요.</p>
          <button type="button" className="primary big" onClick={actions.openNew}>첫 방 만들기</button>
        </div>
      ) : (
        <div className={`sky-layout${selected ? " has-panel" : ""}`}>
          <section className="sky-stage">
            <SkyMap rooms={rooms} stats={stats} now={now} selectedId={selected && !selected.care.done ? selected.id : null} focusId={focusId} onSelectRoom={actions.selectRoom} onOpenRoom={actions.openRoom} onFocusThing={actions.focusThing} onOpenThing={actions.openFile} onRoomMenu={actions.roomMenu} />
            {rooms.every((room) => room.care.done) && (
              <div className="sky-empty">
                <p>진행 중인 방이 없어요.</p>
                <button type="button" aria-haspopup="dialog" onClick={actions.openMenu}>완료된 프로젝트 보기</button>
              </div>
            )}
          </section>
          <aside className={`sky-panel${selected ? " open" : ""}`} ref={panelRef} aria-label="고른 방" inert={!selected}>
            {panelRoom && (
              <SkyPanel
                room={panelRoom}
                stats={stats}
                now={now}
                focusId={focusId}
                onSelectRoom={actions.selectRoom}
                onFocusThing={actions.focusThing}
                onEnter={actions.openRoom}
                onToggleDone={(id) => actions.toggleDone(id, !panelRoom.care.done)}
              />
            )}
          </aside>
          {/* 방을 고르면 패널과 겹치니 잠시 비켜 줍니다. */}
          {!selected && <DoorstepRow items={doorItems} now={now} onMenu={onDoorMenu} />}
        </div>
      )}
    </section>
  );
}
