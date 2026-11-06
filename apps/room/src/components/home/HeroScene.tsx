import type { DoorItem } from "../../domain/doorstep";
import type { WorkLog } from "../../domain/worklog";
import type { OpenRoomMenu } from "../ContextMenu";
import { DoorstepRow } from "../Doorstep";
import { BrandMark } from "../Icon";
import { SkyMap } from "../SkyMap";
import type { SceneProps } from "./engine";
import { WorkCalendar } from "./WorkCalendar";

type HeroProps = SceneProps & {
  selectedId: string | null;
  focusId: string | null;
  doorItems: DoorItem[];
  onDoorMenu: OpenRoomMenu;
  workLog: WorkLog;
};

// 첫 화면: 프로도들이 한 줄로 선 홈. 고른 프로도는 다가가 보고, 파일은 그 아래로 나와요.
export function HeroScene({ rooms, stats, now, actions, selectedId, focusId, doorItems, onDoorMenu, workLog }: HeroProps) {
  const selected = rooms.find((room) => room.id === selectedId) ?? null;

  return (
    <section className="scene scene-hero" aria-label="첫 화면">
      {rooms.length === 0 ? (
        <div className="home-empty">
          <BrandMark size={120} />
          <p>작업 폴더를 골라 첫 방을 만들어 보세요.</p>
          <button type="button" className="primary big" onClick={actions.openNew}>첫 방 만들기</button>
        </div>
      ) : (
        <div className="sky-layout">
          <section className="sky-stage">
            <SkyMap rooms={rooms} stats={stats} now={now} selectedId={selected && !selected.care.done ? selected.id : null} focusId={focusId} doorOpen={doorItems.length > 0} onSelectRoom={actions.selectRoom} onOpenRoom={actions.openRoom} onFocusThing={actions.focusThing} onOpenThing={actions.openFile} onRoomMenu={actions.roomMenu} />
            {rooms.every((room) => room.care.done) && (
              <div className="sky-empty">
                <p>홈에 둔 방이 없어요.</p>
                <button type="button" aria-haspopup="dialog" onClick={actions.openMenu}>뺀 방 보기</button>
              </div>
            )}
          </section>
          {/* 프로도를 고르면 그 방만 보이게 현관 줄과 일력은 잠시 비켜 줍니다. */}
          {!selected && <DoorstepRow items={doorItems} now={now} onMenu={onDoorMenu} />}
          {!selected && <WorkCalendar rooms={rooms} log={workLog} now={now} />}
        </div>
      )}
    </section>
  );
}
