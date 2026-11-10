import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { fitName, ObjectShape } from "../../art/ObjectShape";
import { colorGroups } from "../../art/palette";
import { formatBytes, type Room } from "../../domain/model";
import { kindShelves, type Shelf, type ShelfItem } from "../../domain/shelves";
import type { Folder } from "../../gateways/native";
import { usePicture } from "../../storage/pictures";
import { useReadableFolders, useThumb } from "../../storage/thumbs";
import { Meta } from "../Meta";

// 폴더마다 처음엔 이만큼, 더 보기를 누르면 shownMost장까지 놓아요(파일 수백 개짜리 방).
const shownAtFirst = 12;
const shownMost = 120;
const paperPx = 80;
// 장면을 넘긴 뒤 휠이 이만큼 멈출 때까지는 트랙패드 관성으로 보고 삼켜요.
const quietMs = 300;

const tabId = (shelf: Shelf) => `kind-tab-${shelf.kinds[0]}`;
const panelId = (shelf: Shelf) => `kind-folder-${shelf.kinds[0]}`;

// 홈 아래 한 장면: 홈에 둔 방들의 파일을 형식마다 폴더 하나에 모은 서랍이에요.
// 위에 엇갈려 꽂힌 탭을 누르면 그 형식 폴더가 앞으로 나와요. 한 번에 한 폴더만 앞에 있어요.
// 주름관은 방 하나만 뜻해서 여기에는 쓰지 않아요. 색은 형식 색만 써요.
export const KindShelf = forwardRef<HTMLElement, { rooms: Room[]; onOpenFile: (roomId: string, thingId: string) => void }>(function KindShelf({ rooms, onOpenFile }, ref) {
  const shelves = useMemo(() => kindShelves(rooms, colorGroups), [rooms]);
  const folders = useReadableFolders(rooms.filter((room) => !room.care.done));
  const [picked, setPicked] = useState<string | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const self = useRef<HTMLElement | null>(null);
  const shown = shelves.length > 0;
  // 집 화면과 이 장면은 휠 한 칸·한 번 쓸기에 한 장면씩 넘어가요. CSS scroll-snap 만으로는 휠 한 칸이 제자리로 튕겨 돌아와서 여기서 넘겨요.
  // 폴더 안에 더 내릴 파일이 있으면 그 폴더가 먼저 내려가요.
  useEffect(() => {
    const section = self.current;
    const scroller = section?.closest<HTMLElement>(".home");
    if (!section || !scroller) return;
    let quietUntil = 0;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element;
      if (event.ctrlKey || event.shiftKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY) || target.closest("dialog, .context-menu")) return;
      if (event.timeStamp < quietUntil) {
        quietUntil = event.timeStamp + quietMs;
        event.preventDefault();
        return;
      }
      const folder = target.closest<HTMLElement>(".kind-folder");
      if (folder && (event.deltaY > 0 ? folder.scrollTop + folder.clientHeight < folder.scrollHeight - 1 : folder.scrollTop > 0)) return;
      const top = scroller.scrollTop;
      const to = event.deltaY > 0 ? (top < section.offsetTop - 1 ? section.offsetTop : null) : top > 1 ? 0 : null;
      if (to === null) return;
      event.preventDefault();
      quietUntil = event.timeStamp + quietMs;
      scroller.scrollTo({ top: to, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [shown]);
  if (!shown) return null;
  const front = shelves.find((shelf) => shelf.label === picked) ?? shelves[0];
  const total = shelves.reduce((sum, shelf) => sum + shelf.items.length, 0);
  const pick = (shelf: Shelf, focus: boolean) => {
    setPicked(shelf.label);
    const tab = tabs.current?.querySelector<HTMLButtonElement>(`#${tabId(shelf)}`);
    if (focus) tab?.focus();
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  // 탭 사이는 좌우 화살표와 Home·End 로 옮기고, 옮긴 탭의 폴더가 바로 앞으로 나와요(ARIA 탭 패턴).
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = shelves.indexOf(front);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: shelves.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    pick(shelves[(next + shelves.length) % shelves.length], true);
  };
  return (
    <section
      ref={(element) => {
        self.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      className="kind-shelves" aria-labelledby="kind-shelves-title">
      <header className="kind-shelves-head">
        <h2 id="kind-shelves-title">형식별로 보기</h2>
        <p>홈에 둔 방의 파일 {total.toLocaleString("ko-KR")}개를 종류대로 폴더에 모았어요. 버전이 여럿인 파일은 최신본만 보여요.</p>
      </header>
      <div className="kind-cabinet">
        <div ref={tabs} className="kind-tabs" role="tablist" aria-label="파일 형식" onKeyDown={onKey}>
          {shelves.map((shelf, order) => {
            const on = shelf === front;
            return (
              <button
                key={shelf.label}
                type="button"
                role="tab"
                id={tabId(shelf)}
                className="kind-tab"
                style={{ "--i": order } as CSSProperties}
                aria-selected={on}
                aria-controls={panelId(shelf)}
                tabIndex={on ? 0 : -1}
                onClick={() => pick(shelf, false)}
              >
                <span className="kind-dot" style={{ background: colorGroups.find((group) => group.label === shelf.label)?.color }} aria-hidden="true" />
                {shelf.label}
              </button>
            );
          })}
        </div>
        {/* key 로 폴더를 바꿔 끼워서, 바꿀 때마다 새 폴더가 뒤에서 올라오는 움직임이 다시 돌아요. */}
        <KindFolder key={front.label} shelf={front} folders={folders} onOpenFile={onOpenFile} />
      </div>
    </section>
  );
});

export function KindFolder({ shelf, folders, onOpenFile }: { shelf: Shelf; folders: Map<string, Folder>; onOpenFile: (roomId: string, thingId: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = shelf.items.slice(0, all ? shownMost : shownAtFirst);
  return (
    <div id={panelId(shelf)} className="kind-folder" role="tabpanel" aria-labelledby={tabId(shelf)} tabIndex={0}>
      <div className="kind-folder-head">
        <h3>{shelf.label}</h3>
        <Meta className="kind-folder-count" items={[`${shelf.items.length.toLocaleString("ko-KR")}개`, formatBytes(shelf.size)]} />
      </div>
      <ul className="kind-folder-things">
        {shown.map((item, order) => (
          <li key={item.thing.id}>
            <ShelfPaper item={item} order={order} folder={folders.get(item.room.id) ?? null} onOpen={() => onOpenFile(item.room.id, item.thing.id)} />
          </li>
        ))}
      </ul>
      {shelf.items.length > shown.length &&
        (all ? (
          <p className="kind-folder-more">최근 {shownMost}개까지만 보여요. 나머지는 방 안에서 찾아 주세요.</p>
        ) : (
          <button type="button" className="kind-folder-more" onClick={() => setAll(true)}>나머지 {(shelf.items.length - shown.length).toLocaleString("ko-KR")}개도 보기</button>
        ))}
    </div>
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
      title={`${thing.name} (${room.name} 방)`}
      aria-label={`${thing.name}, ${room.name} 방, ${formatBytes(thing.size)}${versions > 1 ? `, 버전 ${versions}개 중 최신` : ""}`}
      onClick={onOpen}
    >
      <span className="shelf-art">
        <ObjectShape kind={thing.kind} size={paperPx} name={thing.name} seed={thing.id} picture={own ?? thumb} />
      </span>
      <span className="shelf-meta">
        {/* 종이 위 이름은 작게 찍혀서, 여기 한 번 더 또렷하게 적어요. 가운데를 줄여 확장자가 남아요. */}
        <span className="shelf-name">{fitName(thing.name, 6.4)[0]}</span>
        <span className="shelf-room">{room.name}</span>
        {versions > 1 && <b>버전 {versions}</b>}
      </span>
    </button>
  );
}
