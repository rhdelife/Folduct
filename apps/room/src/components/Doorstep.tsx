import { ObjectShape } from "../art/ObjectShape";
import { relativeDay } from "../domain/care";
import { doorTitle, newestFirst, type DoorItem } from "../domain/doorstep";
import { formatBytes } from "../domain/model";
import { folderName } from "../gateways/native";
import { roomMenuTriggers, type OpenRoomMenu } from "./ContextMenu";
import { Meta } from "./Meta";

// 현관: 첫 화면 위쪽의 새 문서 1열. 터치에는 오른쪽 클릭이 없어서 그냥 눌러도 같은 메뉴가 열립니다.
export function DoorstepRow({ items, now, onMenu }: { items: DoorItem[]; now: number; onMenu: OpenRoomMenu }) {
  if (items.length === 0) return null;
  return (
    <section className="doorstep" aria-labelledby="doorstep-title">
      <h2 id="doorstep-title">{doorTitle(items, now)}</h2>
      <ul className="door-row">
        {newestFirst(items).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="door-item"
              aria-haspopup="menu"
              title={`${folderName(item.folder)}/${item.name}`}
              {...roomMenuTriggers(item.id, onMenu)}
              onClick={(event) => {
                // 키보드로 누른 click은 좌표가 없어(detail 0) 요소 아래에 띄웁니다.
                const box = event.currentTarget.getBoundingClientRect();
                onMenu(item.id, event.currentTarget, event.detail ? event.clientX : box.left, event.detail ? event.clientY : box.bottom);
              }}
            >
              <ObjectShape kind={item.kind} size={32} seed={item.id} />
              <span className="door-name">{item.name}</span>
              <Meta className="door-meta" items={[formatBytes(item.size), relativeDay(item.lastModified, now)]} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
