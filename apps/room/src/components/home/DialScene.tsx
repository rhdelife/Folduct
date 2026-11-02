import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { kindTones } from "../../art/palette";
import { kindParts, kindSummary, vaseBands } from "../../art/vases";
import { RoomFaceArt } from "../RoomFace";
import { relativeDay } from "../../domain/care";
import { dialRooms, type DialRoom } from "../../domain/home";
import { formatBytes } from "../../domain/model";
import { clampSpin, columnOrder, columnPose, dialPitch, dialPose, focusPose, mixPose, nameTop, onDial, recentWork, ringPose, dialAngle, roomFacts, vaseFill, dialGeometry, type DialGeometry } from "../../domain/dial";
import { roomMenuTriggers } from "../ContextMenu";
import { clamp01, cubicOut, lin, range, smooth, stops, useBetween, useEngine, useScene, useSceneGate, type SceneProps } from "./engine";

const rest = stops[3];
// 마지막 화병까지 다이얼에 내려앉는 자리. 여기서 한 번 쿵 찍습니다(시간은 CSS).
const landedAt = 4600;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const subscribeSize = (listener: () => void) => {
  addEventListener("resize", listener);
  return () => removeEventListener("resize", listener);
};
// useSyncExternalStore는 원시값을 비교하니 폭과 높이를 한 수에 담습니다.
const viewSize = () => innerWidth * 100000 + innerHeight;

// 화병 하나. 지도처럼 형식별로 차오릅니다. 완료한 방은 빈 점선 몸통과 글자로 말해요.
const DialFace = memo(function DialFace({ entry: { room, done, bytes } }: { entry: DialRoom }) {
  const bands = vaseBands(kindParts(room.things), vaseFill(room, bytes));
  return (
    <span className={`dial-face${done ? " is-done" : ""}`}>
      <RoomFaceArt face={room.face} roomId={room.id} bands={bands} className="dial-art" viewBox="-100 -102 200 204" glass="dial-glass" band="dial-vase-band" line="dial-vase-line" />
      <span className="dial-label">{room.name}</span>
      <span className="dial-denom">{formatBytes(bytes)}{done && <b> · 완료</b>}</span>
    </span>
  );
});

// 자세히 보기: 화병 둘레에 흩어진 종이들. 위치와 기울기는 CSS의 몫이에요.
function DialDetail({ entry, g, now, usageExact, onEnter, onMap, firstAction }: { entry: DialRoom; g: DialGeometry; now: number; usageExact: boolean; onEnter: () => void; onMap: () => void; firstAction: { current: HTMLButtonElement | null } }) {
  const { room, done, files, bytes } = entry;
  const facts = roomFacts(room);
  // 파일 수처럼 상자에 들어간 파일은 뺍니다. 용량에는 남아요, 디스크를 쓰니까요.
  const parts = kindParts(room.things.filter((thing) => !thing.box));
  const budget = room.budgetBytes;
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  // 1%가 안 되는 형식은 요약에서 뺍니다. "소리 0%"는 읽을 게 없어요.
  const summary = kindSummary(parts.filter((part) => part.size >= total / 100));
  const tones = (kind: keyof typeof kindTones) => ({ "--tone-pale": kindTones[kind].pale, "--tone-ink": kindTones[kind].ink }) as CSSProperties;
  const objectSize = g.width >= 170 ? [188, 128] : g.width >= 130 ? [124, 92] : [76, 64];
  const days = recentWork(room.workDays, now);
  const others = facts.latest && facts.latest.id !== facts.biggest?.id ? facts.latest : null;
  return (
    <>
      <div className="dial-info" style={{ top: nameTop(g) }}>
        <h2 className="dial-title" title={room.name}>{room.name}</h2>
        {done && <p className="dial-state">완료한 방이에요</p>}
        <div className="dial-actions">
          <button type="button" className="primary" ref={(el) => void (firstAction.current = el)} onClick={onEnter}>방에 들어가기</button>
          <button type="button" onClick={onMap}>지도에서 보기</button>
        </div>
      </div>
      <dl className="dial-papers">
        <div className="dial-card card-size" style={tones(facts.kind)}>
          <dt>용량</dt>
          <dd className="value">{usageExact ? "" : "최소 "}{formatBytes(bytes)}</dd>
          <dd>{budget ? `한도 ${formatBytes(budget)}의 ${Math.round((bytes / budget) * 100)}%` : "한도 미정"}</dd>
          {budget !== null && <dd className="dial-gauge" aria-hidden="true"><span style={{ width: `${Math.min(100, (bytes / budget) * 100)}%` }} /></dd>}
        </div>
        <div className="dial-card card-last" style={tones(facts.latest?.kind ?? "unknown")}>
          <dt>마지막 활동</dt>
          <dd className="value">{facts.lastAt ? relativeDay(facts.lastAt, now) : "기록 없음"}</dd>
          {facts.latest && <dd className="clip">{facts.latest.name}</dd>}
          <dd className="dial-days" aria-hidden="true">{days.map((worked, day) => <span key={day} data-worked={worked} />)}</dd>
          <dd className="dial-days-note">최근 {days.length}일 중 {days.filter(Boolean).length}일 썼어요</dd>
        </div>
        <div className="dial-card card-files">
          <dt>파일</dt>
          <dd className="value">{files}개</dd>
          {parts.length > 0 && (
            <>
              <dd className="dial-bar" aria-hidden="true">{parts.map((part) => <span key={part.label} style={{ flexGrow: part.size, background: part.color }} />)}</dd>
              <dd>{summary}</dd>
            </>
          )}
        </div>
      </dl>
      {facts.biggest && <div className="dial-card dial-object object-big" aria-hidden="true"><ObjectShape kind={facts.biggest.kind} size={objectSize[0]} name={facts.biggest.name} seed={facts.biggest.id} /></div>}
      {others && <div className="dial-card dial-object object-last" aria-hidden="true"><ObjectShape kind={others.kind} size={objectSize[1]} name={others.name} seed={others.id} /></div>}
    </>
  );
}

type Motion = { spin: number; lift: number; swap: number };
type Tween = { from: number; to: number; at: number; ms: number; ease: (u: number) => number };

// 방마다 화병 한 장을 큰 다이얼에 꽂습니다. 다이얼은 대부분 화면 밖이고, 끌면 돌아가요. 멈추면 그 자리에 섭니다(관성과 스냅 없음).
export function DialScene({ rooms, stats, now, returnTo, actions }: SceneProps) {
  const engine = useEngine();
  const gate = useSceneGate(3);
  const landed = useBetween(landedAt, Infinity);
  const entries = useMemo(() => dialRooms(rooms), [rooms]);
  const size = useSyncExternalStore(subscribeSize, viewSize);
  const g = useMemo(() => dialGeometry(Math.floor(size / 100000), size % 100000), [size]);
  const ids = entries.map((entry) => entry.room.id);
  const count = entries.length;

  const dial = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const parked = useRef(new WeakSet<HTMLElement>()).current;
  const firstAction = useRef<HTMLButtonElement | null>(null);
  // 프레임마다 바뀌는 값은 React 상태에 두지 않습니다.
  // 방에서 돌아오면 그 방 화병가 12시에 옵니다.
  const back = returnTo ? ids.indexOf(returnTo) : -1;
  const motion = useRef<Motion>({ spin: back < 0 ? 0 : clampSpin(-dialAngle(back, count, 0), count), lift: 0, swap: 1 }).current;
  const tweens = useRef(new Map<keyof Motion, Tween>()).current;
  const frame = useRef(0);
  const opened = useRef<{ id: string | null; focusId: string | null; prevId: string | null; at: number }>({ id: null, focusId: null, prevId: null, at: rest }).current;
  const drag = useRef<{ pointer: number; x: number; y: number; spin: number; rate: number; sign: number } | null>(null);
  const moved = useRef(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // 닫히며 사라지는 동안에도 내용이 남도록 마지막 방을 기억합니다.
  const [shownId, setShownId] = useState<string | null>(null);
  // 다이얼은 탭 한 번에 들어가고 안에서는 화살표로 움직입니다.
  const [tabStop, setTabStop] = useState(returnTo);

  const closeDial = (restoreFocus: boolean) => {
    const id = opened.id;
    if (id === null) return;
    opened.id = null;
    setOpenId(null);
    animate("lift", 0, 500, cubicOut, 100);
    const el = els.current[ids.indexOf(id)];
    if (el) el.style.willChange = "";
    if (restoreFocus) el?.focus({ preventScroll: true });
  };

  const write = (pos: number) => {
    dial.current!.style.opacity = String(range(pos, 4140, 4260));
    // 떠나면 닫습니다. 끝자리로 흘러오는 중에 연 건 그대로 둡니다.
    if (opened.id !== null && (pos > rest + 20 || pos < opened.at - 20 || !ids.includes(opened.id))) closeDial(false);
    motion.spin = clampSpin(motion.spin, count);
    const { spin, lift, swap } = motion;
    const angles = Array.from({ length: count }, (_, i) => dialAngle(i, count, spin));
    const order = pos > rest ? columnOrder(angles) : null;
    angles.forEach((angle, i) => {
      const el = els.current[i];
      if (!el) return;
      if (!onDial(angle)) {
        // 다이얼 밖 화병는 안 보이지만 화살표로는 닿습니다. 포커스가 오면 12시로 돌려요.
        if (!parked.has(el)) {
          parked.add(el);
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
          el.style.transform = `translate3d(0, ${g.center + g.radius}px, 0)`;
        }
        return;
      }
      if (parked.delete(el)) el.style.pointerEvents = "";
      const ringStep = Math.round(Math.abs(angle) / dialPitch);
      const start = 4164 + 16 * ringStep;
      let pose = dialPose(angle, g);
      const focus = ids[i] === opened.focusId ? swap : ids[i] === opened.prevId ? 1 - swap : 0;
      if (lift > 0) pose = mixPose(pose, mixPose(ringPose(angle, g), focusPose(g), focus), lift);
      if (order) {
        pose = mixPose(pose, columnPose(order[i], g), smooth(range(pos, rest + 23.33 * order[i], 5285)));
        pose.y -= 165 * g.vh * smooth(range(pos, 5285, 5425));
      } else {
        pose.y += 70 * g.vh * (1 - smooth(range(pos, start, start + 376)));
      }
      el.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.rot}deg) scale(${pose.scale})`;
      el.style.opacity = String(range(pos, start, start + 188) * (1 - 0.45 * lift * (1 - focus)));
    });
  };
  useScene(write);
  const paint = useRef(write);
  useLayoutEffect(() => {
    paint.current = write;
  });

  function tick(time: number) {
    frame.current = 0;
    for (const [key, tween] of tweens) {
      const u = clamp01((time - tween.at) / tween.ms);
      motion[key] = tween.from + (tween.to - tween.from) * tween.ease(u);
      if (u >= 1) tweens.delete(key);
    }
    paint.current(engine.pos);
    if (tweens.size > 0) {
      frame.current = requestAnimationFrame(tick);
      return;
    }
    settle();
  }

  // 움직임이 끝나면 커진 화병를 한 번 다시 그려 글자를 또렷하게 하고, 다 닫혔으면 겹침 순서를 돌려줍니다.
  function settle() {
    if (opened.id !== null) {
      const el = els.current[ids.indexOf(opened.id)];
      if (el) el.style.willChange = "auto";
    } else if (motion.lift === 0) {
      for (const el of els.current) if (el) el.style.zIndex = "";
    }
  }

  function animate(key: keyof Motion, to: number, ms: number, ease: Tween["ease"] = cubicOut, delay = 0) {
    if (reduced()) {
      motion[key] = to;
      tweens.delete(key);
      paint.current(engine.pos);
      settle();
      return;
    }
    tweens.set(key, { from: motion[key], to, at: performance.now() + delay, ms, ease });
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const spinToTop = (index: number, ms: (distance: number) => number, ease?: Tween["ease"]) => {
    const distance = dialAngle(index, count, motion.spin);
    if (Math.abs(distance) > 0.01) animate("spin", clampSpin(motion.spin - distance, count), ms(Math.abs(distance)), ease);
  };

  function openDial(id: string) {
    if (opened.id === id) {
      closeDial(true);
      return;
    }
    // 돌아오는 길(뒤로 가는 길)이거나 벌써 다음 장면으로 떠났으면 열지 않습니다.
    if (engine.pos < landedAt || engine.pos > rest + 20) return;
    const index = ids.indexOf(id);
    spinToTop(index, (distance) => 60 + distance * 0.8, lin);
    if (opened.id !== null) {
      const previous = els.current[ids.indexOf(opened.id)];
      if (previous) previous.style.willChange = "";
      opened.prevId = opened.id;
      motion.swap = 0;
      animate("swap", 1, 420);
    } else {
      opened.prevId = null;
      motion.swap = 1;
      animate("lift", 1, 520, cubicOut, 100);
    }
    opened.id = id;
    opened.focusId = id;
    opened.at = engine.pos;
    els.current.forEach((el, i) => {
      if (el) el.style.zIndex = ids[i] === id ? "3" : "";
    });
    setOpenId(id);
    setShownId(id);
  }

  // 키보드로 열어도 마우스로 열어도 포커스는 첫 버튼으로 갑니다. 닫으면 화병로 돌아와요.
  useEffect(() => {
    if (!openId) return;
    firstAction.current?.focus({ preventScroll: true });
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open], .context-menu")) closeDial(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId]);

  // 가로 휠과 가로 쓸기는 장면을 넘기지 않고 다이얼을 돌립니다. 엔진이 창에서 듣기 전에 가로챕니다.
  useEffect(() => {
    const el = dial.current!;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || opened.id !== null) return;
      event.stopPropagation();
      event.preventDefault();
      tweens.delete("spin");
      motion.spin = clampSpin(motion.spin - event.deltaX * 0.6, count);
      paint.current(engine.pos);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (drag.current?.sign) event.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [count, engine, motion, opened, tweens]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    moved.current = false;
    if (event.button !== 0 || opened.id !== null) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, spin: motion.spin, rate: event.pointerType === "touch" ? 1 : 0.4, sign: 0 };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held || held.pointer !== event.pointerId) return;
    const dx = event.clientX - held.x;
    if (!held.sign) {
      // 손가락이 세로로 먼저 움직이면 장면을 넘기는 몸짓입니다.
      if (event.pointerType === "touch" && Math.abs(event.clientY - held.y) > Math.max(5, Math.abs(dx))) {
        drag.current = null;
        return;
      }
      if (Math.abs(dx) > 2) moved.current = true;
      if (Math.abs(dx) <= 5) return;
      held.sign = Math.sign(dx);
      tweens.delete("spin");
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = "true";
    }
    motion.spin = clampSpin(held.spin + (dx - held.sign * 5) * held.rate, count);
    paint.current(engine.pos);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
  };

  // 끌고 난 뒤의 클릭은 버립니다. 키보드 클릭(detail 0)은 그대로예요.
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (moved.current && event.detail > 0) {
      event.stopPropagation();
      event.preventDefault();
    }
    moved.current = false;
  };
  const onDialClick = (event: MouseEvent<HTMLDivElement>) => {
    if (opened.id !== null && !(event.target as Element).closest(".dial-vase")) closeDial(true);
  };

  const onDialKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || opened.id !== null) return;
    event.preventDefault();
    const at = els.current.indexOf(document.activeElement as HTMLButtonElement);
    els.current[(at + (event.key === "ArrowRight" ? 1 : -1) + count) % count]?.focus({ preventScroll: true });
  };
  const onDialFocus = (event: FocusEvent<HTMLButtonElement>, index: number) => {
    setTabStop(ids[index]);
    if (opened.id === null && event.currentTarget.matches(":focus-visible")) spinToTop(index, () => 420);
  };

  const shown = entries.find((entry) => entry.room.id === shownId);
  return (
    <section className="scene scene-dial" aria-label="방 모음" data-open={openId !== null} style={{ "--dial-w": `${g.width}px`, "--dial-h": `${g.height}px` } as CSSProperties} {...gate}>
      <div
        className="dial-ring"
        ref={dial}
        role="group"
        aria-label={`방 화병 ${entries.length}개. 왼쪽, 오른쪽 화살표로 돌려요.`}
        data-landed={landed}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onClick={onDialClick}
        onKeyDown={onDialKey}
      >
        {entries.map((entry, index) => {
          const { room, done, files, bytes } = entry;
          return (
            <button
              key={room.id}
              type="button"
              className="dial-vase"
              ref={(el) => void (els.current[index] = el)}
              style={{ "--ring": Math.round(Math.abs(dialAngle(index, count, motion.spin)) / dialPitch) } as CSSProperties}
              aria-label={`${room.name} 방 화병, ${formatBytes(bytes)}, 파일 ${files}개${done ? ", 완료한 방" : ""}`}
              aria-expanded={openId === room.id}
              tabIndex={room.id === (openId ?? (tabStop !== null && ids.includes(tabStop) ? tabStop : ids[0])) ? 0 : -1}
              onClick={() => openDial(room.id)}
              onFocus={(event) => onDialFocus(event, index)}
              {...roomMenuTriggers(room.id, actions.roomMenu)}
            >
              <DialFace entry={entry} />
            </button>
          );
        })}
      </div>
      <div className="dial-detail" role="group" aria-label={shown ? `${shown.room.name} 방 자세히` : undefined}>
        {shown && (
          <DialDetail
            key={shown.room.id}
            entry={shown}
            g={g}
            now={now}
            usageExact={stats.get(shown.room.id)?.usage.exact ?? true}
            firstAction={firstAction}
            onEnter={() => actions.openRoom(shown.room.id)}
            onMap={() => actions.selectRoom(shown.room.id)}
          />
        )}
      </div>
    </section>
  );
}
