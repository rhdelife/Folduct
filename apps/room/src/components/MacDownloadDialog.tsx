import { useRef } from "react";
import { useModal } from "./useModal";

// 웹에서 맥 앱 베타를 내려받는 창(2026-11-18 요청).
// 아직 Apple 공증 전이라 처음 열 때 한 번 허락하는 방법을 같이 적어요.
// 큰 파일(DMG·기능 GIF)은 git과 사이트 묶음에 넣지 않고 Vercel Blob 저장소(folduct-files)에 둬요(2026-11-18 요청).
// 새 DMG는 `vercel blob put <파일> --pathname downloads/<이름> --force`로 올리고 아래 이름을 바꿔요.
export const assetBase = "https://x1ohqilcmrwtpwlp.public.blob.vercel-storage.com";
export const macDmg = { href: `${assetBase}/downloads/Folduct_0.1.0_aarch64.dmg`, size: "7.9MB" };

export function MacDownloadDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog);
  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="mac-download-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="sheet-body mac-download">
        <h2 id="mac-download-title">맥 앱 내려받기 (베타)</h2>
        <p className="soft">macOS 13 이상, Apple 실리콘 Mac에서 돌아가요.</p>
        <a className="button primary mac-download-get" href={macDmg.href} download>DMG 내려받기 ({macDmg.size})</a>
        <ol className="mac-download-steps">
          <li>받은 DMG를 열고 Folduct를 응용 프로그램 폴더로 끌어 놓아요.</li>
          <li>처음 열 때 뜨는 경고 창은 닫아요.</li>
          <li>시스템 설정의 개인정보 보호 및 보안에서 ‘그래도 열기’를 눌러요.</li>
        </ol>
        <p className="soft">베타라 아직 공증 전이에요.</p>
        <div className="row end">
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </div>
    </dialog>
  );
}
