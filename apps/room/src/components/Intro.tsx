/// <reference types="vite/client" />
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { eatFrameCount, kindParts } from "../art/duct";
import eatSheet from "../art/duct-eat.png";
import { eatKeyframes, eatTimeline, introMs, introPapers, introThings } from "../domain/intro";
import type { Thing } from "../domain/model";
import { listRooms } from "../storage/db";
import { sampleRooms } from "../storage/sample";
import { PoseArt } from "./RoomFace";

type Phase = "scatter" | "gather" | "fill";

const copy: Record<Phase, string> = {
  scatter: "파일이 흩어져 있어요.",
  gather: "하나씩 꿀꺽 삼켜요.",
  fill: "색은 형식, 길이는 용량이에요.",
};
// 세 칸 진행 막대: 흩어짐 → 삼킴 → 색.
const stepOf: Record<Phase, number> = { scatter: 1, gather: 2, fill: 3 };
// 그림이 차지하는 폭. 화면마다 달라 선 굵기가 무난한 값으로 둡니다.
const introPx = 240;
// 환경설정의 다시 보기가 보내고 App이 받습니다. 환경설정은 집 안에 있어 App까지 이벤트로 알려요.
export const replayIntroEvent = "folduct-replay-intro";

// 앱을 켤 때 한 번, 흩어진 파일을 주름관이 다 받아먹으면 화면이 그대로 집으로 디졸브돼요. onLeave부터 집이 아래에 깔리고, onDone에 걷힙니다.
export function Intro({ leaving, onLeave, onDone }: { leaving: boolean; onLeave: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("scatter");
  const [things, setThings] = useState<Thing[] | null>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const sprite = useRef<HTMLImageElement>(null);

  useEffect(() => {
    document.title = "Folduct";
    // 저장소를 못 읽어도 인트로는 샘플로 보여 주고, 오류 안내는 집 화면에 맡깁니다.
    listRooms().catch((error: unknown) => {
      console.error(error);
      return [];
    }).then((rooms) => setThings(introThings(rooms, sampleRooms())));
  }, []);

  useEffect(() => {
    if (leaving) {
      const timer = setTimeout(onDone, introMs.leave);
      return () => clearTimeout(timer);
    }
    if (phase === "scatter") return;
    const timer = setTimeout(() => (phase === "fill" ? onLeave() : setPhase("fill")), introMs[phase]);
    return () => clearTimeout(timer);
  }, [phase, leaving, onLeave, onDone]);

  useEffect(() => {
    if (phase !== "gather" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const play = sprite.current?.animate(eatKeyframes(eatTimeline, eatFrameCount), { duration: introMs.gather, fill: "forwards" });
    // 입 모양이 종이와 어긋나지 않게 첫 종이가 실제로 움직이기 시작한 시각에 맞춥니다.
    const paper = document.querySelector(".intro-paper")?.getAnimations()[0];
    paper?.ready.then(() => { if (play) play.startTime = paper.startTime; }).catch(() => undefined);
    return () => play?.cancel();
  }, [phase]);

  useEffect(() => {
    if (leaving) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onLeave();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [leaving, onLeave]);

  const papers = useMemo(() => introPapers(things ?? []), [things]);
  const parts = useMemo(() => kindParts(things ?? []), [things]);

  return (
    <section className={`intro phase-${phase}${leaving ? " leaving" : ""}`} aria-label="Folduct 인트로" aria-hidden={leaving || undefined}>
      {things && (
        <>
          <div className="intro-papers" aria-hidden="true">
            {papers.map((paper, index) => (
              <div key={paper.id} className="intro-paper" style={{ "--x": paper.x, "--y": paper.y, "--rot": `${paper.rot}deg`, "--i": index } as CSSProperties}>
                <div className="intro-paper-art">
                  <ObjectShape kind={paper.kind} size={paper.size} name={paper.name} seed={paper.id} />
                </div>
              </div>
            ))}
          </div>
          <div className="intro-center">
            <div className="intro-vase-lift">
              <div className="intro-vase">
                {/* 먹는 동안만 시트를 보여 줍니다. 미리 올려 풀어 두어 시작할 때 멈칫하지 않아요. */}
                <div className="intro-sprite" aria-hidden="true">
                  <img ref={sprite} src={eatSheet} alt="" style={{ width: `${eatFrameCount * 100}%` }} onLoad={(event) => void event.currentTarget.decode().catch(() => undefined)} />
                </div>
                <PoseArt pose="idle" parts={phase === "scatter" || phase === "gather" ? [] : parts} px={introPx} band="intro-band" className="vase-art" />
              </div>
            </div>
            <div className="intro-foot">
              <ol className="intro-steps" aria-hidden="true">
                {[1, 2, 3].map((step) => <li key={step} className={step <= stepOf[phase] ? "on" : undefined} />)}
              </ol>
              <p className="intro-copy" role="status"><span key={phase}>{copy[phase]}</span></p>
              {phase === "scatter" && (
                <button
                  type="button"
                  className="primary big"
                  autoFocus
                  onClick={(event) => {
                    setPhase("gather");
                    // 키보드로 눌렀으면(detail 0) 버튼이 사라져도 자리를 잃지 않게 건너뛰기로 옮깁니다. 마우스에는 포커스 테두리가 방해만 돼요.
                    if (event.detail === 0) skip.current?.focus();
                  }}
                >
                  정리 시작
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {!leaving && <button ref={skip} type="button" className="quiet intro-skip" onClick={onLeave}>건너뛰기</button>}
    </section>
  );
}
