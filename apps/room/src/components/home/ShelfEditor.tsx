import { useRef, useState, type CSSProperties } from "react";
import { colorGroups } from "../../art/palette";
import { kindLabels, type Kind } from "../../domain/model";
import { allKinds, cleanDrawers, shelfNameMax, uniqueName, type Drawer } from "../../domain/shelfViews";
import { Icon } from "../Icon";
import { useModal } from "../useModal";

const kindColor = (kind: Kind) => colorGroups.find((group) => group.kinds.includes(kind))?.color;
let made = 0;
const newId = () => `drawer-${Date.now().toString(36)}-${made++}`;

// 서랍장 고치기: 서랍 이름과 담을 형식을 고르고, 서랍을 더하거나 빼요. 새 서랍장이면 그 이름도 정해요.
// name이 undefined면 이름이 고정된 형식별 서랍장이에요. 저장하기 전까지는 서랍장에 반영하지 않아요.
export function ShelfEditor({ title, name, drawers, onSave, onDelete, onReset, onClose }: {
  title: string;
  name?: string;
  drawers: Drawer[];
  onSave: (name: string, drawers: Drawer[]) => void;
  onDelete?: () => void;
  onReset?: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [draftName, setDraftName] = useState(name ?? "");
  const [draft, setDraft] = useState(drawers);
  useModal(dialog);
  const patch = (id: string, change: Partial<Drawer>) => setDraft((current) => current.map((drawer) => (drawer.id === id ? { ...drawer, ...change } : drawer)));
  const add = () => {
    setDraft((current) => [...current, { id: newId(), name: uniqueName("새 서랍", current.map((drawer) => drawer.name)), kinds: [] }]);
    // 새 서랍의 이름 칸으로 바로 가요.
    requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>("li:last-child input[type=text]")?.select());
  };
  const unsorted = allKinds.filter((kind) => !draft.some((drawer) => drawer.kinds.includes(kind)));
  return (
    <dialog ref={dialog} className="sheet shelf-editor" aria-labelledby="shelf-editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form
        className="sheet-body"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draftName.trim() || "새 서랍장", cleanDrawers(draft));
        }}
      >
        <header className="row">
          <h2 id="shelf-editor-title">{title}</h2>
          <button type="button" className="quiet icon-close" aria-label="닫기" onClick={onClose}><Icon name="close" /></button>
        </header>
        {name !== undefined && (
          <label className="shelf-editor-name">
            <span>서랍장 이름</span>
            <input type="text" value={draftName} maxLength={shelfNameMax} placeholder="새 서랍장" onChange={(event) => setDraftName(event.target.value)} />
          </label>
        )}
        <p className="soft">서랍마다 담을 형식을 고르면 그 형식 파일이 저절로 모여요. 폴더와 파일은 그대로예요.</p>
        <ol ref={list} className="shelf-editor-drawers">
          {draft.map((drawer) => (
            <li key={drawer.id}>
              <div className="row">
                <input type="text" aria-label="서랍 이름" value={drawer.name} maxLength={shelfNameMax} placeholder="서랍" onChange={(event) => patch(drawer.id, { name: event.target.value })} />
                <button type="button" className="quiet" aria-label={`${drawer.name || "서랍"} 빼기`} onClick={() => setDraft((current) => current.filter((item) => item.id !== drawer.id))}>빼기</button>
              </div>
              <fieldset className="shelf-editor-kinds">
                <legend className="sr-only">{drawer.name || "서랍"}에 담을 형식</legend>
                {allKinds.map((kind) => (
                  <label key={kind} style={{ "--kind": kindColor(kind) } as CSSProperties}>
                    <input
                      type="checkbox"
                      checked={drawer.kinds.includes(kind)}
                      onChange={(event) => patch(drawer.id, { kinds: event.target.checked ? allKinds.filter((item) => item === kind || drawer.kinds.includes(item)) : drawer.kinds.filter((item) => item !== kind) })}
                    />
                    <span className="kind-dot" aria-hidden="true" />
                    {kindLabels[kind]}
                  </label>
                ))}
              </fieldset>
            </li>
          ))}
        </ol>
        <button type="button" className="shelf-editor-add" onClick={add}>+ 서랍 더하기</button>
        {unsorted.length > 0 && <p className="soft">어느 서랍에도 없는 형식: {unsorted.map((kind) => kindLabels[kind]).join(", ")}. 이 형식 파일은 이 서랍장에 안 보여요.</p>}
        <div className="row end">
          {onDelete && <button type="button" className="quiet" onClick={onDelete}>이 서랍장 지우기</button>}
          {onReset && <button type="button" className="quiet" onClick={onReset}>처음대로</button>}
          <button type="submit" className="primary">저장</button>
        </div>
      </form>
    </dialog>
  );
}
