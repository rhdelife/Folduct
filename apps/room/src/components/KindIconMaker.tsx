import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { baseOf, blankPaper, clampPoint, iconArt, kindIconLimit, kindIconNameMax, kinds, pointLimit, strokeLimit, type IconStroke, type IconTool, type KindIcon } from "../domain/kindIcon";
import { kindLabels, type Kind } from "../domain/model";
import { currentOs } from "../domain/platform";
import { saveKindIcons, useKindIcons } from "../storage/kindIcons";

const stagePx = 240;
const toolNames: { tool: IconTool; label: string }[] = [
  { tool: "pen", label: "펜" },
  { tool: "ring", label: "원" },
  { tool: "box", label: "네모" },
  { tool: "wave", label: "물결줄" },
];
// 펜은 판 단위로 이만큼 움직였을 때만 점을 더해요. 점이 너무 많으면 프로도 펜이 무거워져요.
const penStep = 1.5;
// 단축키 글은 Mac은 ⌘, 다른 OS는 Ctrl+로 보여 줘요.
const cmd = () => (currentOs() === "mac" ? "⌘" : "Ctrl+");
const fresh = (kind: Kind): KindIcon => ({ id: crypto.randomUUID(), name: "", kind, base: blankPaper.id, strokes: [], at: Date.now() });
const same = (a: KindIcon | undefined, b: KindIcon) => Boolean(a) && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

// 머리줄 Icons 탭의 페이지: 파일 형식 아이콘 그리기와 보관함. 빈 흰 캔버스에 선과 도장을 그리고, 저장한 뒤 '이 형식에 쓰기'를 누르면
// 홈·방·Drawer·미리보기에서 그 형식 파일이 이 그림으로 바뀌어요. 선은 프로도와 같은 펜으로 다시 그어져요.
// mode: 그리기(make)와 보관함(archive). 메뉴의 '아이콘 만들기'·'아이콘 보관함'이 각 화면으로 바로 와요. 보관함에서 아이콘을 누르면 그리기로 넘어가 고쳐요.
// active: 지금 이 탭을 보고 있는지. 단축키는 이때만 들어요. 탭을 떠나도 지우지 않고 숨겨서 그리던 그림이 남아요.
// 단축키: ⌘/Ctrl+Z 되돌리기, ⌘/Ctrl+Shift+Z·Ctrl+Y 다시 하기, ⌘/Ctrl+S 등록, Shift+끌기 곧은 선·정원·정사각형, Esc 긋던 선 취소, 1~4 도구.
export function KindIconMaker({ mode, onMode: setMode, active }: { mode: "make" | "archive"; onMode: (mode: "make" | "archive") => void; active: boolean }) {
  const store = useKindIcons();
  const [draft, setDraft] = useState<KindIcon>(() => fresh("image"));
  const [tool, setTool] = useState<IconTool>("pen");
  const [fill, setFill] = useState(false);
  const [live, setLive] = useState<IconStroke | null>(null);
  // 선 기록: 되돌리기(past)와 다시 하기(future). 선을 긋고, 되돌리고, 모두 지우는 것까지 기록해요. 다른 아이콘을 열면 비워요.
  const [past, setPast] = useState<IconStroke[][]>([]);
  const [future, setFuture] = useState<IconStroke[][]>([]);
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
    let [x, y] = point(event);
    const [sx, sy] = live.pts;
    // Shift: 펜은 처음 점에서 곧은 선, 원·네모는 가로세로가 같은 정원·정사각형이에요.
    if (event.shiftKey && live.tool === "pen") return setLive({ ...live, pts: [sx, sy, x, y] });
    if (event.shiftKey && (live.tool === "ring" || live.tool === "box")) {
      const side = Math.max(Math.abs(x - sx), Math.abs(y - sy));
      [x, y] = clampPoint(base, sx + Math.sign(x - sx || 1) * side, sy + Math.sign(y - sy || 1) * side);
    }
    if (live.tool !== "pen") return setLive({ ...live, pts: [sx, sy, x, y] });
    const [lx, ly] = live.pts.slice(-2);
    if (Math.hypot(x - lx, y - ly) < penStep || live.pts.length >= pointLimit * 2) return;
    setLive({ ...live, pts: [...live.pts, x, y] });
  }

  function up() {
    if (!live) return;
    if (live.pts.length >= 4) setStrokes([...draft.strokes, live]);
    setLive(null);
  }

  function setStrokes(strokes: IconStroke[]) {
    setPast((now) => [...now, draft.strokes]);
    setFuture([]);
    setDraft((now) => ({ ...now, strokes }));
  }
  function undo() {
    const last = past.at(-1);
    if (!last) return;
    setPast(past.slice(0, -1));
    setFuture([draft.strokes, ...future]);
    setDraft((now) => ({ ...now, strokes: last }));
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, draft.strokes]);
    setDraft((now) => ({ ...now, strokes: next }));
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
    setPast([]);
    setFuture([]);
    return true;
  }

  // 등록은 이름(아이콘 이름)을 꼭 넣어야 해요(2026-11-17 요청). 보관함에서 이름으로 찾고 고르니까요.
  const named = draft.name.trim() !== "";
  const canSave = changed && named && !saving && !full && draft.strokes.length > 0;
  // 단축키. 이름 칸에 쓰는 중에는 ⌘Z가 글자 되돌리기라 저장(⌘S)만 받아요. 홈의 다른 Esc로 번지지 않게 긋던 선이 있을 때만 Esc를 써요.
  const keys = useRef((_: KeyboardEvent) => {});
  keys.current = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "s") {
      event.preventDefault();
      if (mode === "make" && canSave) void save();
      return;
    }
    if (mode !== "make" || document.querySelector("dialog[open]")) return;
    const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) && !["radio", "checkbox"].includes((event.target as HTMLInputElement).type));
    if (typing) return;
    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key === "y") {
      event.preventDefault();
      redo();
    } else if (key === "escape" && live) {
      event.preventDefault();
      event.stopPropagation();
      setLive(null);
    } else if (!mod && !event.altKey && /^[1-4]$/.test(event.key)) {
      setTool(toolNames[Number(event.key) - 1].tool);
    }
  };
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);

  const liveArt = live && iconArt({ ...draft, strokes: [live] });
  return (
    <section className="kind-icon-page kind-icon-maker" aria-labelledby="kind-icon-title">
      <div className="kind-icon-body">
        <header className="kind-icon-head">
          <h2 id="kind-icon-title" className="sr-only">{mode === "archive" ? "아이콘 보관함" : "아이콘 만들기"}</h2>
          <div className="seg kind-icon-modes" role="radiogroup" aria-label="화면 고르기">
            <label><input type="radio" name="icon-mode" checked={mode === "make"} onChange={() => setMode("make")} />그리기</label>
            <label><input type="radio" name="icon-mode" checked={mode === "archive"} onChange={() => setMode("archive")} />보관함 {store.icons.length}개</label>
          </div>
        </header>
        {error && <p className="banner danger" role="alert">{error}</p>}
        {mode === "make" && (
          <>
        {/* 이름은 창 맨 위에 둬요. 아래에 두면 붙어 있는 단추 줄에 가려졌어요. */}
        <label className="field">이름 <input value={draft.name} required aria-describedby={named ? undefined : "kind-icon-need-name"} maxLength={kindIconNameMax} placeholder="예: 내 영상 종이" onChange={(event) => setDraft((now) => ({ ...now, name: event.target.value }))} /></label>
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
            {/* 판 위에는 글을 쓰지 않아요(2026-11-17 요청). 이름 칸 자리와 판 크기는 그대로 두려고 빈 이름(" ")을 넘겨요. */}
            <ObjectShape kind={draft.kind} size={stagePx} art={art} name=" " />
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
          <button type="button" disabled={!past.length} title={`${cmd()}Z`} onClick={undo}>되돌리기</button>
          <button type="button" disabled={!future.length} title={`${cmd()}Shift+Z`} onClick={redo}>다시 하기</button>
          <button type="button" disabled={!draft.strokes.length} onClick={() => setStrokes([])}>모두 지우기</button>
        </div>
        {!named && <p id="kind-icon-need-name" className="soft">이름을 넣어야 등록할 수 있어요.</p>}
        <p className="soft kind-icon-keys">{cmd()}Z 되돌리기 · {cmd()}Shift+Z 다시 하기 · {cmd()}S 등록 · Shift 곧은 선·정원·정사각형 · 1~4 도구 · Esc 긋던 선 취소</p>
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
          {saved && <button type="button" className="danger" disabled={saving} onClick={() => void remove()}>지우기</button>}
          <button type="button" disabled={saving} onClick={() => void open(fresh(draft.kind))}>새로 만들기</button>
          {inUse ? (
            <button type="button" disabled={saving} onClick={() => void useHere(false)}>기본으로 돌리기</button>
          ) : (
            <button type="button" disabled={saving || full || !named || !draft.strokes.length} onClick={() => void useHere(true)}>이 형식에 쓰기</button>
          )}
          <button type="button" className="primary" title={`${cmd()}S`} disabled={!canSave} onClick={() => void save()}>{saving ? "등록하는 중" : "등록"}</button>
        </div>
        )}
      </div>
    </section>
  );
}
