import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { kindParts } from "../art/duct";
import { introMs, introPapers, introThings } from "../domain/intro";
import type { Thing } from "../domain/model";
import { listRooms } from "../storage/db";
import { sampleRooms } from "../storage/sample";
import { PoseArt } from "./RoomFace";

type Phase = "scatter" | "gather" | "fill" | "rise";

const copy: Record<Phase, string> = {
  scatter: "파일이 흩어져 있어요.",
  gather: "하나씩 주름관에 담아요.",
  fill: "색은 형식, 길이는 용량이에요.",
  rise: "이제 방으로 가요.",
};
const nextPhase = { gather: "fill", fill: "rise" } as const;
// 그림이 차지하는 폭. 화면마다 달라 선 굵기가 무난한 값으로 둡니다.
const introPx = 240;

// 앱을 켤 때 한 번, 흩어진 파일을 주름관 입에 담고 집 화면으로 들어갑니다. onLeave부터 집이 아래에 깔리고, onDone에 걷힙니다.
export function Intro({ leaving, onLeave, onDone }: { leaving: boolean; onLeave: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("scatter");
  const [things, setThings] = useState<Thing[] | null>(null);
  const skip = useRef<HTMLButtonElement>(null);

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
    const timer = setTimeout(() => (phase === "rise" ? onLeave() : setPhase(nextPhase[phase])), introMs[phase]);
    return () => clearTimeout(timer);
  }, [phase, leaving, onLeave, onDone]);

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
                <PoseArt pose={phase === "rise" ? "done" : "idle"} parts={phase === "scatter" || phase === "gather" ? [] : parts} px={introPx} band="intro-band" className="vase-art" />
              </div>
            </div>
            <div className="intro-foot">
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
