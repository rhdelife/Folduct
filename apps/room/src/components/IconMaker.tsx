import { useRef, useState, type CSSProperties } from "react";
import { ductShapeCount } from "../art/duct";
import { faceColors, faceColorVar } from "../domain/face";
import { iconExprs, iconLimit, iconNameMax, newIcon, type DuctIcon } from "../domain/icon";
import { saveIcons, useIcons } from "../storage/icons";
import { Icon } from "./Icon";
import { RoomFaceArt } from "./RoomFace";
import { useModal } from "./useModal";

const shapes = Array.from({ length: ductShapeCount }, (_, shape) => shape);

// 프로도 그림 하나. 방 그림과 같은 펜(drawRoom)이라 아이콘도 프로도 그림체예요.
export function IconArt({ icon, px, className }: { icon: Pick<DuctIcon, "shape" | "color" | "length" | "expr">; px: number; className?: string }) {
  return <RoomFaceArt face={{ shape: icon.shape, color: icon.color }} length={icon.length} mood={icon.expr} px={px} className={className} sheet />;
}

// 메뉴에서 여는 아이콘 만들기와 보관함. 모양·길이·표정·색을 골라 저장하면 방 설정의 방 썸네일로 고를 수 있어요.
export function IconMaker({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  useModal(dialog);
  const icons = useIcons();
  const [draft, setDraft] = useState<DuctIcon>(() => newIcon(crypto.randomUUID(), Date.now()));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = icons.find((icon) => icon.id === draft.id);
  const changed = !saved || JSON.stringify(saved) !== JSON.stringify(draft);
  const full = !saved && icons.length >= iconLimit;
  const set = (patch: Partial<DuctIcon>) => setDraft((now) => ({ ...now, ...patch }));

  async function write(next: DuctIcon[]) {
    setSaving(true);
    setError(null);
    try {
      await saveIcons(next);
      return true;
    } catch (cause) {
      console.error(cause);
      setError("저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const icon = { ...draft, name: draft.name.trim() };
    if (await write(saved ? icons.map((item) => (item.id === icon.id ? icon : item)) : [icon, ...icons])) setDraft(icon);
  }

  async function remove() {
    if (!saved || !(await window.confirm(`‘${saved.name || "이름 없는 아이콘"}’을 보관함에서 지울까요? 이 아이콘을 쓰던 방은 자동 썸네일로 돌아가요.`))) return;
    if (await write(icons.filter((item) => item.id !== saved.id))) setDraft(newIcon(crypto.randomUUID(), Date.now()));
  }

  // 앱(Tauri)에서는 confirm이 약속(Promise)으로 와서 기다려요.
  async function open(next: DuctIcon) {
    if (changed && saved && !(await window.confirm("고친 내용을 저장하지 않고 다른 아이콘을 열까요?"))) return;
    setError(null);
    setDraft(next);
  }

  async function close() {
    if (changed && (saved || draft.name.trim()) && !(await window.confirm("고친 내용을 저장하지 않고 닫을까요?"))) return;
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      className="sheet settings icon-maker"
      aria-labelledby="icon-maker-title"
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
          <h2 id="icon-maker-title">아이콘 만들기</h2>
          <button type="button" className="quiet icon-close" aria-label="닫기" onClick={() => void close()}><Icon name="close" /></button>
        </header>
        {error && <p className="banner danger" role="alert">{error}</p>}
        <div className="icon-stage" style={{ "--room-color": faceColorVar(draft.color) } as CSSProperties}>
          <IconArt icon={draft} px={160} className="icon-preview" />
        </div>
        <label className="field">이름 <input value={draft.name} maxLength={iconNameMax} placeholder="예: 졸업 작품" onChange={(event) => set({ name: event.target.value })} /></label>
        <fieldset className="face-picker">
          <legend>모양</legend>
          <div className="icon-shapes" role="radiogroup" aria-label="모양 고르기">
            {shapes.map((shape) => (
              <button key={shape} type="button" role="radio" className="cover-option" aria-checked={draft.shape === shape} aria-label={`모양 ${shape + 1}`} onClick={() => set({ shape })}>
                <IconArt icon={{ ...draft, shape }} px={40} />
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">길이 <input type="range" min={0} max={1} step={0.05} value={draft.length} onChange={(event) => set({ length: Number(event.target.value) })} /></label>
        <fieldset className="face-picker">
          <legend>표정</legend>
          <div className="seg icon-exprs" role="radiogroup" aria-label="표정 고르기">
            {iconExprs.map(({ expr, label }) => (
              <label key={expr}><input type="radio" name="icon-expr" checked={draft.expr === expr} onChange={() => set({ expr })} />{label}</label>
            ))}
          </div>
        </fieldset>
        <fieldset className="face-picker">
          <legend>받침 색</legend>
          <div className="face-swatches" role="radiogroup" aria-label="받침 색 고르기">
            {faceColors.map((name, color) => (
              <button key={name} type="button" role="radio" className="face-swatch" aria-checked={draft.color === color} aria-label={name} title={name} style={{ "--room-color": faceColorVar(color) } as CSSProperties} onClick={() => set({ color })} />
            ))}
          </div>
        </fieldset>
        <section className="cover-picker" aria-labelledby="icon-archive-title">
          <h3 id="icon-archive-title">보관함 {icons.length}개</h3>
          {icons.length === 0 ? (
            <p className="soft">저장한 아이콘이 여기 모여요. 방 설정에서 방 썸네일로 고를 수 있어요.</p>
          ) : (
            <div className="cover-options" role="group" aria-label="보관한 아이콘">
              {icons.map((icon) => (
                <button key={icon.id} type="button" className="cover-option" aria-pressed={icon.id === draft.id} onClick={() => void open(icon)}>
                  <IconArt icon={icon} px={48} />
                  <span>{icon.name || "이름 없음"}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        {full && <p className="soft" role="status">보관함이 가득 찼어요({iconLimit}개). 하나를 지우면 새로 넣을 수 있어요.</p>}
        <div className="row end settings-foot">
          {saved && <button type="button" className="danger" disabled={saving} onClick={() => void remove()}>보관함에서 지우기</button>}
          <button type="button" disabled={saving} onClick={() => void open(newIcon(crypto.randomUUID(), Date.now()))}>새로 만들기</button>
          <button type="button" className="primary" disabled={!changed || saving || full} onClick={() => void save()}>{saving ? "저장하는 중" : saved ? "고친 것 저장" : "보관함에 저장"}</button>
        </div>
      </div>
    </dialog>
  );
}
