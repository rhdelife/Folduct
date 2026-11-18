import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { boxColor, tonesFrom } from "../art/palette";
import { activityDays, laneOf, laneOrder, lanes, relativeDay, shownActivity, type Lane } from "../domain/care";
import { formatBytes, kindLabels, type Room, type Thing } from "../domain/model";
import { splitLane, type Pile } from "../domain/pile";
import { stacksOf } from "../domain/versions";
import { isSearching, matchesPath, searchOrder } from "../domain/search";
import type { Folder } from "../gateways/native";
import { usePicture } from "../storage/pictures";
import { useThumb } from "../storage/thumbs";
import { Icon } from "./Icon";
import { centerOf, cue } from "./useFrodo";
import { Meta } from "./Meta";
import { RoomCanvas } from "./RoomCanvas";
import type { CanvasItem } from "../domain/model";

const boxTones = tonesFrom(boxColor);
// 상자에 든 종이는 위로 조금 삐져나옵니다. 앞판이 종이를 가려서 상자 안에 든 것처럼 보여요.
const peeks = [{ left: "16%", rotate: "-8deg" }, { left: "42%", rotate: "6deg" }, { left: "29%", rotate: "-2deg" }];

// 정리 상자: 윗날개가 열린 문서 보관 상자. 색은 파일 형식이 아니라 상자 몫의 회색(palette.ts) 한 벌입니다.
export function CardboardBox({ things }: { things: Thing[] }) {
  return (
    <span className="cardboard" aria-hidden="true">
      <svg viewBox="0 0 100 100" focusable="false">
        <path d="M18 38L28 20H72L82 38Z" fill={boxTones.soft} />
        <path d="M18 38H82V60H18Z" fill={boxTones.edge} />
      </svg>
      {things.slice(-peeks.length).map((thing, at) => (
        <span key={thing.id} className="cardboard-peek" style={peeks[at]}><ObjectShape kind={thing.kind} size={38} seed={thing.id} /></span>
      ))}
      <svg viewBox="0 0 100 100" focusable="false">
        <path d="M18 38L3 31L8 50L18 56Z" fill={boxTones.soft} />
        <path d="M82 38L97 31L92 50L82 56Z" fill={boxTones.soft} />
        <path d="M18 52H82V98H18Z" fill={boxTones.pale} />
        <path d="M40 60H60Q63 60 63 63Q63 66 60 66H40Q37 66 37 63Q37 60 40 60Z" fill={boxTones.edge} />
        <path d="M31 74H69V90H31Z" fill="var(--bg)" />
        <path d="M37 80H63M37 85H54" stroke={boxTones.soft} strokeWidth="1.5" />
      </svg>
    </span>
  );
}

// 종이를 그리는 크기. 화면에서는 styles.css의 --lane-paper 폭으로 줄이거나 늘립니다.
const paperPx = 120;
// 줄마다 처음엔 앞에서부터 이만큼만, 더 보기를 누르면 shownMost개까지 그립니다(파일 수백 개짜리 폴더).
const shownAtFirst = 24;
const shownMost = 200;

// 방 안: 파일이 1→4로 흐르는 네 줄을 위아래로 쌓아요(왼쪽에 번호·제목, 오른쪽에 파일). 자리가 곧 상태라서 색 없이 자리·글자·모양으로 말합니다.
// folder는 읽어도 되는 방 폴더예요(권한 없음·샘플이면 null). query가 있으면 이름이 맞는 파일만 남겨요.
// only가 있으면(색으로 보기) 그 파일만 남기고, 찾을 때처럼 더미와 버전 겹침을 풀어요.
// picked가 있으면 고르는 중이라, 종이를 누르면 서랍에 띄우지 않고 골라요(여러 개 휴지통으로).
// 평소(찾지도 고르지도 않을 때)에는 줄 대신 빈 캔버스 판(RoomCanvas)에 꺼내 놓은 것만 보여 주고, 정리 상자 줄은 그 아래에 그대로 둬요.
// 찾거나 색으로 보거나 여러 개를 고를 때는 방 전체를 훑어야 해서 예전처럼 줄로 보여 줘요.
export function RoomScene({ room, now, folder, query, only = null, selectedId, onSelect, onOpen, picked = null, onPick, onCanvas, onTrash }: { room: Room; now: number; folder: Folder | null; query: string; only?: Set<string> | null; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void; picked?: Set<string> | null; onPick?: (id: string) => void; onCanvas: (items: CanvasItem[]) => void; onTrash?: (ids: Set<string>) => Promise<void> }) {
  const [opened, setOpened] = useState<Lane[]>([]);
  // 펼친 더미 하나(줄:열쇠)와, 그 더미에서 나머지도 보기를 눌렀는지.
  const [openPile, setOpenPile] = useState<{ id: string; all: boolean } | null>(null);
  // 자동 생성 폴더(tmp·build 등) 아래 파일은 줄 뒤쪽 더미로 묶어, 사람이 찾는 파일이 앞줄에 오게 해요.
  // 찾는 중에는 폴더 이름까지 보고, 더미를 풀어 찾은 파일을 모두 앞줄에 둬요. 이름이 맞는 파일·맨 위에 가까운 파일이 먼저예요.
  const searching = isSearching(query) || only !== null;
  const board = !searching && picked === null;
  // 같은 파일을 여러 번 저장한 계열은 최신본 한 장만 그 줄에 두고, 옛 버전은 그 뒤에 겹쳐요(서랍의 버전 기록에서 찾아요). 찾는 중에는 모두 풀어요.
  const stacks = useMemo(() => stacksOf(room.things), [room.things]);
  const groups = lanes.map((lane) => {
    const things = room.things.filter((thing) => laneOf(thing, room, now) === lane && (searching ? matchesPath(thing, query) && (!only || only.has(thing.id)) : !stacks.under.has(thing.id))).sort(searching ? searchOrder(query) : laneOrder[lane]);
    return { lane, things, ...(searching ? { front: things, piles: [] } : splitLane(things)) };
  });
  // 고른 파일이 더미 안에 있으면 그 더미를 펼쳐요. 상자에서 돌려놓았거나 줄이 바뀐 파일도 보이고, 포커스가 그 파일로 갈 수 있어요.
  // 화면에 그리기 전에 펼쳐야 RoomPage의 focusSoon(다음 프레임)이 그 파일을 찾아요. 펼친 뒤 사용자가 접으면 다시 펼치지 않아요.
  const holder = selectedId === null ? undefined : groups.flatMap(({ lane, piles }) => piles.map((pile) => ({ id: `${lane}:${pile.key}`, pile }))).find(({ pile }) => pile.things.some((thing) => thing.id === selectedId));
  const holderId = holder?.id ?? null;
  const holderFar = holder ? holder.pile.things.findIndex((thing) => thing.id === selectedId) >= shownAtFirst : false;
  useLayoutEffect(() => {
    if (holderId) setOpenPile((now) => (now?.id === holderId && (now.all || !holderFar) ? now : { id: holderId, all: holderFar }));
  }, [selectedId, holderId, holderFar]);
  // 고른 파일이 앞줄에서 처음 보이는 수보다 뒤에 있으면(찾는 중이거나 상자에서 돌려놓은 파일) 그 줄을 펼쳐 보이게 하고 포커스가 가게 해요.
  const farLane = selectedId === null ? undefined : groups.find(({ front }) => front.findIndex((thing) => thing.id === selectedId) >= shownAtFirst)?.lane;
  useLayoutEffect(() => {
    if (farLane) setOpened((now) => (now.includes(farLane) ? now : [...now, farLane]));
  }, [selectedId, farLane]);
  // 정리 상자는 닫혀 있어요. 열기 전에는 상자 안 종이(삐져나온 것도)를 보이지 않아요. 찾는 중이거나 상자 안 파일을 고르면 열어 둬요.
  const [boxOpen, setBoxOpen] = useState(false);
  const boxShown = boxOpen || searching || groups.some(({ lane, things }) => lane === "box" && things.some((thing) => thing.id === selectedId));
  // 줄은 번호·제목·개수만으로 읽혀요. 줄을 나누는 기준은 care.ts laneOf에 있어요.
  const titles: Record<Lane, string> = { new: "새로 왔어요", use: "요즘 써요", quiet: "잠잠해요", box: "정리 상자" };
  return (
    <div className="lanes">
      <p id="lanes-hint" className="sr-only">누르면 고르고, 고른 파일에서 Enter를 한 번 더 누르면 열어요.</p>
      {board && <RoomCanvas room={room} folder={folder} now={now} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} onChange={onCanvas} onTrash={onTrash} />}
      {groups.filter(({ lane }) => !board || lane === "box").map(({ lane, things, front, piles }) => {
        const index = lanes.indexOf(lane);
        const title = titles[lane];
        const shown = front.slice(0, opened.includes(lane) ? shownMost : shownAtFirst);
        const piled = things.length - front.length;
        const open = piles.find((pile) => openPile?.id === `${lane}:${pile.key}`);
        return (
          // 빈 줄은 한 줄로 얇게 접어 파일이 있는 줄이 먼저 보여요.
          <section key={lane} className={`lane lane-${lane}${things.length ? "" : " lane-empty"}`} aria-labelledby={`lane-${lane}`}>
            <div className="lane-head">
              {lane === "box" && <span className="lane-box-art"><CardboardBox things={boxShown ? things : []} /></span>}
              {/* 줄 순서(파일이 흘러가는 차례)를 번호로 보여 줘요. 줄은 넷이라 5단계를 넘지 않아요. */}
              <h2 id={`lane-${lane}`}>{!board && <><span className="lane-no">{index + 1}</span>{" "}</>}{title} <span className="lane-count">{things.length}</span></h2>
              {lane === "box" && things.length > 0 && !searching && (
                <button type="button" className="quiet lane-box-toggle" aria-expanded={boxShown} aria-controls="lane-box-body" onClick={() => setBoxOpen(!boxShown)}>{boxShown ? "닫기" : "열기"}</button>
              )}
            </div>
            <div className="lane-body" id={lane === "box" ? "lane-box-body" : undefined} hidden={lane === "box" && !boxShown}>
            {shown.length > 0 && (
              <ul className="lane-things">
                {shown.map((thing, order) => (
                  <li key={thing.id}>
                    <LanePaper room={room} folder={folder} stack={searching ? undefined : stacks.top.get(thing.id)} thing={thing} lane={lane} now={now} order={order} selected={thing.id === selectedId} onSelect={onSelect} onOpen={onOpen} picked={picked ? picked.has(thing.id) : undefined} onPick={onPick} />
                  </li>
                ))}
              </ul>
            )}
            {front.length > shown.length &&
              (opened.includes(lane) ? (
                <p className="lane-more">{searching ? `찾은 파일 중 ${shownMost}개까지만 보여요. 더 좁혀 주세요.` : `앞에서 ${shownMost}개까지만 보여요. 나머지는 이름으로 찾아 주세요.`}</p>
              ) : (
                <button type="button" className="lane-more" onClick={() => setOpened([...opened, lane])}>나머지 {(front.length - shown.length).toLocaleString("ko-KR")}개도 보기</button>
              ))}
            {piles.length > 0 && (
              <div className="lane-piles">
                <p className="lane-piles-head">{pileHeading(piles)} <Meta items={[`${piles.length}묶음`, `${piled.toLocaleString("ko-KR")}개`]} /></p>
                <ul className="lane-things">
                  {piles.map((pile) => {
                    const id = `${lane}:${pile.key}`;
                    return (
                      <li key={pile.key}>
                        <PileCard id={id} pile={pile} open={open === pile} onToggle={() => setOpenPile(open === pile ? null : { id, all: false })} />
                      </li>
                    );
                  })}
                </ul>
                {open && (
                  <div className="lane-pile-open" role="group" aria-label={`${open.label} 묶음 안`}>
                    <div className="lane-pile-open-head">
                      <h3 title={open.key}>{open.label} <span className="lane-count">{open.things.length.toLocaleString("ko-KR")}</span></h3>
                      <button
                        type="button"
                        onClick={() => {
                          const id = `${lane}:${open.key}`;
                          setOpenPile(null);
                          // 접기 단추가 사라지니 포커스를 그 더미로 돌려놓아요.
                          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pile-id="${CSS.escape(id)}"]`)?.focus());
                        }}
                      >
                        접기
                      </button>
                    </div>
                    <ul className="lane-things">
                      {open.things.slice(0, openPile?.all ? shownMost : shownAtFirst).map((thing, order) => (
                        <li key={thing.id}>
                          <LanePaper room={room} folder={folder} stack={searching ? undefined : stacks.top.get(thing.id)} thing={thing} lane={lane} now={now} order={order} selected={thing.id === selectedId} onSelect={onSelect} onOpen={onOpen} picked={picked ? picked.has(thing.id) : undefined} onPick={onPick} />
                        </li>
                      ))}
                    </ul>
                    {open.things.length > shownAtFirst &&
                      (openPile?.all ? (
                        open.things.length > shownMost && <p className="lane-more">앞에서 {shownMost}개까지만 보여요.</p>
                      ) : (
                        <button
                          type="button"
                          className="lane-more"
                          onClick={() => {
                            const next = open.things[shownAtFirst];
                            setOpenPile({ id: `${lane}:${open.key}`, all: true });
                            // 단추가 사라지니 새로 보인 첫 파일로 포커스를 옮겨요.
                            requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-thing-id="${CSS.escape(next.id)}"]`)?.focus());
                          }}
                        >
                          나머지 {(open.things.length - shownAtFirst).toLocaleString("ko-KR")}개도 보기
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// 줄 끝 더미들의 머리말. 자동 생성 폴더(tmp·build)와 보관 폴더(_archive·backup) 중 무엇이 있는지 말해요.
function pileHeading(piles: Pile[]): string {
  const archive = piles.filter((pile) => pile.archive).length;
  return archive === 0 ? "자동으로 생긴 파일" : archive === piles.length ? "보관 폴더" : "자동으로 생긴 파일·보관 폴더";
}

// 더미 한 장: 큰 파일 세 장을 겹쳐 쌓고 맨 위 종이에 마지막 폴더 이름을 찍어요(긴 경로는 종이에 안 들어가요). 누르면 그 줄 아래에 펼쳐져요.
function PileCard({ id, pile, open, onToggle }: { id: string; pile: Pile; open: boolean; onToggle: () => void }) {
  const [top, ...under] = pile.things.slice(0, 3);
  return (
    <button type="button" className="lane-paper lane-pile" data-pile-id={id} aria-expanded={open} aria-label={`${pile.label} 묶음, ${pile.archive ? "보관 폴더 파일" : "자동으로 생긴 파일"} ${pile.things.length}개, ${formatBytes(pile.size)}`} onClick={onToggle}>
      <span className="lane-art">
        {under.map((thing, at) => (
          <span key={thing.id} className={`lane-pile-under lane-pile-under-${at + 1}`} aria-hidden="true"><ObjectShape kind={thing.kind} size={paperPx} seed={thing.id} /></span>
        ))}
        <ObjectShape kind={top.kind} size={paperPx} name={pile.key.split("/").pop()} seed={top.id} />
      </span>
      <span className="lane-meta">
        <b>{pile.things.length.toLocaleString("ko-KR")}개</b>
        {formatBytes(pile.size)}
      </span>
    </button>
  );
}

// stack이 있으면 이 파일은 그 계열의 최신본이에요. 옛 버전 두 장을 뒤에 겹쳐 그리고 버전 수를 적어요.
function LanePaper({ room, folder, stack, thing, lane, now, order, selected, onSelect, onOpen, picked, onPick }: { room: Room; folder: Folder | null; stack?: Thing[]; thing: Thing; lane: Lane; now: number; order: number; selected: boolean; onSelect: (id: string) => void; onOpen: (id: string) => void; picked?: boolean; onPick?: (id: string) => void }) {
  const picking = picked !== undefined;
  // 종이 아래 날짜: 새 파일은 들어온 날, 잠잠한 파일은 쉰 날수, 나머지는 마지막으로 쓴 날. 상자는 서랍에서 보여요.
  const days = lane === "quiet" ? activityDays(thing, now) : null;
  const when = lane === "new" ? `${relativeDay(thing.seenAt, now)} 들어옴` : lane === "use" ? relativeDay(shownActivity(thing, room), now) : null;
  const self = useRef<HTMLButtonElement>(null);
  // 직접 고른 그림이 있으면 그게 먼저라, 파일은 읽지 않아요.
  const own = usePicture(thing.id);
  const thumb = useThumb(self, own ? null : folder, thing);
  return (
    <button
      ref={self}
      type="button"
      title={thing.name}
      className={`lane-paper${stack ? " lane-stack" : ""}${selected && !picking ? " selected" : ""}${thing.missing ? " missing" : ""}${picking ? " picking" : ""}`}
      style={{ "--i": Math.min(order, 16), "--paper-scale": thing.scale ?? 1 } as CSSProperties}
      data-thing-id={thing.id}
      aria-pressed={picking ? picked : selected}
      disabled={picking && thing.missing}
      aria-label={`${thing.name}, ${kindLabels[thing.kind]}, ${formatBytes(thing.size)}${days !== null ? `, ${days}일째 그대로` : ""}${when ? `, ${when}` : ""}${thing.missing ? ", 파일 없음" : ""}${thing.pinned ? ", 고정됨" : ""}${stack ? `, 버전 ${stack.length}개 중 최신` : ""}`}
      aria-describedby="lanes-hint"
      onPointerEnter={(event) => cue(room.id, { look: centerOf(event.currentTarget) })}
      onPointerLeave={() => cue(room.id, { look: null })}
      onClick={() => (picking ? onPick?.(thing.id) : onSelect(thing.id))}
      onDoubleClick={() => !picking && onOpen(thing.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !selected || picking) return;
        event.preventDefault();
        onOpen(thing.id);
      }}
    >
      <span className="lane-art">
        {stack?.slice(1, 3).map((old, at) => (
          <span key={old.id} className={`lane-pile-under lane-pile-under-${at + 1}`} aria-hidden="true"><ObjectShape kind={old.kind} size={paperPx} seed={old.id} /></span>
        ))}
        <ObjectShape kind={thing.kind} size={paperPx} name={thing.name} seed={thing.id} picture={own ?? thumb} />
        {/* 고른 파일에는 연필로 동그라미를 칩니다. */}
        {selected && !picking && (
          <svg className="hand-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d="M20 12C42 0 82 2 94 30C104 58 84 92 50 96C18 100 0 74 4 44C7 24 26 6 60 5" />
          </svg>
        )}
      </span>
      <span className="lane-meta">
        {thing.pinned && <Icon name="pin" size={12} />}
        {stack && <b>버전 {stack.length}</b>}
        {days !== null && <b>{days}일째</b>}
        {when && <span>{when}</span>}
        {formatBytes(thing.size)}
        {thing.missing && <em>파일 없음</em>}
      </span>
    </button>
  );
}
