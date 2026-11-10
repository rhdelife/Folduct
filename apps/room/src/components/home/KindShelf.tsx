import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { fitName, ObjectShape } from "../../art/ObjectShape";
import { colorGroups } from "../../art/palette";
import { formatBytes, type Room } from "../../domain/model";
import { kindShelves, type Shelf, type ShelfItem } from "../../domain/shelves";
import type { Folder } from "../../gateways/native";
import { usePicture } from "../../storage/pictures";
import { useReadableFolders, useThumb } from "../../storage/thumbs";
import { Meta } from "../Meta";

// 서랍마다 처음엔 이만큼, 더 보기를 누르면 shownMost장까지 놓아요(파일 수백 개짜리 방).
const shownAtFirst = 12;
const shownMost = 120;
const paperPx = 80;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// 열린 서랍의 앞판이 화면 위로 밀려 올라갔으면 다시 보이게 내려 줘요(위 서랍이 닫히며 줄어든 만큼).
const bringIntoView = (front: HTMLElement | null) => {
  if (front && front.getBoundingClientRect().top < 0) front.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
};

// 홈 아래: 홈에 둔 방들의 파일을 형식마다 서랍 하나에 모아요. 서랍은 한 번에 하나만 열려요.
// 주름관은 방 하나만 뜻해서 여기에는 쓰지 않아요. 색은 형식 색만 써요.
export const KindShelf = forwardRef<HTMLElement, { rooms: Room[]; onOpenFile: (roomId: string, thingId: string) => void }>(function KindShelf({ rooms, onOpenFile }, ref) {
  const shelves = useMemo(() => kindShelves(rooms, colorGroups), [rooms]);
  const folders = useReadableFolders(rooms.filter((room) => !room.care.done));
  const [open, setOpen] = useState<string | null>(null);
  if (shelves.length === 0) return null;
  const total = shelves.reduce((sum, shelf) => sum + shelf.items.length, 0);
  // 앞판 사이를 위·아래 화살표, Home·End 로 옮겨 다녀요.
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const fronts = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".kind-drawer-front")];
    const at = fronts.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: fronts.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    fronts[(next + fronts.length) % fronts.length].focus();
  };
  return (
    <section ref={ref} className="kind-shelves" aria-labelledby="kind-shelves-title">
      <header className="kind-shelves-head">
        <h2 id="kind-shelves-title">형식별로 보기</h2>
        <p>홈에 둔 방의 파일 {total.toLocaleString("ko-KR")}개를 종류대로 서랍에 모았어요. 버전이 여럿인 파일은 최신본만 보여요.</p>
      </header>
      <div className="kind-drawers" onKeyDown={moveFocus}>
        {shelves.map((shelf) => (
          <Drawer key={shelf.label} shelf={shelf} open={open === shelf.label} onToggle={() => setOpen(open === shelf.label ? null : shelf.label)} onClose={() => setOpen(null)} folders={folders} onOpenFile={onOpenFile} />
        ))}
      </div>
    </section>
  );
});

type DrawerProps = { shelf: Shelf; open: boolean; onToggle: () => void; onClose: () => void; folders: Map<string, Folder>; onOpenFile: (roomId: string, thingId: string) => void };

export function Drawer({ shelf, open, onToggle, onClose, folders, onOpenFile }: DrawerProps) {
  const front = useRef<HTMLButtonElement>(null);
  // 처음 열 때 종이를 그려요. 닫힌 서랍의 썸네일을 미리 읽지 않고, 한 번 연 뒤엔 닫히는 동안에도 남아 있어요.
  const [filled, setFilled] = useState(open);
  const [all, setAll] = useState(false);
  const id = `kind-drawer-${shelf.kinds[0]}`;
  const color = colorGroups.find((group) => group.label === shelf.label)?.color;
  useEffect(() => {
    if (!open) return;
    setFilled(true);
    // 움직임을 줄이면 미끄러짐이 없어 transitionend 가 오지 않아요. 그래서 바로 맞춰요.
    if (reducedMotion()) requestAnimationFrame(() => bringIntoView(front.current));
  }, [open]);
  const shown = shelf.items.slice(0, all ? shownMost : shownAtFirst);
  return (
    <div
      className={`kind-drawer${open ? " open" : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        onClose();
        front.current?.focus();
      }}
    >
      <h3 className="kind-drawer-title">
        <button ref={front} type="button" id={`${id}-front`} className="kind-drawer-front" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
          <span className="kind-dot" style={{ background: color }} aria-hidden="true" />
          <span className="kind-drawer-label">{shelf.label}</span>
          <Meta className="kind-drawer-count" items={[`${shelf.items.length.toLocaleString("ko-KR")}개`, formatBytes(shelf.size)]} />
          <span className="kind-drawer-pull" aria-hidden="true" />
        </button>
      </h3>
      <div
        id={`${id}-body`}
        className="kind-drawer-body"
        role="region"
        aria-labelledby={`${id}-front`}
        inert={!open}
        onTransitionEnd={(event) => open && event.target === event.currentTarget && event.propertyName === "grid-template-rows" && bringIntoView(front.current)}
      >
        <div className="kind-drawer-tray">
          {filled && (
            <>
              <ul className="kind-drawer-things">
                {shown.map((item, order) => (
                  <li key={item.thing.id}>
                    <ShelfPaper item={item} order={order} folder={folders.get(item.room.id) ?? null} onOpen={() => onOpenFile(item.room.id, item.thing.id)} />
                  </li>
                ))}
              </ul>
              {shelf.items.length > shown.length &&
                (all ? (
                  <p className="kind-drawer-more">최근 {shownMost}개까지만 보여요. 나머지는 방 안에서 찾아 주세요.</p>
                ) : (
                  <button type="button" className="kind-drawer-more" onClick={() => setAll(true)}>나머지 {(shelf.items.length - shown.length).toLocaleString("ko-KR")}개도 보기</button>
                ))}
            </>
          )}
        </div>
      </div>
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
