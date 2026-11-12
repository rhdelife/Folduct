import { useEffect, useRef, useState } from "react";
import { lookExpr, type FaceExpr } from "../art/duct";

// 프로도에게 보내는 신호. actor는 방 id, 플로팅 창의 "pet"입니다. 어디서 일어난 일이든 신호만 보내면 해당 프로도가 반응해요.
// 홈에 선 프로도 한 명. 홈의 방 신호는 모두 이 프로도에게 가요.
export const homeActor = "home-frodo";
export type BodyAct = "wave" | "hop" | "nod" | "tilt" | "stretch" | "rise" | "bye";
export type Point = { x: number; y: number };
export type Cue = { face?: FaceExpr; ms?: number; body?: BodyAct; look?: Point | null };

const bodyMs: Record<BodyAct, number> = { wave: 950, hop: 560, nod: 420, tilt: 720, stretch: 800, rise: 760, bye: 950 };
const lookDeadZone = 8;
const replayMs = 3000;

const listeners = new Map<string, Set<(cue: Cue) => void>>();
const waiting = new Map<string, { cue: Cue; at: number }>();

export function cue(actor: string, next: Cue) {
  const own = listeners.get(actor);
  if (own?.size) own.forEach((listen) => listen(next));
  // 새 방처럼 아직 그려지기 전에 보낸 신호는 잠깐 맡아 두었다가 전합니다.
  else waiting.set(actor, { cue: next, at: Date.now() });
}

export function onCue(actor: string, listen: (cue: Cue) => void) {
  const own = listeners.get(actor) ?? new Set();
  listeners.set(actor, own);
  own.add(listen);
  const held = waiting.get(actor);
  waiting.delete(actor);
  if (held && Date.now() - held.at < replayMs) listen(held.cue);
  return () => {
    own.delete(listen);
  };
}

export const centerOf = (el: Element): Point => {
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

// 눈을 깜빡이는 간격. 방마다 어긋나 한꺼번에 깜빡이지 않아요.
const blinkGap = () => 2600 + Math.random() * 4200;

export function useFrodo(actor: string | undefined, mood: FaceExpr) {
  const faceRef = useRef<Element | null>(null);
  const [flash, setFlash] = useState<FaceExpr | null>(null);
  const [look, setLook] = useState<FaceExpr | null>(null);
  const [blink, setBlink] = useState<FaceExpr | null>(null);
  const [body, setBody] = useState<BodyAct | null>(null);

  useEffect(() => {
    if (!actor) return;
    let faceTimer = 0;
    let bodyTimer = 0;
    const stop = onCue(actor, ({ face, ms = 700, body: act, look: at }) => {
      if (face) {
        setFlash(face);
        clearTimeout(faceTimer);
        faceTimer = window.setTimeout(() => setFlash(null), ms);
      }
      if (act) {
        setBody(act);
        clearTimeout(bodyTimer);
        bodyTimer = window.setTimeout(() => setBody(null), bodyMs[act]);
      }
      if (at === null) setLook(null);
      else if (at && faceRef.current) {
        const center = centerOf(faceRef.current);
        const [dx, dy] = [at.x - center.x, at.y - center.y];
        setLook(Math.hypot(dx, dy) < lookDeadZone ? null : lookExpr(dx, dy));
      }
    });
    return () => {
      stop();
      clearTimeout(faceTimer);
      clearTimeout(bodyTimer);
      // 타이머를 지웠으니 표정과 몸짓도 함께 거둡니다. 안 그러면 그 표정에 멈춰 있어요.
      setFlash(null);
      setBody(null);
    };
  }, [actor]);

  useEffect(() => {
    if (!actor) return;
    let timer = 0;
    const steps: [FaceExpr | null, number][] = [["blink", 70], ["shut", 90], ["blink", 70], [null, 0]];
    const run = (at: number) => {
      const [face, ms] = steps[at];
      setBlink(face);
      timer = window.setTimeout(() => (face ? run(at + 1) : run(0)), face ? ms : blinkGap());
    };
    timer = window.setTimeout(() => run(0), blinkGap());
    return () => clearTimeout(timer);
  }, [actor]);

  // 눈을 감거나 웃는 표정 위에 깜빡임을 얹으면 눈을 떴다 감는 것처럼 보여요. 눈 뜬 표정에서만 깜빡입니다.
  const steady = flash ?? look ?? mood;
  const open = steady !== "shut" && steady !== "sleepy" && steady !== "happy";
  return { faceRef, expr: (open ? blink : null) ?? steady, body };
}
