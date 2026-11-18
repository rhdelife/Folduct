import { BrandMark } from "../components/Icon";
import { macDmg } from "../components/MacDownloadDialog";

// 소개·내려받기 페이지. 맨 위에 내려받기, 그 아래 기능·안전·처음 여는 법·자주 묻는 질문, 맨 아래 GitHub.
const github = "https://github.com/rhdelife/Folduct";
const system = "macOS 13 이상 · Apple 실리콘 Mac · 베타";

const features = [
  { img: "home", title: "방 하나 = 프로도 하나", text: "작업 폴더마다 방이 생겨요. 방 카드를 프로도에게 먹이면 그 방 용량만큼 몸이 늘고, 파일 형식 색이 받침부터 차올라요." },
  { img: "sweep", title: "한 주에 한 번, 같이 치워요", text: "오래 안 쓴 파일을 일주일에 한 번 보여 줘요. 고른 것만 방 안 정리 상자로 옮기고, 언제든 제자리로 돌려요." },
  { img: "drawer", title: "형식별 서랍장", text: "모든 방의 파일을 이미지·영상·문서 같은 형식별 서랍으로 모아 봐요. 어느 방에 뒀는지 몰라도 찾을 수 있어요." },
];

const steps = [
  { title: "방 만들기", text: "폴더 이름으로 찾거나 최근 폴더에서 골라요. 폴더 하나가 방 하나예요." },
  { title: "작업 시작", text: "작업할 방을 고르고 시작하면 시간이 쌓여요." },
  { title: "새 파일은 알아서", text: "작업 중에 다운로드 폴더에 들어온 파일을 묻지 않고 지금 방으로 옮겨요." },
  { title: "필요한 것만 판에", text: "방 안 빈 판에 필요한 파일만 꺼내 놓고 끌어서 정리해요." },
];

const safety = [
  { title: "지우지 않아요", text: "영구 삭제 기능이 없어요. 휴지통으로 보내기도 확인 창에서 허락한 파일 하나씩만이에요." },
  { title: "모든 이동은 되돌려요", text: "자동으로 옮긴 파일, 정리 상자에 넣은 파일 모두 알림의 되돌리기로 제자리에 돌아가요." },
  { title: "서버가 없어요", text: "방과 기록은 내 Mac에만 저장해요. 파일 요약은 직접 넣은 Claude 키로 켰을 때만 그 파일을 보내요." },
];

const faq = [
  { q: "Folduct는 어떤 앱인가요?", a: "작업 폴더마다 방을 하나 두고, 새로 받은 파일은 작업 중인 방으로, 오래 안 쓴 파일은 방 안 정리 상자로 옮겨 주는 macOS 앱이에요. 색은 파일 형식, 크기와 길이는 용량이라 그림만 봐도 어디에 무엇이 쌓였는지 알 수 있어요." },
  { q: "어떤 Mac에서 쓸 수 있나요?", a: "지금 베타는 macOS 13 이상의 Apple 실리콘(M1 이후) Mac용이에요. 인텔 Mac과 Windows는 준비 중이에요." },
  { q: "처음 열 때 경고가 떠요.", a: "베타라 아직 Apple 공증 전이에요. 경고 창은 완료로 닫고, 시스템 설정 → 개인정보 보호 및 보안 맨 아래에서 Folduct 옆 ‘그래도 열기’를 누른 뒤 다시 열어 주세요." },
  { q: "제 파일을 함부로 옮기거나 지우지 않나요?", a: "옮기는 일은 정해진 경우뿐이에요. 작업 중에 새로 들어온 파일을 그 방으로, 고른 파일을 정리 상자로, 고른 파일을 다른 방으로. 모두 되돌릴 수 있고, 같은 이름이 있으면 덮어쓰지 않아요." },
  { q: "웹 체험판과 무엇이 다른가요?", a: "웹에서는 샘플 방으로 화면과 흐름을 볼 수 있어요. 실제 폴더 읽기·옮기기, 작업 시간 재기, 플로팅 창은 맥 앱에서만 돼요." },
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
          <p className="dl-lede">작업 폴더마다 방이 하나 생겨요. Folduct가 새로 받은 파일은 지금 작업 중인 방으로, 오래 안 쓴 파일은 방 안 정리 상자로 옮겨요.</p>
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
          <p className="dl-sub">색은 파일 형식, 크기와 길이는 용량. 방을 열지 않아도 어디에 무엇이 쌓였는지 보여요.</p>
          <div className="dl-features">
            {features.map((item) => (
              <article key={item.img} className="dl-feature">
                <figure className="dl-window">
                  <span className="dl-window-bar" aria-hidden="true"><i /><i /><i /></span>
                  <img src={`/download/${item.img}.jpg`} alt="" width={1600} height={1000} loading="lazy" />
                </figure>
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
