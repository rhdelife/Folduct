import { useRef } from "react";
import { useModal } from "./useModal";

// 웹에서 맥 앱 베타를 내려받는 창(2026-11-18 요청). DMG는 웹과 같이 Vercel에 올려요(public/downloads, git에는 넣지 않아요).
// 아직 Apple 공증 전이라 처음 열 때 한 번 허락하는 방법을 같이 적어요.
export const macDmg = { href: "/downloads/Folduct_0.1.0_aarch64.dmg", size: "7.9MB" };

export function MacDownloadDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog);
  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="mac-download-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="sheet-body mac-download">
        <h2 id="mac-download-title">맥 앱 내려받기 (베타)</h2>
        <p className="soft">Apple 칩(M1 이후) 맥, macOS 13 이상에서 돌아가요. 실제 폴더 정리와 플로팅 창은 맥 앱에서만 돼요.</p>
        <a className="button primary mac-download-get" href={macDmg.href} download>DMG 내려받기 ({macDmg.size})</a>
        <ol className="mac-download-steps">
          <li>받은 DMG를 열고 Folduct를 응용 프로그램 폴더로 끌어 놓아요.</li>
          <li>처음 열면 확인되지 않은 개발자라는 창이 떠요. 완료를 눌러 닫아요.</li>
          <li>시스템 설정 → 개인정보 보호 및 보안 맨 아래에서 Folduct 옆 ‘그래도 열기’를 누르고 다시 열어요.</li>
        </ol>
        <p className="soft">베타라 Apple 공증 전이에요. 정식 출시 때는 이 과정 없이 바로 열려요.</p>
        <div className="row end">
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </div>
    </dialog>
  );
}
