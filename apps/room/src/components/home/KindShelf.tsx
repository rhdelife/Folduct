import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { colorGroups } from "../../art/palette";
import { formatBytes, type Room } from "../../domain/model";
import { kindShelves, type Shelf, type ShelfItem } from "../../domain/shelves";
import type { Folder } from "../../gateways/native";
import { usePicture } from "../../storage/pictures";
import { useReadableFolders, useThumb } from "../../storage/thumbs";

// 칸마다 처음엔 이만큼, 더 보기를 누르면 shownMost장까지 놓아요(파일 수백 개짜리 방).
const shownAtFirst = 12;
const shownMost = 120;
const paperPx = 80;

// 홈 아래: 홈에 둔 방들의 파일을 형식별 칸으로 나눠 보여 줘요. 칸이 화면에 들어오면 종이가 위에서 차례로 내려앉아요.
// 주름관은 방 하나만 뜻해서 여기에는 쓰지 않아요. 색은 형식 색만 써요.
export const KindShelf = forwardRef<HTMLElement, { rooms: Room[]; onOpenFile: (roomId: string, thingId: string) => void }>(function KindShelf({ rooms, onOpenFile }, ref) {
  const shelves = useMemo(() => kindShelves(rooms, colorGroups), [rooms]);
  const folders = useReadableFolders(rooms.filter((room) => !room.care.done));
  if (shelves.length === 0) return null;
  const total = shelves.reduce((sum, shelf) => sum + shelf.items.length, 0);
  return (
    <section ref={ref} className="kind-shelves" aria-labelledby="kind-shelves-title">
      <header className="kind-shelves-head">
        <h2 id="kind-shelves-title">형식별로 보기</h2>
        <p>홈에 둔 방의 파일 {total.toLocaleString("ko-KR")}개를 종류대로 모았어요. 버전이 여럿인 파일은 최신본만 보여요.</p>
      </header>
      {shelves.map((shelf) => (
        <ShelfRow key={shelf.label} shelf={shelf} folders={folders} onOpenFile={onOpenFile} />
      ))}
    </section>
  );
});

function ShelfRow({ shelf, folders, onOpenFile }: { shelf: Shelf; folders: Map<string, Folder>; onOpenFile: (roomId: string, thingId: string) => void }) {
  const self = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  const [all, setAll] = useState(false);
  const id = `shelf-${shelf.kinds[0]}`;
  useEffect(() => {
    const element = self.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setSeen(true), { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  const shown = shelf.items.slice(0, all ? shownMost : shownAtFirst);
  const color = colorGroups.find((group) => group.label === shelf.label)?.color;
  return (
    <section ref={self} className={`kind-shelf${seen ? " seen" : ""}`} aria-labelledby={id}>
      <div className="kind-shelf-head">
        <span className="kind-dot" style={{ background: color }} aria-hidden="true" />
        <h3 id={id}>{shelf.label}</h3>
        <span className="kind-shelf-count">{shelf.items.length.toLocaleString("ko-KR")}개 · {formatBytes(shelf.size)}</span>
      </div>
      <ul className="kind-shelf-things">
        {shown.map((item, order) => (
          <li key={item.thing.id}>
            <ShelfPaper item={item} order={order} folder={folders.get(item.room.id) ?? null} onOpen={() => onOpenFile(item.room.id, item.thing.id)} />
          </li>
        ))}
      </ul>
      {shelf.items.length > shown.length &&
        (all ? (
          <p className="kind-shelf-more">최근 {shownMost}개까지만 보여요. 나머지는 방 안에서 찾아 주세요.</p>
        ) : (
          <button type="button" className="kind-shelf-more" onClick={() => setAll(true)}>나머지 {(shelf.items.length - shown.length).toLocaleString("ko-KR")}개도 보기</button>
        ))}
    </section>
  );
}

function ShelfPaper({ item, order, folder, onOpen }: { item: ShelfItem; order: number; folder: Folder | null; onOpen: () => void }) {
  const { room, thing, versions } = item;
  const self = useRef<HTMLButtonElement>(null);
  const own = usePicture(thing.id);
  const thumb = useThumb(self, own ? null : folder, thing);
  return (
    <button
      ref={self}
      type="button"
      className="shelf-paper"
      style={{ "--i": Math.min(order, 16) } as CSSProperties}
      title={`${thing.name} · ${room.name}`}
      aria-label={`${thing.name}, ${room.name} 방, ${formatBytes(thing.size)}${versions > 1 ? `, 버전 ${versions}개 중 최신` : ""}`}
      onClick={onOpen}
    >
      <span className="shelf-art">
        <ObjectShape kind={thing.kind} size={paperPx} name={thing.name} seed={thing.id} picture={own ?? thumb} />
      </span>
      <span className="shelf-meta">
        <span className="shelf-room">{room.name}</span>
        {versions > 1 && <b>버전 {versions}</b>}
      </span>
    </button>
  );
}
