import { useEffect, useRef, useState } from "react";
import type { Asset } from "../domain/models";
import {
  clampPlaybackSeconds,
  createPreviewTicket,
  formatByteSize,
  planPreview,
  playbackMime,
  previewBlockMessage,
  readUtf8Text,
  safeTextNote,
  type PreviewBlock,
} from "../domain/preview";
import { readProjectFile } from "../gateways/readProjectFile";

type PreviewTarget = { kind: "memo" } | { kind: "missing" } | { kind: "file"; asset: Asset };

type View =
  | { phase: "loading" }
  | { phase: "blocked"; block: PreviewBlock; url: string | null; name: string; size: number }
  | { phase: "unavailable" }
  | { phase: "read-failed" }
  | { phase: "text-corrupt" }
  | { phase: "text"; text: string; note: string | null }
  | { phase: "image"; url: string; name: string }
  | { phase: "image-corrupt" }
  | { phase: "pdf"; url: string; name: string }
  | { phase: "media"; mode: "video" | "audio"; url: string; name: string }
  | { phase: "codec" }
  | { phase: "media-corrupt" };

export function FilePreview({
  projectId,
  target,
  directoryHandle,
  savedSeconds,
  onMediaPosition,
}: {
  projectId: string;
  target: PreviewTarget;
  directoryHandle: FileSystemDirectoryHandle | null;
  savedSeconds: number | null;
  onMediaPosition: (assetId: string, seconds: number) => void;
}) {
  const [view, setView] = useState<View>({ phase: "loading" });
  const assetKey = target.kind === "file" ? target.asset.id : target.kind;
  const [shownKey, setShownKey] = useState(assetKey);
  if (shownKey !== assetKey) {
    setShownKey(assetKey);
    setView({ phase: "loading" });
  }
  const visible: View = shownKey === assetKey ? view : { phase: "loading" };
  const savedRef = useRef(savedSeconds);
  const onPositionRef = useRef(onMediaPosition);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const tickets = useRef(createPreviewTicket());
  savedRef.current = savedSeconds;
  onPositionRef.current = onMediaPosition;

  const asset = target.kind === "file" ? target.asset : null;
  const assetId = asset?.id ?? "";
  const relativePath = asset?.relativePath ?? "";
  const displayName = asset?.displayName ?? "";
  const assetKind = asset?.kind;
  const assetSize = asset?.size ?? 0;

  useEffect(() => {
    if (!assetId || !assetKind) return;
    const current = tickets.current.next();
    let url: string | null = null;
    let active = true;
    setView({ phase: "loading" });

    const release = () => {
      if (url) URL.revokeObjectURL(url);
      url = null;
    };

    void (async () => {
      const plan = planPreview({ displayName, kind: assetKind, size: assetSize });
      const read = await readProjectFile(projectId, relativePath, directoryHandle);
      if (!active || !tickets.current.isCurrent(current)) return;
      if (!read.ok) {
        if (plan.status === "blocked") {
          setView({ phase: "blocked", block: plan.block, url: null, name: displayName, size: assetSize });
          return;
        }
        setView({ phase: read.reason === "unavailable" ? "unavailable" : "read-failed" });
        return;
      }
      const filePlan = planPreview({ displayName, kind: assetKind, size: read.file.size });
      if (!active || !tickets.current.isCurrent(current)) return;
      if (filePlan.status === "blocked") {
        const downloadUrl = URL.createObjectURL(read.file);
        if (!active || !tickets.current.isCurrent(current)) {
          URL.revokeObjectURL(downloadUrl);
          return;
        }
        url = downloadUrl;
        setView({ phase: "blocked", block: filePlan.block, url: downloadUrl, name: displayName, size: read.file.size });
        return;
      }
      if (filePlan.mode === "text") {
        const decoded = readUtf8Text(new Uint8Array(await read.file.arrayBuffer()));
        if (!active || !tickets.current.isCurrent(current)) return;
        if (!decoded.ok) {
          setView({ phase: "text-corrupt" });
          return;
        }
        setView({ phase: "text", text: decoded.text, note: safeTextNote(displayName) });
        return;
      }
      if ((filePlan.mode === "video" || filePlan.mode === "audio") && !canPlay(filePlan.mode, playbackMime(displayName, read.file.type))) {
        setView({ phase: "codec" });
        return;
      }
      const objectUrl = URL.createObjectURL(read.file);
      if (!active || !tickets.current.isCurrent(current)) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      url = objectUrl;
      if (filePlan.mode === "image") setView({ phase: "image", url: objectUrl, name: displayName });
      else if (filePlan.mode === "pdf") setView({ phase: "pdf", url: objectUrl, name: displayName });
      else setView({ phase: "media", mode: filePlan.mode, url: objectUrl, name: displayName });
    })().catch(() => {
      if (active && tickets.current.isCurrent(current)) setView({ phase: "read-failed" });
    });

    return () => {
      active = false;
      const media = mediaRef.current;
      if (media && Number.isFinite(media.currentTime) && media.currentTime > 0) {
        onPositionRef.current(assetId, media.currentTime);
      }
      mediaRef.current = null;
      release();
    };
  }, [assetId, assetKind, assetSize, directoryHandle, displayName, projectId, relativePath]);

  if (target.kind === "memo") return <p className="preview-note">파일 없는 메모입니다.</p>;
  if (target.kind === "missing") return <p className="preview-note">연결된 자료를 찾지 못했습니다. 메모는 남아 있습니다.</p>;

  function commit(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    onPositionRef.current(assetId, seconds);
  }

  return (
    <div className="file-preview" data-preview-phase={visible.phase} data-preview-asset={assetId}>
      {visible.phase === "loading" && <p className="preview-note">미리보기를 여는 중</p>}
      {visible.phase === "unavailable" && (
        <p className="preview-note">폴더 접근이 없어 내용을 열 수 없습니다. 배치와 메모는 남아 있습니다.</p>
      )}
      {visible.phase === "read-failed" && (
        <p className="preview-note">파일을 읽지 못했습니다. 이 카드의 배치와 메모는 남아 있습니다.</p>
      )}
      {visible.phase === "text-corrupt" && (
        <p className="preview-note">UTF-8로 읽지 못했습니다. 손상되었거나 다른 인코딩일 수 있습니다.</p>
      )}
      {visible.phase === "image-corrupt" && (
        <p className="preview-note">이미지를 표시하지 못했습니다. 파일이 손상되었거나 이 브라우저에서 열 수 없는 형식입니다.</p>
      )}
      {visible.phase === "codec" && <p className="preview-note">이 브라우저는 이 미디어 코덱을 재생하지 않습니다.</p>}
      {visible.phase === "media-corrupt" && (
        <p className="preview-note">재생하지 못했습니다. 코덱을 지원하지 않거나 파일이 손상되었습니다.</p>
      )}
      {visible.phase === "blocked" && (
        <>
          <p className="preview-note">{previewBlockMessage(visible.block)}</p>
          <p className="preview-note">{visible.name} · {formatByteSize(visible.size)}</p>
          {visible.url && <CopyLink url={visible.url} name={visible.name} />}
        </>
      )}
      {visible.phase === "text" && (
        <>
          {visible.note && <p className="preview-note">{visible.note}</p>}
          <pre className="preview-text">{visible.text}</pre>
        </>
      )}
      {visible.phase === "image" && (
        <img
          src={visible.url}
          alt={visible.name}
          onError={() => setView({ phase: "image-corrupt" })}
        />
      )}
      {visible.phase === "pdf" && (
        <>
          <object className="preview-pdf" data={visible.url} type="application/pdf" aria-label={visible.name}>
            <p className="preview-note">이 브라우저 안에서는 PDF를 표시하지 못했습니다.</p>
          </object>
          <p className="preview-note">
            <a href={visible.url} target="_blank" rel="noopener noreferrer">별도 탭에서 열기</a>
            {" "}페이지 위치는 저장하지 않습니다.
          </p>
        </>
      )}
      {visible.phase === "media" && (
        visible.mode === "video" ? (
          <video
            ref={(node) => { mediaRef.current = node; }}
            src={visible.url}
            controls
            preload="metadata"
            playsInline
            autoPlay={false}
            onLoadedMetadata={(event) => restoreTime(event.currentTarget, savedRef.current)}
            onPause={(event) => commit(event.currentTarget.currentTime)}
            onSeeked={(event) => commit(event.currentTarget.currentTime)}
            onError={() => setView({ phase: "media-corrupt" })}
          />
        ) : (
          <audio
            ref={(node) => { mediaRef.current = node; }}
            src={visible.url}
            controls
            preload="metadata"
            autoPlay={false}
            onLoadedMetadata={(event) => restoreTime(event.currentTarget, savedRef.current)}
            onPause={(event) => commit(event.currentTarget.currentTime)}
            onSeeked={(event) => commit(event.currentTarget.currentTime)}
            onError={() => setView({ phase: "media-corrupt" })}
          />
        )
      )}
      {visible.phase === "media" && <p className="preview-note">재생을 눌러야 소리가 납니다. 마지막 위치는 이 작업면에 저장됩니다.</p>}
    </div>
  );
}

function restoreTime(element: HTMLMediaElement, saved: number | null) {
  if (saved === null) return;
  const next = clampPlaybackSeconds(saved, element.duration);
  if (next === null) return;
  if (Math.abs(element.currentTime - next) > 0.05) element.currentTime = next;
}

function canPlay(mode: "video" | "audio", mime: string): boolean {
  if (!mime || typeof document === "undefined") return true;
  return document.createElement(mode).canPlayType(mime) !== "";
}

function CopyLink({ url, name }: { url: string; name: string }) {
  return (
    <p className="preview-note">
      <a href={url} download={name}>복사본 받기</a>
      {" "}받는 파일은 복사본입니다. 원본 폴더의 파일은 바뀌지 않습니다.
    </p>
  );
}
