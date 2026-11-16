import { useMemo, useRef, useState, type PointerEvent } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { baseOf, blankPaper, clampPoint, iconArt, kindIconLimit, kindIconNameMax, kinds, pointLimit, strokeLimit, type IconStroke, type IconTool, type KindIcon } from "../domain/kindIcon";
import { kindLabels, type Kind } from "../domain/model";
import { saveKindIcons, useKindIcons } from "../storage/kindIcons";
import { Icon } from "./Icon";
import { useModal } from "./useModal";

const stagePx = 240;
const toolNames: { tool: IconTool; label: string }[] = [
  { tool: "pen", label: "펜" },
  { tool: "ring", label: "원" },
  { tool: "box", label: "네모" },
  { tool: "wave", label: "물결줄" },
];
// 펜은 판 단위로 이만큼 움직였을 때만 점을 더해요. 점이 너무 많으면 프로도 펜이 무거워져요.
const penStep = 1.5;
const fresh = (kind: Kind): KindIcon => ({ id: crypto.randomUUID(), name: "", kind, base: blankPaper.id, strokes: [], at: Date.now() });
const same = (a: KindIcon | undefined, b: KindIcon) => Boolean(a) && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

// 메뉴에서 여는 파일 형식 아이콘 만들기와 보관함. 빈 흰 캔버스에 선과 도장을 그리고, 저장한 뒤 '이 형식에 쓰기'를 누르면
// 홈·방·Drawer·미리보기에서 그 형식 파일이 이 그림으로 바뀌어요. 선은 프로도와 같은 펜으로 다시 그어져요.
// start: 메뉴의 '아이콘 만들기'는 그리기(make), '아이콘 보관함'은 모아 둔 아이콘 목록(archive)으로 열어요. 보관함에서 아이콘을 누르면 그리기로 넘어가 고쳐요.
export function KindIconMaker({ onClose, start = "make" }: { onClose: () => void; start?: "make" | "archive" }) {
  const [mode, setMode] = useState(start);
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  useModal(dialog);
  const store = useKindIcons();
  const [draft, setDraft] = useState<KindIcon>(() => fresh("image"));
  const [tool, setTool] = useState<IconTool>("pen");
  const [fill, setFill] = useState(false);
  const [live, setLive] = useState<IconStroke | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const base = baseOf(draft.kind, draft.base);
  const art = useMemo(() => iconArt(draft), [draft]);
  const saved = store.icons.find((icon) => icon.id === draft.id);
  const changed = !same(saved, draft);
  const inUse = store.use[draft.kind] === draft.id;
  const full = !saved && store.icons.length >= kindIconLimit;
  const dirty = changed && (Boolean(saved) || draft.strokes.length > 0 || draft.name.trim() !== "");
  // 지금 형식 아이콘을 앞에 둬요.
  const shelf = useMemo(() => [...store.icons].sort((a, b) => Number(b.kind === draft.kind) - Number(a.kind === draft.kind)), [store.icons, draft.kind]);

  function point(event: PointerEvent<SVGSVGElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect();
    return clampPoint(base, ((event.clientX - box.left) / box.width) * base.w, ((event.clientY - box.top) / box.height) * base.h);
  }

  function down(event: PointerEvent<SVGSVGElement>) {
    if (draft.strokes.length >= strokeLimit) return setError(`선은 ${strokeLimit}개까지 그릴 수 있어요.`);
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = point(event);
    setLive({ tool, pts: tool === "pen" ? [x, y] : [x, y, x, y], fill: fill && (tool === "ring" || tool === "box") });
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (!live) return;
    const [x, y] = point(event);
    if (live.tool !== "pen") return setLive({ ...live, pts: [live.pts[0], live.pts[1], x, y] });
    const [lx, ly] = live.pts.slice(-2);
    if (Math.hypot(x - lx, y - ly) < penStep || live.pts.length >= pointLimit * 2) return;
    setLive({ ...live, pts: [...live.pts, x, y] });
  }

  function up() {
    if (!live) return;
    if (live.pts.length >= 4) setDraft((now) => ({ ...now, strokes: [...now.strokes, live] }));
    setLive(null);
  }

  // 형식을 바꿔도 그림은 그대로예요. 예전 종이 위 그림은 빈 캔버스로 옮기고, 선은 캔버스 안으로 넣어요.
  function changeKind(kind: Kind) {
    setDraft((now) => ({ ...now, kind, base: blankPaper.id, strokes: now.strokes.map((stroke) => ({ ...stroke, pts: stroke.pts.flatMap((value, at) => (at % 2 ? [] : clampPoint(blankPaper, value, stroke.pts[at + 1]))) })) }));
  }

  async function write(next: typeof store) {
    setSaving(true);
    setError(null);
    try {
      await saveKindIcons(next);
      return true;
    } catch (cause) {
      console.error(cause);
      setError("저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const withDraft = () => {
    const icon = { ...draft, name: draft.name.trim(), at: Date.now() };
    const icons = saved ? store.icons.map((item) => (item.id === icon.id ? icon : item)) : [icon, ...store.icons];
    // 다른 형식으로 바꿔 저장하면 예전 형식에 쓰던 자리는 비워요.
    const use = Object.fromEntries(Object.entries(store.use).filter(([kind, id]) => id !== icon.id || kind === icon.kind));
    return { icon, next: { icons, use } };
  };

  async function save() {
    const { icon, next } = withDraft();
    if (await write(next)) setDraft(icon);
  }

  async function useHere(on: boolean) {
    const { icon, next } = withDraft();
    const use = { ...next.use };
    if (on) use[icon.kind] = icon.id;
    else delete use[icon.kind];
    if (await write({ ...next, use })) setDraft(icon);
  }

  async function remove() {
    if (!saved || !(await window.confirm(`‘${saved.name || "이름 없는 아이콘"}’을 보관함에서 지울까요?${inUse ? ` ${kindLabels[saved.kind]} 파일은 기본 종이로 돌아가요.` : ""}`))) return;
    const use = Object.fromEntries(Object.entries(store.use).filter(([, id]) => id !== saved.id));
    if (await write({ icons: store.icons.filter((item) => item.id !== saved.id), use })) setDraft(fresh(draft.kind));
  }

  // 앱(Tauri)에서는 confirm이 약속(Promise)으로 와서 기다려요.
  async function open(next: KindIcon) {
    if (dirty && !(await window.confirm("고친 내용을 저장하지 않고 다른 아이콘을 열까요?"))) return false;
    setError(null);
    setDraft(next);
    return true;
  }

  async function close() {
    if (dirty && !(await window.confirm("고친 내용을 저장하지 않고 닫을까요?"))) return;
    onClose();
  }

  const liveArt = live && iconArt({ ...draft, strokes: [live] });
  return (
    <dialog
      ref={dialog}
      className="sheet settings kind-icon-maker"
      aria-labelledby="kind-icon-title"
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget) void close();
      }}
    >
      <div className="sheet-body">
        <header className="menu-head">
          <h2 id="kind-icon-title">{mode === "archive" ? "아이콘 보관함" : "아이콘 만들기"}</h2>
          <button type="button" className="quiet icon-close" aria-label="닫기" onClick={() => void close()}><Icon name="close" /></button>
        </header>
        {error && <p className="banner danger" role="alert">{error}</p>}
        {mode === "make" && (
          <>
        {/* 이름은 창 맨 위에 둬요. 아래에 두면 붙어 있는 단추 줄에 가려졌어요. */}
        <label className="field">이름 <input value={draft.name} maxLength={kindIconNameMax} placeholder="예: 내 영상 종이" onChange={(event) => setDraft((now) => ({ ...now, name: event.target.value }))} /></label>
        <fieldset className="face-picker">
          <legend>파일 형식</legend>
          <div className="seg icon-kinds" role="radiogroup" aria-label="파일 형식 고르기">
            {kinds.map((kind) => (
              <label key={kind}><input type="radio" name="icon-kind" checked={draft.kind === kind} onChange={() => changeKind(kind)} />{kindLabels[kind]}</label>
            ))}
          </div>
        </fieldset>
        <div className="icon-board">
          <div className="icon-canvas" style={{ width: stagePx }}>
            <ObjectShape kind={draft.kind} size={stagePx} art={art} name={draft.name.trim() || `${kindLabels[draft.kind]} 파일`} />
            <svg
              className="icon-pad"
              viewBox={`0 0 ${base.w} ${base.h}`}
              role="img"
              aria-label="그리는 판. 끌어서 선을 그어요."
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => setLive(null)}
            >
              {/* 긋는 동안은 가벼운 선으로 보여 주고, 손을 떼면 프로도 펜으로 다시 그어요. */}
              {liveArt?.parts.slice(base.parts.length).map((part, at) => <path key={at} d={part.d} className="icon-live" />)}
            </svg>
          </div>
        </div>
        <div className="row icon-tools">
          <div className="seg" role="radiogroup" aria-label="도구 고르기">
            {toolNames.map(({ tool: name, label }) => (
              <label key={name}><input type="radio" name="icon-tool" checked={tool === name} onChange={() => setTool(name)} />{label}</label>
            ))}
          </div>
          <label className="icon-fill"><input type="checkbox" checked={fill} disabled={tool === "pen" || tool === "wave"} onChange={(event) => setFill(event.target.checked)} />색 채우기</label>
        </div>
        <div className="row">
          <button type="button" disabled={!draft.strokes.length} onClick={() => setDraft((now) => ({ ...now, strokes: now.strokes.slice(0, -1) }))}>되돌리기</button>
          <button type="button" disabled={!draft.strokes.length} onClick={() => setDraft((now) => ({ ...now, strokes: [] }))}>모두 지우기</button>
        </div>
          </>
        )}
        {mode === "archive" && (
        <section className="cover-picker" aria-labelledby="kind-icon-archive">
          <h3 id="kind-icon-archive">{store.icons.length}개</h3>
          {store.icons.length === 0 ? (
            <p className="soft">저장한 아이콘이 여기 모여요. 누르면 고치고 ‘이 형식에 쓰기’를 할 수 있어요.</p>
          ) : (
            <div className="cover-options" role="group" aria-label="보관한 아이콘">
              {shelf.map((icon) => (
                <button key={icon.id} type="button" className="cover-option" aria-pressed={icon.id === draft.id} title={icon.name} onClick={() => void open(icon).then((opened) => opened && setMode("make"))}>
                  <ObjectShape kind={icon.kind} size={48} art={iconArt(icon)} />
                  {/* 쓰는 중인 아이콘은 색이 아니라 굵은 글자로 알려요. */}
                  <span className={store.use[icon.kind] === icon.id ? "icon-on" : undefined}>{store.use[icon.kind] === icon.id ? "쓰는 중 · " : ""}{icon.name || kindLabels[icon.kind]}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        )}
        {full && <p className="soft" role="status">보관함이 가득 찼어요({kindIconLimit}개). 하나를 지우면 새로 넣을 수 있어요.</p>}
        {mode === "archive" ? (
          <div className="row end settings-foot">
            <button type="button" className="primary" onClick={() => void open(fresh(draft.kind)).then((opened) => opened && setMode("make"))}>새로 만들기</button>
          </div>
        ) : (
        <div className="row end settings-foot">
          <button type="button" className="quiet" onClick={() => setMode("archive")}>보관함 {store.icons.length}개</button>
          {saved && <button type="button" className="danger" disabled={saving} onClick={() => void remove()}>지우기</button>}
          <button type="button" disabled={saving} onClick={() => void open(fresh(draft.kind))}>새로 만들기</button>
          {inUse ? (
            <button type="button" disabled={saving} onClick={() => void useHere(false)}>기본으로 돌리기</button>
          ) : (
            <button type="button" disabled={saving || full || !draft.strokes.length} onClick={() => void useHere(true)}>이 형식에 쓰기</button>
          )}
          <button type="button" className="primary" disabled={!changed || saving || full || !draft.strokes.length} onClick={() => void save()}>{saving ? "저장하는 중" : "저장"}</button>
        </div>
        )}
      </div>
    </dialog>
  );
}
