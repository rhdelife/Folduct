import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { captionWords } from "../../domain/home";
import type { Room } from "../../domain/model";
import { BrandMark } from "../Icon";
import { clamp01, liveScene, range, reduced, scenes, sheetLift, stops, useEngine, useLiveScene, useScene } from "./engine";

// 머리글. in은 앞으로 갈 때 나타나기 시작하는 자리, out은 다음 구간에서 위로 다 빠지는 자리,
// backIn·backOut은 뒤로 갈 때 나타나기 시작하고 사라지는 자리입니다(자리는 모두 pos, null이면 그쪽 움직임이 없어요).
export type Caption = { stop: number; in: number; out: number | null; backIn: number | null; backOut: number | null };
export const captions: (Caption & { title: string })[] = [
  { stop: stops[0], in: -1, out: 300, backIn: 300, backOut: null, title: "내 방" },
  { stop: stops[1], in: 1300, out: 1950, backIn: 2350, backOut: 750, title: "손댈 것" },
  { stop: stops[2], in: 2350, out: 3575, backIn: 3725, backOut: 2750, title: "방" },
  { stop: stops[3], in: 4300, out: 5110, backIn: 5250, backOut: 4660, title: "방 모음" },
  { stop: stops[4], in: 5250, out: null, backIn: null, backOut: 5390, title: "형식별" },
];

// 앞으로 갈 때는 멈출 자리에서 다 나타났다가 다음 구간 첫머리에 위로 빠지고, 뒤로 갈 때는 제자리에서 옅어졌다 나타납니다.
export type Pose = { opacity: number; rise: number };
export function captionPose({ stop, in: fadeIn, out, backIn, backOut }: Caption, pos: number, dir: number): Pose {
  if (dir < 0) {
    if (pos >= stop) return { opacity: backIn === null ? 1 : 1 - range(pos, stop, backIn), rise: 0 };
    return { opacity: backOut === null ? 1 : range(pos, backOut, stop), rise: 0 };
  }
  if (pos <= stop) return { opacity: range(pos, fadeIn, stop), rise: 0 };
  return { opacity: 1, rise: out === null ? 0 : range(pos, stop, out) };
}

// 이만큼 올라가면 화면 밖이라 보이지 않습니다.
const clearRise = 0.15;
const flipMs = 220;
const seen = ({ opacity, rise }: Pose): Pose => ({ opacity: opacity * (1 - clamp01(rise / clearRise)), rise: rise < clearRise ? rise : 0 });

// 앞뒤의 모습이 달라서, 가던 중에 방향을 뒤집으면 한 프레임에 튀어요. 멈춘 휠 틈에도 이어지도록 pos가 아니라 시계로,
// 그 순간 눈에 보이던 모습에서 새 모습까지 잠깐 잇습니다. 화면 밖으로 나간 줄은 미끄러져 돌아오지 않고 제자리에서 나타나요.
export function captionStepper(list: Caption[]) {
  let shown: Pose[] | null = null;
  let lastDir = 0;
  let flip: { start: number; from: Pose[] } | null = null;
  return (pos: number, dir: number, now: number, ms = flipMs): { poses: Pose[]; blending: boolean } => {
    if (shown && lastDir && dir && dir !== lastDir) flip = { start: now, from: shown.map(seen) };
    lastDir = dir || lastDir;
    const t = flip && now - flip.start < ms ? (now - flip.start) / ms : 1;
    if (t === 1) flip = null;
    const from = flip?.from;
    shown = list.map((caption, index) => {
      const to = captionPose(caption, pos, dir);
      if (!from) return to;
      const end = seen(to);
      return { opacity: from[index].opacity + (end.opacity - from[index].opacity) * t, rise: from[index].rise + (end.rise - from[index].rise) * t };
    });
    return { poses: shown, blending: from !== undefined };
  };
}

export function HomeHeader({ rooms, now, ready, canTravel, overdue, onMenu, onNew }: { rooms: Room[]; now: number; ready: boolean; canTravel: boolean; overdue: boolean; onMenu: () => void; onNew: () => void }) {
  const engine = useEngine();
  const words = useMemo(() => captionWords(rooms, now), [rooms, now]);
  const [stepCaptions] = useState(() => captionStepper(captions));
  const box = useRef<HTMLDivElement>(null);
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const awake = rooms.length > 0;
  const live = useLiveScene();
  // 지나치는 장면은 읽지 않고 닿을 장면만 한 번 알립니다.
  const heading = useSyncExternalStore(engine.subscribe, () => liveScene(engine.target));

  const blend = useRef(0);

  function write(pos: number) {
    box.current!.style.transform = `translate3d(0, ${sheetLift(pos)}dvh, 0)`;
    const { poses, blending } = stepCaptions(pos, engine.dir, performance.now(), reduced() ? 0 : undefined);
    poses.forEach(({ opacity, rise }, index) => {
      const layer = layers.current[index]!;
      layer.style.opacity = String(opacity);
      layer.style.transform = `translate3d(0, ${-100 * rise}dvh, 0)`;
    });
    // 휠이 잠깐 멈춘 사이에도 이어지도록 잇는 동안만 스스로 프레임을 돕니다.
    if (blending && !blend.current) {
      blend.current = requestAnimationFrame(() => {
        blend.current = 0;
        if (box.current) write(engine.pos);
      });
    }
  }
  useScene(write);

  return (
    <header className={`home-header${awake ? " has-caption" : ""}`}>
      <div className="home-brand">
        <BrandMark size={32} />
        <h1 className="sr-only">Folduct</h1>
      </div>
      <div className={`home-caption${awake ? " visible" : ""}`} ref={box} aria-hidden="true">
        {captions.map((caption, index) => (
          <div key={caption.stop} className="caption-layer" ref={(el) => void (layers.current[index] = el)}>
            <strong>{caption.title}</strong>
            <span>{words[index]}</span>
          </div>
        ))}
      </div>
      <div className="home-actions">
        <button type="button" className="quiet" aria-haspopup="dialog" disabled={!ready} onClick={onMenu}>
          메뉴{overdue && <b> 정리할 때예요</b>}
        </button>
        <button type="button" className="quiet" onClick={onNew}>+ 새 방</button>
      </div>
      {/* 키보드와 화면 읽기 프로그램의 지름길. 포커스가 들어올 때만 보입니다. 잠긴 장면은 읽히지 않으니 여기서 옮겨 갑니다. */}
      {canTravel && (
        <nav className="scene-nav" aria-label="화면 옮기기">
          {scenes.map((scene, index) => (
            <button key={scene.name} type="button" className="quiet" aria-current={live === index ? "true" : undefined} onClick={() => engine.goTo(index)}>{scene.label}</button>
          ))}
        </nav>
      )}
      <p className="sr-only" role="status">{scenes[heading].label}</p>
    </header>
  );
}
