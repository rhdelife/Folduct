import { useRef, useState } from "react";
import { BrandMark } from "../components/Icon";
import { assetBase, macDmg } from "../components/MacDownloadDialog";

// 소개·내려받기 페이지. 맨 위에 내려받기, 그 아래 기능·안전·처음 여는 법·자주 묻는 질문, 맨 아래 GitHub.
const github = "https://github.com/rhdelife/Folduct";
const system = "macOS 13 이상 · Apple 실리콘 · 베타";

const features = [
  { img: "feed", still: "feed", title: "방 하나 = 프로도 하나", text: "방을 프로도에게 먹이면 몸이 늘고, 그 방 파일을 보여 줘요." },
  { img: "review", still: "review", title: "Review로 정리", text: "안 쓴 파일을 골라 정리 상자로 옮겨요. 언제든 되돌릴 수 있어요." },
  { img: "drawer", still: "drawer-still", title: "형식별 서랍장", text: "모든 방의 파일을 형식별로 모아 봐요." },
];

const steps = [
  { title: "방 만들기", text: "폴더 이름으로 찾아 골라요." },
  { title: "작업 시작", text: "시작하면 시간이 쌓여요." },
  { title: "자동 이동", text: "작업 중 받은 파일은 그 방으로 가요." },
  { title: "방 캔버스", text: "필요한 파일만 꺼내 놓아요." },
];

const safety = [
  { title: "지우지 않아요", text: "휴지통도 확인한 파일만 보내요." },
  { title: "되돌릴 수 있어요", text: "옮긴 파일은 언제든 제자리로 돌아가요." },
  { title: "내 기기에만 저장해요", text: "서버가 없어요." },
];

const faq = [
  { q: "Folduct는 어떤 앱인가요?", a: "작업 폴더를 방으로 보여 주고, 새 파일은 작업 중인 방으로, 안 쓴 파일은 정리 상자로 옮겨 주는 macOS 앱이에요." },
  { q: "어떤 Mac에서 쓸 수 있나요?", a: "macOS 13 이상, Apple 실리콘 Mac이에요. 인텔 Mac과 Windows는 준비 중이에요." },
  { q: "처음 열 때 경고가 떠요.", a: "베타라 아직 공증 전이에요. 시스템 설정의 개인정보 보호 및 보안에서 ‘그래도 열기’를 눌러 주세요." },
  { q: "파일을 함부로 옮기거나 지우지 않나요?", a: "지우지 않아요. 옮긴 파일은 모두 되돌릴 수 있고, 같은 이름은 덮어쓰지 않아요." },
  { q: "웹 체험판과 무엇이 다른가요?", a: "웹에서는 샘플 방으로 둘러볼 수 있어요. 실제 폴더 정리와 작업 시간은 맥 앱에서만 돼요." },
];

export function DownloadPage() {
  const get = (
    <a className="button primary dl-get" href={macDmg.href} download>
      macOS용 내려받기
    </a>
  );
  return (
    <div className="dl">
      <header className="dl-top">
        <a className="dl-brand" href="/download" aria-label="Folduct">
          <BrandMark size={32} />
          <b>Folduct</b>
        </a>
        <nav className="dl-nav" aria-label="페이지 안">
          <a href="#features">기능</a>
          <a href="#safety">안전</a>
          <a href="#faq">자주 묻는 질문</a>
          <a href={github} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <a className="button dl-try" href="/">웹에서 써 보기</a>
      </header>

      <main>
        <section className="dl-hero" aria-labelledby="dl-title">
          <h1 id="dl-title">새 파일은 제자리로,<br />안 쓰는 파일은 상자로.</h1>
          <p className="dl-lede">작업 폴더마다 방이 하나 생겨요. 새 파일은 작업 중인 방으로, 안 쓴 파일은 정리 상자로 옮겨요.</p>
          <div className="dl-actions">
            {get}
            <a className="button dl-secondary" href="/">웹에서 먼저 써 보기</a>
          </div>
          <p className="dl-system">{system} · {macDmg.size}</p>
          <figure className="dl-window">
            <span className="dl-window-bar" aria-hidden="true"><i /><i /><i /></span>
            <img src="/download/intro.jpg" alt="흩어진 파일 오브제 가운데 선 프로도, Folduct 첫 화면" width={1600} height={1000} />
          </figure>
        </section>

        <section id="features" className="dl-section" aria-labelledby="dl-features">
          <h2 id="dl-features">그림이 곧 정보예요</h2>
          <p className="dl-sub">색은 파일 형식, 크기는 용량이에요.</p>
          <div className="dl-features">
            {features.map((item) => (
              <article key={item.img} className="dl-feature">
                <HoverGif still={`${assetBase}/download/${item.still}.jpg`} gif={`${assetBase}/download/${item.img}.gif`} label={item.title} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
          <ol className="dl-steps">
            {steps.map((step, at) => (
              <li key={step.title}>
                <span aria-hidden="true">{at + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="safety" className="dl-section" aria-labelledby="dl-safety">
          <h2 id="dl-safety">파일은 내 것 그대로예요</h2>
          <div className="dl-cards">
            {safety.map((item) => (
              <article key={item.title} className="dl-card">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="faq" className="dl-section" aria-labelledby="dl-faq">
          <h2 id="dl-faq">자주 묻는 질문</h2>
          <div className="dl-faq">
            {faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="dl-section dl-end" aria-labelledby="dl-end">
          <BrandMark size={72} />
          <h2 id="dl-end">지금 Folduct를 써 보세요</h2>
          {get}
          <p className="dl-system">{system}</p>
        </section>
      </main>

      <footer className="dl-foot">
        <span>© 2026 Folduct</span>
        <a href="/">웹 체험판</a>
        <a href={github} target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}

// 기능 화면: 평소엔 멈춘 장면, 마우스를 올리거나(키보드 포커스·누르기도) 하면 녹화한 GIF가 처음부터 재생돼요(2026-11-18 요청).
// GIF는 한 번만 받아 두고, 재생할 때마다 새 주소(blob URL)를 만들어 처음부터 다시 돌게 해요.
function HoverGif({ still, gif, label }: { still: string; gif: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const blob = useRef<Promise<Blob> | null>(null);
  const shown = useRef<string | null>(null);
  const play = () => {
    blob.current ??= fetch(gif).then((res) => res.blob());
    void blob.current.then((data) => {
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = URL.createObjectURL(data);
      setSrc(shown.current);
    }, () => setSrc(gif));
  };
  const stop = () => {
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = null;
    setSrc(null);
  };
  return (
    <figure
      className={`dl-window dl-gif${src ? " playing" : ""}`}
      tabIndex={0}
      aria-label={`${label} 화면. 올리거나 누르면 움직여요`}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={stop}
      onClick={() => (src ? stop() : play())}
    >
      <span className="dl-window-bar" aria-hidden="true"><i /><i /><i /></span>
      <img src={src ?? still} alt="" width={1600} height={1000} loading="lazy" />
      <span className="dl-gif-badge" aria-hidden="true">▶</span>
    </figure>
  );
}
