import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ObjectShape } from "../../art/ObjectShape";
import { markWorkDay } from "../../domain/care";
import { formatBytes, kindLabels, type Room, type Thing } from "../../domain/model";
import { currentOs } from "../../domain/platform";
import { isExcludedName } from "../../gateways/folder";
import { isNotFound, restoreTrashed, trashFile } from "../../gateways/mover";
import { askFolder, folderAccess, isNative, firstPage, openInApp, readFolderFile, slidePreview, type Folder } from "../../gateways/native";
import { roomFolder } from "../../storage/box";
import { patchRoom } from "../../storage/db";
import { clearPicture, PictureError, setPicture, usePicture } from "../../storage/pictures";
import { renameThing } from "../../storage/rename";
import { FileViewer, Preview, previewLimit, previewMode, writeClipboard, type ViewerState } from "../FileViewer";
import type { ToastAction } from "../Toast";
import { Meta } from "../Meta";
import { SlideView } from "../SlideView";
import { Icon } from "../Icon";

const splitName = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: "" };
};

// 지금 멈춘 영상 장면을 그림 파일로. 그림 저장소가 다시 줄여 담아요.
async function frameOf(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.9));
  if (!blob) throw new PictureError("이 영상은 장면을 그릴 수 없어요. 그림을 올려 주세요.");
  return new File([blob], "frame.jpg", { type: "image/jpeg" });
}

// 홈에서 파일을 누르면 화면 오른쪽(좁은 창은 아래)에 붙는 미리보기 창. 큰 창을 띄우지 않고, 다른 파일을 누르면 내용만 바뀌어요.
// 미리보기(영상은 재생·장면 넘기기), 이 장면을 썸네일로·그림 올리기, 이름 바꾸기(실제 파일, 같은 폴더 안), 한 줄 메모를 여기서 해요.
export function PreviewPane({ room, thing, settled = false, onClose, onToRoom, onChanged, toast }: { room: Room; thing: Thing; settled?: boolean; onClose: () => void; onToRoom: () => void; onChanged: () => void; toast: (message: string, action?: ToastAction) => void }) {
  // 처음 그린 값으로 굳혀요. 나중에 바뀌어도 들어오는 움직임을 다시 틀지 않아요.
  const [still] = useState(settled);
  const [state, setState] = useState<ViewerState | null>(null);
  const [tries, retry] = useReducer((count: number) => count + 1, 0);
  const folder = useRef<Folder | null>(null);
  const started = useRef(-1);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // 앱 안에서 못 여는 형식(발표·문서 등)은 macOS Quick Look 첫 장 그림을 보여 줘요.
  const [page, setPage] = useState<string | null>(null);
  const [pageFile, setPageFile] = useState<File | null>(null);
  // 발표 파일은 Quick Look으로 슬라이드 전체를 받아 보여 줘요(macOS). file은 크게 보기 창의 크기 표시용이에요.
  const [deck, setDeck] = useState<{ html: string; file: File } | { pdf: File; file: File } | null>(null);
  // 미리보기(그림·글·첫 장)를 누르면 방에서처럼 큰 보기 창으로 열어요.
  const [big, setBig] = useState(false);
  useEffect(() => () => void (page && URL.revokeObjectURL(page)), [page]);
  const [busy, setBusy] = useState<string | null>(null);
  const picture = usePicture(thing.id);
  const upload = useRef<HTMLInputElement>(null);
  const { base, ext } = splitName(thing.name);
  const [nameDraft, setNameDraft] = useState(base);
  const [note, setNote] = useState(thing.note);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => setNameDraft(splitName(thing.name).base), [thing.name]);

  // 미리보기를 연 것도 손댄 것으로 셉니다.
  const touch = () => {
    const at = Date.now();
    patchRoom(room.id, (current) => ({ ...current, workDays: markWorkDay(current.workDays, at), things: current.things.map((item) => (item.id === thing.id ? { ...item, touchedAt: at } : item)) })).catch((error: unknown) => console.error(error));
  };

  useEffect(() => {
    if (started.current === tries) return;
    started.current = tries;
    void (async () => {
      if (room.source === "sample") return setState({ status: "sample" });
      try {
        folder.current ??= await roomFolder(room);
        const found = folder.current;
        if (!found) return setState({ status: "need-folder" });
        if (typeof found === "string" && (previewMode(thing) === "none" || thing.size > previewLimit)) {
          if (previewMode(thing) === "none" && currentOs() === "mac") {
            setState({ status: "loading" });
            const slides = thing.kind === "slides" ? await slidePreview(found, thing.path).catch((error: unknown) => (console.error(error), null)) : null;
            if (slides) {
              if ("pdf" in slides) {
                const pdf = new File([slides.pdf], `${thing.name}.pdf`, { type: "application/pdf" });
                setDeck({ pdf, file: pdf });
              } else setDeck({ html: slides.html, file: new File([slides.html], `${thing.name}.html`, { type: "text/plain" }) });
              touch();
              return setState({ status: "outside", big: false });
            }
            const png = await firstPage(found, thing.path).catch(() => null);
            const made = png && URL.createObjectURL(png);
            if (png && made) {
              setPageFile(new File([png], `${thing.name}.png`, { type: "image/png" }));
              setPage(made);
              touch();
            }
          }
          return setState({ status: "outside", big: previewMode(thing) !== "none" });
        }
        setState({ status: "loading" });
        if ((await folderAccess(found)) !== "granted" && !(await askFolder(found))) return setState({ status: "denied" });
        setState({ status: "ready", file: await readFolderFile(found, thing.path) });
        touch();
      } catch (error) {
        if (error instanceof DOMException && error.name === "SecurityError") return setState({ status: "denied" });
        setState({ status: "error", message: isNotFound(error) ? "폴더에서 이 파일을 찾지 못했어요. 방에서 ‘폴더 다시 보기’로 목록을 맞춰 주세요." : "파일을 열지 못했어요. 다른 앱이 쓰고 있는지 확인해 주세요." });
      }
    })();
  }, [tries]); // eslint-disable-line react-hooks/exhaustive-deps

  // 열면 제목으로 포커스를 옮기고, 닫으면 누른 자리로 돌려줘요. Esc로 닫아요.
  // 대화상자·메뉴가 떠 있으면 Esc는 그쪽 몫이고, 글을 쓰는 칸에서는 글쓰기만 끝내요. 닫는 Esc는 홈의 다른 Esc(방 내려놓기)로 번지지 않아요.
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open], .context-menu")) return;
      const target = event.target as HTMLElement | null;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (target?.closest(".preview-pane") && target.matches("input, textarea")) return target.blur();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // 메모는 쓰는 대로(잠깐 멈추면) 저장해요. 그 전에 닫거나 다른 파일로 바꿔도 마지막 글을 저장해요. 파일은 건드리지 않아요.
  const savedNote = useRef(thing.note);
  const saveNote = (text: string) => {
    if (text === savedNote.current) return;
    savedNote.current = text;
    patchRoom(room.id, (current) => ({ ...current, things: current.things.map((item) => (item.id === thing.id ? { ...item, note: text } : item)) })).then(onChanged, (error: unknown) => console.error(error));
  };
  const latestNote = useRef(note);
  latestNote.current = note;
  useEffect(() => {
    const timer = window.setTimeout(() => saveNote(note), 600);
    return () => window.clearTimeout(timer);
  }, [note]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => saveNote(latestNote.current), []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, job: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(label);
    try {
      const done = await job();
      if (done) toast(done);
    } catch (error) {
      console.error(error);
      toast(error instanceof PictureError ? error.message : "하지 못했어요. 잠시 뒤 다시 해 주세요.");
    } finally {
      setBusy(null);
    }
  };

  const rename = (to: string, from: string) =>
    run("rename", async () => {
      const result = await renameThing({ ...room, things: room.things.map((item) => (item.id === thing.id ? { ...item, name: from, path: [...thing.path.split("/").slice(0, -1), from].join("/") } : item)) }, thing.id, to);
      if (result.error) return result.error;
      onChanged();
      toast(`‘${to}’(으)로 바꿨어요.`, { label: "되돌리기", run: () => void rename(from, to) });
      return null;
    });

  const nextName = `${nameDraft.trim()}${ext}`;
  const hiddenName = nameDraft.trim().startsWith(".") || isExcludedName(nextName);
  // 폴더가 없는 방은 실제 파일 이름을 바꿀 수 없어, 누르기 전에 잠그고 이유를 적어요.
  const unlinked = state?.status === "need-folder";
  const nameOk = nameDraft.trim() !== "" && !/[/:\\]/.test(nameDraft) && !hiddenName && nextName !== thing.name && !unlinked;
  // 미리보기가 다시 읽히거나 실패하면 예전 영상 요소로 장면을 잡지 않아요.
  const liveVideo = state?.status === "ready" ? video : null;
  const found = folder.current;
  const native = isNative();
  const canOpen = native && typeof found === "string";
  const mode = native && currentOs() === "linux" && previewMode(thing) === "pdf" ? "none" : previewMode(thing);
  const fallback = canOpen ? "‘기본 앱으로 열기’로 열어 주세요." : "‘경로 복사’로 경로를 복사해 원래 앱에서 열어 주세요.";
  // 묻고 나서 휴지통으로 보내고, 방 기록에서도 빼요. 휴지통에서 되살릴 수 있어요.
  const sendToTrash = async () => {
    if (typeof found !== "string" || !(await window.confirm(`‘${thing.name}’ 파일을 휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요.`))) return;
    let place: string | null;
    try {
      place = await trashFile(found, thing.path);
    } catch (error) {
      return toast(`휴지통으로 보내지 못했어요. (${String(error)})`);
    }
    await patchRoom(room.id, (current) => ({ ...current, things: current.things.filter((item) => item.id !== thing.id) })).catch((error: unknown) => console.error(error));
    // macOS는 휴지통 안 자리를 알려 줘서, 알림의 '되돌리기'로 원래 자리와 방 기록에 되돌려요(창은 이미 닫혀 있어요).
    const gone = thing;
    toast(`‘${gone.name}’ 파일을 휴지통으로 보냈어요.`, place === null ? undefined : {
      label: "되돌리기",
      run: () =>
        void restoreTrashed(found, gone.path, place)
          .then(() => patchRoom(room.id, (current) => (current.things.some((item) => item.id === gone.id) ? current : { ...current, things: [...current.things, gone] })))
          .then(() => {
            onChanged();
            toast(`‘${gone.name}’ 파일을 되돌렸어요.`);
          }, (error: unknown) => {
            console.error(error);
            toast("되돌리지 못했어요. 같은 이름 파일이 생겼거나 휴지통에서 옮겨졌어요. 휴지통에서 직접 꺼내 주세요.");
          }),
    });
    onChanged();
    onClose();
  };
  const openApp = () =>
    typeof found === "string" &&
    openInApp(found, thing.path).then(touch, (error: unknown) => setState({ status: "error", message: `파일을 열지 못했어요. (${String(error)})` }));

  // 홈 장면의 쌓임 맥락(투명도·변형) 밖 body에 그려야 뒤 흐림과 맨 위 자리가 제대로 잡혀요.
  return createPortal(
    <aside className={still ? "preview-pane still" : "preview-pane"} aria-labelledby="preview-title">
      <header className="preview-head">
        <ObjectShape kind={thing.kind} size={40} name={thing.name} seed={thing.id} />
        <div>
          <h2 id="preview-title" ref={heading} tabIndex={-1}>{thing.name}</h2>
          <p className="soft"><Meta items={[kindLabels[thing.kind], formatBytes(state?.status === "ready" ? state.file.size : thing.size), <button type="button" className="link" onClick={onToRoom} aria-label={`${room.name} 방으로 가기`}>{room.name}</button>]} /></p>
        </div>
        <button type="button" className="quiet icon-close" aria-label="닫기" onClick={onClose}><Icon name="close" /></button>
      </header>
      <div className="preview-body">
        <div aria-live="polite">
          {state?.status === "loading" && <p className="loading">파일을 여는 중…</p>}
          {state?.status === "sample" && <p className="viewer-note">샘플 방이라 실제 파일이 없어요. 이름·메모·썸네일은 바꿔 볼 수 있어요.</p>}
          {state?.status === "need-folder" && (
            <div className="viewer-note">
              <p>이 방은 아직 폴더가 연결되지 않았어요.</p>
              <button type="button" className="primary" onClick={onToRoom}>방에서 폴더 연결하기</button>
            </div>
          )}
          {state?.status === "denied" && (
            <div className="viewer-note">
              <p>폴더 접근이 허용되지 않았어요.</p>
              <button type="button" className="primary" onClick={retry}>다시 허용하고 열기</button>
            </div>
          )}
          {state?.status === "outside" && page && <div className="viewer-stage preview-zoom" onClick={() => setBig(true)}><img src={page} alt={`${thing.name} 첫 장`} onError={() => setPage(null)} /></div>}
          {state?.status === "outside" && deck && ("html" in deck ? <SlideView html={deck.html} title={thing.name} /> : <Preview file={deck.pdf} mode="pdf" fallback="" unsupported="Folduct" />)}
          {state?.status === "outside" && !page && !deck && <p className="viewer-note">{state.big ? "파일이 커서 미리 보지 않아요." : "이 형식은 Folduct에서 미리 볼 수 없어요."}</p>}
          {state?.status === "error" && (
            <div className="viewer-note">
              <p>{state.message}</p>
              <button type="button" onClick={retry}>다시 시도</button>
            </div>
          )}
        </div>
        {state?.status === "ready" && (
          // 그림·글은 누르면 크게 봐요. 글은 드래그해서 고른 중이면 열지 않아요. 영상·PDF는 안에서 조작하니 아래 '크게 보기' 단추로 열어요.
          <div className={mode === "image" || mode === "text" ? "preview-zoom" : undefined} onClick={() => (mode === "image" || mode === "text") && !getSelection()?.toString() && setBig(true)}>
            <Preview file={state.file} mode={mode} fallback={fallback} unsupported={native ? "Folduct" : "브라우저"} onVideo={setVideo} />
          </div>
        )}
        {((state?.status === "ready" && mode !== "none") || (state?.status === "outside" && (page || deck))) && (
          <button type="button" className="quiet preview-big" onClick={() => setBig(true)}>크게 보기</button>
        )}

        <section className="preview-section" aria-labelledby="preview-thumb">
          <h3 id="preview-thumb">썸네일</h3>
          {picture && <img className="preview-thumb" src={picture} alt="지금 썸네일" />}
          <div className="row wrap">
            {liveVideo && (
              <button type="button" className="primary" aria-disabled={busy !== null} onClick={() => void run("frame", async () => (await setPicture(room.id, thing.id, await frameOf(liveVideo)), "이 장면을 썸네일로 했어요."))}>
                이 장면을 썸네일로
              </button>
            )}
            <button type="button" aria-disabled={busy !== null} onClick={() => upload.current?.click()}>{picture ? "다른 그림 올리기" : "그림 올리기"}</button>
            {picture && <button type="button" aria-disabled={busy !== null} onClick={() => void run("clear", async () => (await clearPicture(room.id, thing.id), "원래 썸네일로 돌렸어요."))}>원래대로</button>}
            <input
              ref={upload}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void run("upload", async () => (await setPicture(room.id, thing.id, file), "썸네일을 바꿨어요."));
              }}
            />
          </div>
          {liveVideo && <p className="soft">영상을 원하는 장면에서 멈추고 누르세요.</p>}
        </section>

        <section className="preview-section" aria-labelledby="preview-name">
          <h3 id="preview-name">이름</h3>
          <form
            className="preview-rename"
            onSubmit={(event) => {
              event.preventDefault();
              if (nameOk) void rename(nextName, thing.name);
            }}
          >
            <label className="preview-name-field">
              <span className="sr-only">새 이름</span>
              <input value={nameDraft} maxLength={200} onChange={(event) => setNameDraft(event.target.value)} />
              {ext && <span className="preview-ext">{ext}</span>}
            </label>
            <button type="submit" disabled={!nameOk || busy !== null}>{busy === "rename" ? "바꾸는 중…" : "바꾸기"}</button>
          </form>
          <p className="soft">{hiddenName ? "점으로 시작하는 이름이나 시스템 파일 이름은 쓸 수 없어요. 폴더에서 숨겨져요." : unlinked ? "폴더를 연결하면 실제 파일 이름을 바꿀 수 있어요." : room.source === "sample" ? "샘플 방은 Folduct 안 이름만 바뀌어요." : "폴더의 실제 파일 이름이 바뀌어요. 같은 이름이 있으면 바꾸지 않아요."}</p>
        </section>

        <section className="preview-section" aria-labelledby="preview-note">
          <h3 id="preview-note">메모</h3>
          <textarea aria-labelledby="preview-note" rows={3} maxLength={500} value={note} placeholder="이 파일에 남길 말" onChange={(event) => setNote(event.target.value)} />
        </section>
      </div>
      <footer className="row wrap preview-foot">
        {canOpen && <button type="button" onClick={() => void openApp()}>기본 앱으로 열기</button>}
        <button type="button" onClick={() => void writeClipboard(thing.path).then((ok) => toast(ok ? "경로를 복사했어요." : "복사하지 못했어요."))}>경로 복사</button>
        {canOpen && <button type="button" onClick={() => void sendToTrash()}><Icon name="trash" />휴지통으로</button>}
      </footer>
      {big && state?.status === "ready" && <FileViewer thing={thing} state={state} busy={false} folderHint={room.name} onClose={() => setBig(false)} onConnect={() => setBig(false)} onRetry={retry} onCopy={writeClipboard} onOpenApp={canOpen ? () => void openApp() : undefined} />}
      {big && state?.status === "outside" && deck && (
        <FileViewer thing={thing} state={{ status: "ready", file: deck.file }} busy={false} folderHint={room.name} onClose={() => setBig(false)} onConnect={() => setBig(false)} onRetry={retry} onCopy={writeClipboard} onOpenApp={canOpen ? () => void openApp() : undefined} body={"html" in deck ? <div className="viewer-stage slide-stage"><SlideView html={deck.html} title={thing.name} /></div> : <Preview file={deck.pdf} mode="pdf" fallback="" unsupported="Folduct" />} />
      )}
      {big && state?.status === "outside" && !deck && pageFile && (
        <FileViewer thing={{ ...thing, kind: "image" }} state={{ status: "ready", file: pageFile }} busy={false} folderHint={room.name} onClose={() => setBig(false)} onConnect={() => setBig(false)} onRetry={retry} onCopy={writeClipboard} onOpenApp={canOpen ? () => void openApp() : undefined} />
      )}
    </aside>,
    document.body,
  );
}
