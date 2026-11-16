import type { DoorItem } from "../../domain/doorstep";
import type { WorkLog } from "../../domain/worklog";
import { isNative } from "../../gateways/native";
import type { OpenRoomMenu } from "../ContextMenu";
import { DoorstepRow } from "../Doorstep";
import { PoseArt } from "../RoomFace";
import { SkyMap } from "../SkyMap";
import type { SceneProps } from "./engine";
import { HomeStack } from "./HomeStack";
import { useWorkSession, WorkControl } from "./WorkControl";

type HeroProps = SceneProps & {
  selectedId: string | null;
  focusId: string | null;
  doorItems: DoorItem[];
  onDoorMenu: OpenRoomMenu;
  workLog: WorkLog;
  staleFiles: number;
  // 이번 주 정리할 때가 되면 홈 프로도가 말풍선으로 알려요.
  sweepDue: boolean;
  onSweepLater: () => void;
  // 오른쪽 미리보기 창이 열려 있으면 홈 배치가 그 폭만큼 비켜요.
  paneOpen: boolean;
};

// 첫 화면: 프로도들이 한 줄로 선 홈. 고른 프로도는 다가가 보고, 파일은 그 아래로 나와요.
export function HeroScene({ rooms, stats, now, actions, selectedId, focusId, doorItems, onDoorMenu, workLog, staleFiles, sweepDue, onSweepLater, paneOpen }: HeroProps) {
  const selected = rooms.find((room) => room.id === selectedId) ?? null;
  const session = useWorkSession();

  return (
    <section className="scene scene-hero" aria-label="첫 화면">
      {rooms.length === 0 ? (
        <div className="home-empty">
          {/* 방이 하나도 없으면 로고 대신 프로도가 말풍선으로 첫 방을 권해요. 말은 프로도 말투(반말)예요. */}
          <p className="frodo-bubble">작업 폴더를 골라 첫 방을 만들어 봐.</p>
          <span className="home-frodo">
            <PoseArt pose="idle" px={240} mood="lookU" />
          </span>
          <button type="button" className="primary big" onClick={actions.openNew}>첫 방 만들기</button>
        </div>
      ) : (
        <div className={`sky-layout${selected ? " focused" : ""}`}>
          {/* 작업(시간 재기)은 위쪽 가운데 막대에서만 다뤄요. 프로도 아래는 먹인 방의 파일을 보는 자리예요. */}
          {isNative() && (
            <div className="work-bar">
              <WorkControl rooms={rooms} session={session} />
            </div>
          )}
          <section className="sky-stage">
            <SkyMap rooms={rooms} stats={stats} now={now} selectedId={selected && !selected.care.done ? selected.id : null} focusId={focusId} doorOpen={doorItems.length > 0} onSelectRoom={actions.selectRoom} onOpenRoom={actions.openRoom} onFocusThing={actions.focusThing} onOpenThing={actions.openFile} onRoomMenu={actions.roomMenu} onNewRoom={actions.openNew} workingId={session?.roomId ?? null} overFrodo={sweepDue && !selected ? <SweepBubble staleFiles={staleFiles} onOpen={actions.openSweep} onLater={onSweepLater} /> : undefined} paneOpen={paneOpen} />
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

// 이번 주 정리 말풍선: 프로도 말투(반말). 안 쓴 파일이 없으면 오래 안 쓴 방 때문에 뜬 거예요.
function SweepBubble({ staleFiles, onOpen, onLater }: { staleFiles: number; onOpen: () => void; onLater: () => void }) {
  return (
    <div className="frodo-bubble sweep-bubble" role="status">
      <p>{staleFiles > 0 ? `안 쓴 파일이 ${staleFiles}개 쌓였어. 이번 주 정리할까?` : "오래 안 쓴 방이 있어. 이번 주 정리할까?"}</p>
      <div className="sweep-bubble-actions">
        <button type="button" className="primary" aria-haspopup="dialog" onClick={onOpen}>보기</button>
        <button type="button" className="quiet" onClick={onLater}>다음 주에</button>
      </div>
    </div>
  );
}
