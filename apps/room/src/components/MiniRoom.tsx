import type { CSSProperties } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { objectScale } from "../domain/care";
import type { Room } from "../domain/model";
import { boxSpot, depth, plane, toScreen } from "../domain/plane";
import { CardboardBox, GridPaper } from "./RoomScene";
import { useFitScale } from "./useFitScale";

// 오른쪽 서랍의 작은 방 미리보기. 방 안과 같은 판을 줄여서 보여줍니다(조작은 안 됨).
export function MiniRoom({ room, now }: { room: Room; now: number }) {
  const [frame, scale] = useFitScale<HTMLDivElement>(plane.width, 1);
  const boxAt = toScreen(boxSpot);
  return (
    <div className="mini-frame" ref={frame} style={{ height: plane.height * scale }} aria-hidden="true">
      <div className="room-plane mini" style={{ width: plane.width, height: plane.height, transform: `scale(${scale})`, "--s": scale } as CSSProperties}>
        <GridPaper />
        <span className="box-spot" style={{ left: boxAt.left, top: boxAt.top, zIndex: depth(boxSpot) }}>
          <CardboardBox things={room.things.filter((thing) => thing.box)} />
        </span>
        {room.things.filter((thing) => thing.spot && !thing.box).map((thing) => {
          const at = toScreen(thing.spot!);
          const size = Math.round(60 * objectScale(thing.size));
          return (
            <span key={thing.id} className={`thing${thing.missing ? " missing" : ""}`} style={{ left: at.left, top: at.top, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, zIndex: depth(thing.spot!) }}>
              <span className="body"><ObjectShape kind={thing.kind} size={size} seed={thing.id} /></span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
