import type { DoorItem } from "../../domain/doorstep";
import type { WorkLog } from "../../domain/worklog";
import { isNative } from "../../gateways/native";
import type { OpenRoomMenu } from "../ContextMenu";
import { DoorstepRow } from "../Doorstep";
import { BrandMark } from "../Icon";
import { SkyMap } from "../SkyMap";
import type { SceneProps } from "./engine";
import { HomeStack } from "./HomeStack";
import { WorkControl } from "./WorkControl";

type HeroProps = SceneProps & {
  selectedId: string | null;
  focusId: string | null;
  doorItems: DoorItem[];
  onDoorMenu: OpenRoomMenu;
  workLog: WorkLog;
  staleFiles: number;
};

// 첫 화면: 프로도들이 한 줄로 선 홈. 고른 프로도는 다가가 보고, 파일은 그 아래로 나와요.
export function HeroScene({ rooms, stats, now, actions, selectedId, focusId, doorItems, onDoorMenu, workLog, staleFiles }: HeroProps) {
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
        <div className={`sky-layout${selected ? " focused" : ""}`}>
          <section className="sky-stage">
            <SkyMap rooms={rooms} stats={stats} now={now} selectedId={selected && !selected.care.done ? selected.id : null} focusId={focusId} doorOpen={doorItems.length > 0} onSelectRoom={actions.selectRoom} onOpenRoom={actions.openRoom} onFocusThing={actions.focusThing} onOpenThing={actions.openFile} onRoomMenu={actions.roomMenu} underFrodo={isNative() ? <WorkControl rooms={rooms} /> : undefined} />
            {rooms.every((room) => room.care.done) && (
              <div className="sky-empty">
                <p>홈에 둔 방이 없어요.</p>
                <button type="button" aria-haspopup="dialog" onClick={actions.openMenu}>뺀 방 보기</button>
              </div>
            )}
          </section>
          {/* 좁은 창에는 왼쪽 아래 탭이 들어갈 자리가 없어 현관 줄을 위에 그대로 둬요(styles.css). 프로도를 고르면 천천히 비켜 줍니다. */}
          <div className="hero-extras" inert={selected ? true : undefined}>
            <DoorstepRow items={doorItems} now={now} onMenu={onDoorMenu} />
          </div>
          <HomeStack rooms={rooms} log={workLog} now={now} doorItems={doorItems} onDoorMenu={onDoorMenu} staleFiles={staleFiles} onSweep={actions.openSweep} />
        </div>
      )}
    </section>
  );
}
