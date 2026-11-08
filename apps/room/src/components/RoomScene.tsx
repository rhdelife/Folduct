import { useState, type CSSProperties } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { boxColor, tonesFrom } from "../art/palette";
import { laneOf, lanes, thingAge, type Lane } from "../domain/care";
import { formatBytes, kindLabels, type Room, type Thing } from "../domain/model";
import { Icon } from "./Icon";
import { centerOf, cue } from "./useFrodo";

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
const paperPx = 80;
// 줄마다 처음엔 큰 파일부터 이만큼만, 더 보기를 누르면 shownMost개까지 그립니다(파일 수백 개짜리 폴더).
const shownAtFirst = 24;
const shownMost = 200;

// 방 안: 파일이 왼쪽에서 오른쪽(좁으면 위에서 아래)으로 흐르는 네 줄. 자리가 곧 상태라서 색 없이 자리·글자·모양으로 말합니다.
export function RoomScene({ room, now, selectedId, onSelect, onOpen }: { room: Room; now: number; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void }) {
  const [opened, setOpened] = useState<Lane[]>([]);
  const groups = lanes.map((lane) => ({ lane, things: room.things.filter((thing) => laneOf(thing, room, now) === lane).sort((a, b) => b.size - a.size) }));
  const titles: Record<Lane, [title: string, note: string, empty: string]> = {
    new: ["새로 왔어요", "방을 만든 뒤 들어온 파일이에요.", "새 파일이 없어요."],
    use: ["요즘 써요", "고정한 파일도 여기 머물러요.", "요즘 쓴 파일이 없어요."],
    quiet: ["잠잠해요", `${room.care.staleAfterDays}일 넘게 안 썼어요. 주간 정리 때 물어볼게요.`, "오래 쉰 파일이 없어요."],
    box: ["정리 상자", "지우지 않아요. 언제든 제자리로 돌릴 수 있어요.", "상자가 비어 있어요."],
  };
  return (
    <div className="lanes">
      <p id="lanes-hint" className="sr-only">누르면 고르고, 고른 파일에서 Enter를 한 번 더 누르면 열어요.</p>
      {groups.map(({ lane, things }) => {
        const [title, note, empty] = titles[lane];
        const shown = things.slice(0, opened.includes(lane) ? shownMost : shownAtFirst);
        return (
          <section key={lane} className={`lane lane-${lane}`} aria-labelledby={`lane-${lane}`}>
            <div className="lane-head">
              {lane === "box" && <span className="lane-box-art"><CardboardBox things={things} /></span>}
              <h2 id={`lane-${lane}`}>{title} <span className="lane-count">{things.length}</span></h2>
              <p>{things.length ? note : empty}</p>
            </div>
            {shown.length > 0 && (
              <ul className="lane-things">
                {shown.map((thing, order) => (
                  <li key={thing.id}>
                    <LanePaper room={room} thing={thing} lane={lane} now={now} order={order} selected={thing.id === selectedId} onSelect={onSelect} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            )}
            {things.length > shown.length &&
              (opened.includes(lane) ? (
                <p className="lane-more">큰 파일 {shownMost}개까지만 보여요.</p>
              ) : (
                <button type="button" className="lane-more" onClick={() => setOpened([...opened, lane])}>나머지 {(things.length - shown.length).toLocaleString("ko-KR")}개도 보기</button>
              ))}
          </section>
        );
      })}
    </div>
  );
}

function LanePaper({ room, thing, lane, now, order, selected, onSelect, onOpen }: { room: Room; thing: Thing; lane: Lane; now: number; order: number; selected: boolean; onSelect: (id: string) => void; onOpen: (id: string) => void }) {
  const days = lane === "quiet" ? thingAge(thing, room.care, room.workDays, now).days : null;
  return (
    <button
      type="button"
      className={`lane-paper${selected ? " selected" : ""}${thing.missing ? " missing" : ""}`}
      style={{ "--i": Math.min(order, 16) } as CSSProperties}
      data-thing-id={thing.id}
      aria-pressed={selected}
      aria-label={`${thing.name}, ${kindLabels[thing.kind]}, ${formatBytes(thing.size)}${days !== null ? `, ${days}일째 그대로` : ""}${thing.missing ? ", 파일 없음" : ""}${thing.pinned ? ", 고정됨" : ""}`}
      aria-describedby="lanes-hint"
      onPointerEnter={(event) => cue(room.id, { look: centerOf(event.currentTarget) })}
      onPointerLeave={() => cue(room.id, { look: null })}
      onClick={() => onSelect(thing.id)}
      onDoubleClick={() => onOpen(thing.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !selected) return;
        event.preventDefault();
        onOpen(thing.id);
      }}
    >
      <span className="lane-art">
        <ObjectShape kind={thing.kind} size={paperPx} name={thing.name} seed={thing.id} />
        {/* 고른 파일에는 연필로 동그라미를 칩니다. */}
        {selected && (
          <svg className="hand-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d="M20 12C42 0 82 2 94 30C104 58 84 92 50 96C18 100 0 74 4 44C7 24 26 6 60 5" />
          </svg>
        )}
      </span>
      <span className="lane-meta">
        {thing.pinned && <Icon name="pin" size={12} />}
        {days !== null && <b>{days}일</b>}
        {formatBytes(thing.size)}
        {thing.missing && <em>파일 없음</em>}
      </span>
    </button>
  );
}
