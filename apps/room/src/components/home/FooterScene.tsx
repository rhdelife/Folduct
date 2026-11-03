import type { ReactNode } from "react";
import { version } from "../../../package.json";
import { vasePaths } from "../../art/vases";
import { BrandMark } from "../Icon";
import { useEngine, useSceneGate, type SceneProps } from "./engine";

// 로고에 글자를 붙이지 않으니 큰 글자 대신 화병 한 줄을 세웁니다. 글자 줄처럼 키가 들쭉날쭉하고 밑동은 창 아래로 잘려요.
// [모양, 가운데 x, 세로 배율]. 옆 배율은 모두 같습니다.
const giantWide = 1.2;
const giantFloor = 360;
const giants: [number, number, number][] = [
  [2, 83, 1.8],
  [3, 255, 1.35],
  [7, 457, 1.35],
  [0, 636, 1.72],
  [6, 771, 1.8],
  [5, 925, 1.35],
  [1, 1111, 1.4],
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="footer-group">
      <h2 className="footer-head">{title}</h2>
      <ul className="footer-links">{children}</ul>
    </div>
  );
}

function Link({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  // 두 번 눌러도 한 번입니다. 샘플 치우기는 같은 자리가 곧장 샘플 띄우기로 바뀌어요. 키보드는 detail이 0입니다.
  return <li><button type="button" onClick={(event) => { if (event.detail < 2) onClick(); }}>{children}</button></li>;
}

// 판이 들리면 그 아래에서 드러납니다. 판 밖 층이라 스스로는 움직이지 않아요.
export function FooterScene({ rooms, actions }: SceneProps) {
  const gate = useSceneGate(4);
  const engine = useEngine();
  const toTop = () => {
    engine.goTo(0);
    // 누른 버튼이 곧 잠겨 포커스가 갈 곳을 잃으니, 어느 장면에서나 살아 있는 머리로 옮깁니다.
    document.querySelector<HTMLElement>(".home-actions button")?.focus();
  };
  return (
    <section className="scene scene-footer" aria-label="맨 아래" {...gate}>
      <div className="footer-columns">
        <Group title="정리">
          <Link onClick={actions.openWeekly}>주간 정리</Link>
          {actions.importList && <Link onClick={actions.importList}>목록 파일 가져오기</Link>}
          {rooms.some((room) => room.source === "sample") ? <Link onClick={actions.clearSamples}>샘플 방 치우기</Link> : <Link onClick={actions.addSample}>샘플 방 구경하기</Link>}
        </Group>
        <Group title="방">
          <Link onClick={actions.openNew}>+ 새 방</Link>
          <Link onClick={actions.openMenu}>메뉴</Link>
          <Link onClick={toTop}>첫 화면으로</Link>
        </Group>
        <Group title="Folduct">
          <li className="footer-version">버전 {version}</li>
        </Group>
        <div className="footer-group footer-last">
          <button type="button" className="footer-top" onClick={toTop}>
            맨 위로
            <BrandMark size={44} />
          </button>
        </div>
      </div>
      <svg className="footer-giants" viewBox="0 0 1190 320" aria-hidden="true" focusable="false">
        {giants.map(([shape, x, tall]) => (
          <path key={shape} d={vasePaths[shape]} transform={`translate(${x} ${giantFloor - 100 * tall}) scale(${giantWide} ${tall})`} />
        ))}
      </svg>
    </section>
  );
}
