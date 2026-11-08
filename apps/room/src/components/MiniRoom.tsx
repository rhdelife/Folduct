import { ObjectShape } from "../art/ObjectShape";
import { laneOf, lanes, type Lane } from "../domain/care";
import type { Room } from "../domain/model";

const titles: Record<Lane, string> = { new: "새로 왔어요", use: "요즘 써요", quiet: "잠잠해요", box: "정리 상자" };
// 줄마다 큰 파일 몇 장만 작게 보여 줍니다.
const shown = 9;

// 오른쪽 서랍의 작은 방 미리보기. 방 안과 같은 네 줄을 줄여서 보여줍니다(조작은 안 됨).
export function MiniRoom({ room, now }: { room: Room; now: number }) {
  return (
    <div className="mini-lanes" aria-hidden="true">
      {lanes.map((lane) => {
        const things = room.things.filter((thing) => laneOf(thing, room, now) === lane).sort((a, b) => b.size - a.size);
        return (
          <div key={lane} className={`mini-lane mini-lane-${lane}`}>
            <span className="mini-lane-title">{titles[lane]} <b>{things.length}</b></span>
            <span className="mini-lane-things">
              {things.slice(0, shown).map((thing) => (
                <ObjectShape key={thing.id} kind={thing.kind} size={20} seed={thing.id} />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
