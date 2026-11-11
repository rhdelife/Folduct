import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { colorGroups } from "../../art/palette";
import { formatBytes, type Room } from "../../domain/model";
import { kindShelves, type Shelf, type ShelfItem } from "../../domain/shelves";
import type { Folder } from "../../gateways/native";
import { usePicture } from "../../storage/pictures";
import { useReadableFolders, useThumb } from "../../storage/thumbs";
import { Meta } from "../Meta";

// 목록 종이에 처음엔 이만큼, 더 보기를 누르면 shownMost장까지 놓아요(파일 수백 개짜리 방).
const shownAtFirst = 12;
const shownMost = 120;
// 열린 서랍 안에 앞뒤로 겹쳐 꽂힌 종이 수.
const peekCount = 5;
const cardArtPx = 40;
// 장면을 넘긴 뒤 휠이 이만큼 멈출 때까지는 트랙패드 관성으로 보고 삼켜요.
const quietMs = 300;
const slipId = "kind-slip";

const frontId = (shelf: Shelf) => `kind-drawer-${shelf.kinds[0]}`;
const colorOf = (shelf: Shelf) => colorGroups.find((group) => group.label === shelf.label)?.color;

// 홈 아래 한 장면: 홈에 둔 방들의 파일을 형식마다 서랍 하나에 나눠 담은 서랍장이에요.
// 서랍을 누르면 앞으로 빠져나오며 안의 종이가 튀어 오르고, 나머지 서랍은 흐려지고, 옆에 그 서랍의 목록 종이가 펼쳐져요. 한 번에 한 서랍만 열려요.
// 주름관은 방 하나만 뜻해서 여기에는 쓰지 않아요. 색은 형식 색만 써요.
export const KindShelf = forwardRef<HTMLElement, { rooms: Room[]; onOpenFile: (roomId: string, thingId: string) => void }>(function KindShelf({ rooms, onOpenFile }, ref) {
  const shelves = useMemo(() => kindShelves(rooms, colorGroups), [rooms]);
  const folders = useReadableFolders(rooms.filter((room) => !room.care.done));
  const [open, setOpen] = useState<string | null>(null);
  // 닫히는 동안에도 목록 종이가 빈 채로 빠지지 않게 마지막으로 연 서랍을 붙들어 둬요.
  const [last, setLast] = useState<string | null>(null);
  const self = useRef<HTMLElement | null>(null);
  const slip = useRef<HTMLDivElement>(null);
  const shown = shelves.length > 0;
  // 집 화면과 이 장면은 휠 한 칸·한 번 쓸기에 한 장면씩 넘어가요. CSS scroll-snap 만으로는 휠 한 칸이 제자리로 튕겨 돌아와서 여기서 넘겨요.
  // 목록 종이 안에 더 내릴 파일이 있으면 그 종이가 먼저 내려가요.
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
      const list = target.closest<HTMLElement>(".kind-folder");
      if (list && (event.deltaY > 0 ? list.scrollTop + list.clientHeight < list.scrollHeight - 1 : list.scrollTop > 0)) return;
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
  // 서랍을 열면 목록 종이로 포커스를 옮겨, 키보드로 바로 파일을 고를 수 있어요.
  useEffect(() => {
    if (open) slip.current?.focus({ preventScroll: true });
  }, [open]);
  if (!shown) return null;
  const total = shelves.reduce((sum, shelf) => sum + shelf.items.length, 0);
  const listed = shelves.find((shelf) => shelf.label === last) ?? null;
  const toggle = (shelf: Shelf) => {
    const next = open === shelf.label ? null : shelf.label;
    setOpen(next);
    if (next) setLast(next);
  };
  // 닫으면 그 서랍 앞판으로 포커스를 돌려줘요.
  const close = () => {
    const was = shelves.find((shelf) => shelf.label === open);
    setOpen(null);
    if (was) self.current?.querySelector<HTMLButtonElement>(`#${frontId(was)}`)?.focus({ preventScroll: true });
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    close();
  };
  return (
    <section
      ref={(element) => {
        self.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      className="kind-shelves" aria-labelledby="kind-shelves-title" onKeyDown={onKey}>
      <header className="kind-shelves-head">
        <h2 id="kind-shelves-title">형식별로 보기</h2>
        <p>홈에 둔 방의 파일 {total.toLocaleString("ko-KR")}개를 종류대로 서랍에 나눠 담았어요. 버전이 여럿인 파일은 최신본만 보여요.</p>
      </header>
      <div className="kind-stage" data-open={open !== null}>
        <div className="kind-cabinet-wrap">
          <div className="kind-cabinet" style={{ "--rows3": Math.ceil(shelves.length / 3), "--rows2": Math.ceil(shelves.length / 2) } as CSSProperties}>
            {shelves.map((shelf) => (
              <Drawer key={shelf.label} shelf={shelf} on={open === shelf.label} onToggle={() => toggle(shelf)} />
            ))}
          </div>
        </div>
        <div ref={slip} id={slipId} className="kind-slip" role="region" aria-labelledby="kind-slip-title" tabIndex={-1} data-open={open !== null} inert={open === null}>
          {listed && (
            // key 로 종이를 바꿔 끼워서, 다른 서랍을 열 때마다 종이가 다시 내려앉아요.
            <div key={listed.label} className="kind-slip-paper" style={{ "--kind": colorOf(listed) } as CSSProperties}>
              <div className="kind-folder-head">
                <h3 id="kind-slip-title">
                  <span className="kind-dot" style={{ background: colorOf(listed) }} aria-hidden="true" />
                  {listed.label}
                </h3>
                <Meta className="kind-folder-count" items={[`${listed.items.length.toLocaleString("ko-KR")}개`, formatBytes(listed.size)]} />
                <button type="button" className="quiet kind-slip-close" onClick={close}>닫기</button>
              </div>
              <KindFolder shelf={listed} folders={folders} onOpenFile={onOpenFile} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

// 서랍 한 칸: 앞판(누르는 곳)과, 앞판 위에 붙어 함께 빠져나오는 속(안에 든 종이 몇 장).
function Drawer({ shelf, on, onToggle }: { shelf: Shelf; on: boolean; onToggle: () => void }) {
  return (
    <div className="kind-drawer" data-open={on} style={{ "--kind": colorOf(shelf) } as CSSProperties}>
      <button
        type="button"
        id={frontId(shelf)}
        className="kind-drawer-front"
        aria-expanded={on}
        aria-controls={slipId}
        aria-label={`${shelf.label} 서랍, ${shelf.items.length.toLocaleString("ko-KR")}개, ${formatBytes(shelf.size)}`}
        onClick={onToggle}
      >
        {/* 속: 위에서 내려다본 서랍 벽과 바닥, 그리고 앞뒤로 줄지어 꽂힌 종이(형식 색 색인 탭). 뒤 종이일수록 위로 고개를 내밀어요. 닫혀 있으면 앞판 윗변 아래로 접혀 안 보여요. */}
        <span className="kind-drawer-inside" aria-hidden="true">
          <span className="kind-drawer-walls">
            <span className="kind-drawer-floor" />
          </span>
          <span className="kind-drawer-papers">
            {shelf.items.slice(0, peekCount).map((item, order, peeks) => (
              <span key={item.thing.id} className="kind-drawer-sheet" style={{ "--i": order, "--back": peeks.length - 1 - order } as CSSProperties} />
            ))}
          </span>
        </span>
        <span className="kind-drawer-plate">
          <span className="kind-dot" aria-hidden="true" />
          <b>{shelf.label}</b>
        </span>
        <span className="kind-drawer-count">
          {shelf.items.length.toLocaleString("ko-KR")}개 · {formatBytes(shelf.size)}
        </span>
        <span className="kind-drawer-handle" aria-hidden="true" />
      </button>
    </div>
  );
}

// 목록 종이 몸: 파일 카드가 위아래로 겹쳐 쌓여 있고, 파일이 많으면 여기서 내려요.
export function KindFolder({ shelf, folders, onOpenFile }: { shelf: Shelf; folders: Map<string, Folder>; onOpenFile: (roomId: string, thingId: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = shelf.items.slice(0, all ? shownMost : shownAtFirst);
  return (
    <div className="kind-folder">
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
        <ObjectShape kind={thing.kind} size={cardArtPx} seed={thing.id} picture={own ?? thumb} />
      </span>
      {/* 카드 윗줄(이름·방)은 다음 카드에 가려지지 않는 자리에 있어요. */}
      <span className="shelf-meta">
        <span className="shelf-name-row">
          <span className="shelf-name">{thing.name}</span>
          {versions > 1 && <b>버전 {versions}</b>}
        </span>
        <span className="shelf-room">{room.name} · {formatBytes(thing.size)}</span>
      </span>
    </button>
  );
}
