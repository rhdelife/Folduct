import { useEffect, useRef, useState } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { formatBytes, kindLabels, type Thing } from "../domain/model";
import { currentOs } from "../domain/platform";
import { canPickFolder } from "../gateways/folder";
import { isNative } from "../gateways/native";
import { useModal } from "./useModal";

export type ViewerState =
  | { status: "loading" }
  | { status: "ready"; file: File }
  | { status: "need-folder" }
  | { status: "denied" }
  | { status: "sample" }
  | { status: "error"; message: string };

type Mode = "image" | "video" | "audio" | "pdf" | "text" | "none";

const textLimit = 300_000;
export const previewLimit = 300 * 1024 ** 2;

// 대화상자 안에서는 페이지 토스트가 가려지므로 결과만 돌려주고, 보여 주기는 부른 쪽이 합니다.
export async function writeClipboard(path: string) {
  try {
    await navigator.clipboard.writeText(path);
    return true;
  } catch {
    return false;
  }
}
const extensionOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

export function previewMode(thing: Pick<Thing, "kind" | "name">): Mode {
  const ext = extensionOf(thing.name);
  if (thing.kind === "image") return "image";
  if (thing.kind === "video") return "video";
  if (thing.kind === "audio") return "audio";
  if (ext === "pdf") return "pdf";
  if (thing.kind === "text" || ext === "csv" || ext === "tsv") return "text";
  return "none";
}

// 새 탭은 이 앱과 같은 출처라서, 스크립트가 돌 수 없는 형식만 실제 파일 확장자로 골라 엽니다.
const tabTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  pdf: "application/pdf",
};

// 저장된 이름·종류가 아니라 읽어 온 파일 이름으로 정하고, 원본 File(타입 포함)은 절대 그대로 넘기지 않습니다. HTML·SVG는 글자로만 보여줘요.
export function safeTabBlob(file: File, mode: Mode): Blob | null {
  if (mode === "none") return null;
  if (mode === "text") return new Blob([file], { type: "text/plain;charset=utf-8" });
  const type = tabTypes[extensionOf(file.name)];
  return type ? new Blob([file], { type }) : null;
}

// 파일 안으로 들어가 보는 창. 폴더 접근을 받으면 실제 파일 내용을 앱 안에서 보여줍니다.
export function FileViewer({
  thing,
  state,
  busy,
  folderHint,
  onClose,
  onConnect,
  onRetry,
  onCopy,
  onOpenApp,
}: {
  thing: Thing;
  state: ViewerState;
  busy: boolean;
  folderHint: string;
  onClose: () => void;
  onConnect: () => void;
  onRetry: () => void;
  onCopy: (path: string) => Promise<boolean>;
  onOpenApp?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog);
  // 대화상자가 열려 있으면 페이지 알림이 가려지므로, 복사 결과는 이 창 안에서 알려 줍니다.
  const [copied, setCopied] = useState<boolean | null>(null);
  const native = isNative();
  const openApp = native ? onOpenApp : undefined;
  const canConnect = native || canPickFolder();
  // 리눅스 WebKitGTK에는 PDF 보기가 없어 빈 칸이 되므로, 기본 앱으로 여는 안내를 바로 보여 줍니다.
  const mode = native && currentOs() === "linux" && previewMode(thing) === "pdf" ? "none" : previewMode(thing);
  const fallback = openApp ? "‘기본 앱으로 열기’로 열어 주세요." : "‘경로 복사’로 경로를 복사해 원래 앱에서 열어 주세요.";
  const tabBlob = !openApp && state.status === "ready" ? safeTabBlob(state.file, mode) : null;
  return (
    <dialog ref={dialog} className="sheet viewer" aria-labelledby="viewer-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="sheet-body">
        <header className="viewer-head">
          <ObjectShape kind={thing.kind} size={40} name={thing.name} seed={thing.id} />
          <div>
            <h2 id="viewer-title">{thing.name}</h2>
            <p className="soft">{kindLabels[thing.kind]} · {formatBytes(state.status === "ready" ? state.file.size : thing.size)} · {thing.path}</p>
          </div>
          <button type="button" onClick={onClose}>닫기</button>
        </header>
        {/* 상태가 바뀔 때마다 읽어 주도록 이 영역은 늘 붙어 있습니다. 미리보기 내용은 밖에 둬서 읽지 않아요. */}
        <div aria-live="polite">
          {state.status === "loading" && <p className="loading">파일을 여는 중…</p>}
          {state.status === "sample" && <p className="viewer-note">샘플 방이라 실제 파일이 없어요. 내 폴더로 만든 방에서는 여기서 파일 내용을 볼 수 있어요.</p>}
          {state.status === "need-folder" && (canConnect ? (
            <div className="viewer-note">
              <p><strong>이 방은 아직 폴더가 연결되지 않았어요.</strong> {native ? "" : "브라우저는 사용자가 직접 고른 폴더만 열 수 있어요. "}열리는 창에서 <b>{folderHint}</b> 폴더를 한 번 골라 주면, 이 방의 파일을 모두 열 수 있어요.</p>
              <button type="button" className="primary" disabled={busy} onClick={onConnect}>{busy ? "폴더를 읽는 중…" : "폴더 연결하고 열기"}</button>
            </div>
          ) : (
            <p className="viewer-note">이 브라우저에서는 Folduct 안에서 파일을 열 수 없어요. 경로를 복사해 원래 앱으로 열어 주세요.</p>
          ))}
          {state.status === "denied" && (
            <div className="viewer-note">
              <p><strong>폴더 접근이 허용되지 않았어요.</strong> {native ? "다시 허용하면 열 수 있어요." : "브라우저가 묻는 창에서 ‘허용’(또는 ‘방문할 때마다 허용’)을 누르면 열 수 있어요."}</p>
              <div className="row">
                <button type="button" className="primary" onClick={onRetry}>다시 허용하고 열기</button>
                {canConnect && <button type="button" disabled={busy} onClick={onConnect}>{busy ? "폴더를 읽는 중…" : "폴더 다시 고르기"}</button>}
              </div>
            </div>
          )}
          {state.status === "error" && (
            <div className="viewer-note">
              <p>{state.message}</p>
              <button type="button" onClick={onRetry}>다시 시도</button>
            </div>
          )}
          {copied === false && <p className="error">복사하지 못했어요. 위의 경로를 직접 골라 복사해 주세요.</p>}
        </div>
        {state.status === "ready" && <Preview file={state.file} mode={mode} fallback={fallback} unsupported={native ? "Folduct" : "브라우저"} />}
        <div className="row end">
          {tabBlob && (
            <button
              type="button"
              onClick={() => {
                const url = URL.createObjectURL(tabBlob);
                window.open(url, "_blank", "noopener");
                window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
              }}
            >
              새 탭에서 크게 보기
            </button>
          )}
          {openApp && state.status === "ready" && <button type="button" onClick={openApp}>기본 앱으로 열기</button>}
          <button type="button" className={state.status === "need-folder" && !canConnect ? "primary" : undefined} onClick={() => void onCopy(thing.path).then(setCopied, () => setCopied(false))}>
            {copied ? "복사했어요" : "경로 복사"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Preview({ file, mode, fallback, unsupported }: { file: File; mode: Mode; fallback: string; unsupported: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (mode === "none") return;
    if (mode === "text") {
      let alive = true;
      file.slice(0, textLimit).text().then((value) => alive && setText(value), () => alive && setFailed(true));
      return () => {
        alive = false;
      };
    }
    const next = URL.createObjectURL(mode === "pdf" ? new Blob([file], { type: "application/pdf" }) : file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, mode]);

  if (mode === "none") return <p className="viewer-note">이 형식은 {unsupported} 안에서 미리볼 수 없어요. {fallback}</p>;
  if (failed) return <p className="viewer-note">미리보기를 만들지 못했어요. {fallback}</p>;
  if (mode === "text") {
    return (
      <div className="viewer-stage">
        {text === null ? <p className="loading">글을 읽는 중…</p> : <pre className="viewer-text">{text}</pre>}
        {file.size > textLimit && <p className="soft">앞부분 {formatBytes(textLimit)}만 보여요.</p>}
      </div>
    );
  }
  if (!url) return null;
  const fail = () => setFailed(true);
  return (
    <div className="viewer-stage">
      {mode === "image" && <img src={url} alt={file.name} onError={fail} />}
      {mode === "video" && <video src={url} controls onError={fail} />}
      {mode === "audio" && <audio src={url} controls onError={fail} />}
      {mode === "pdf" && <iframe src={url} title={file.name} />}
    </div>
  );
}
