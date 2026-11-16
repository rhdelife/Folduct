import { useRef, useState, type CSSProperties } from "react";
import { colorGroups } from "../../art/palette";
import { kindLabels, type Kind } from "../../domain/model";
import { allKinds, cleanDrawers, parseExts, shelfNameMax, uniqueName, type Drawer } from "../../domain/shelfViews";
import { Icon } from "../Icon";
import { useModal } from "../useModal";

const kindColor = (kind: Kind) => colorGroups.find((group) => group.kinds.includes(kind))?.color;
let made = 0;
const newId = () => `drawer-${Date.now().toString(36)}-${made++}`;
// 숫자 칸: 비었거나 0 이하면 조건을 빼요.
const amount = (text: string) => {
  const value = Number(text);
  return text.trim() && Number.isFinite(value) && value > 0 ? value : undefined;
};
// 형식 말고 더 걸 수 있는 조건. 단추로 꺼내고 X로 지워요.
type Cond = "exts" | "size" | "length";
const conds: { key: Cond; label: string }[] = [{ key: "exts", label: "확장자" }, { key: "size", label: "크기" }, { key: "length", label: "영상 길이" }];
const condsOf = (drawer: Drawer): Cond[] => [
  ...((drawer.exts?.length ?? 0) > 0 ? (["exts"] as const) : []),
  ...(drawer.minMB !== undefined || drawer.maxMB !== undefined ? (["size"] as const) : []),
  ...(drawer.minMin !== undefined || drawer.maxMin !== undefined ? (["length"] as const) : []),
];

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
  // 확장자 칸은 쓰는 중인 글 그대로 두고, 저장할 때 다듬어요.
  const [extText, setExtText] = useState<Record<string, string>>(() => Object.fromEntries(drawers.map((drawer) => [drawer.id, (drawer.exts ?? []).join(", ")])));
  const [shown, setShown] = useState<Record<string, Cond[]>>(() => Object.fromEntries(drawers.map((drawer) => [drawer.id, condsOf(drawer)])));
  useModal(dialog);
  const showCond = (id: string, cond: Cond) => setShown((current) => ({ ...current, [id]: [...(current[id] ?? []), cond] }));
  const dropCond = (id: string, cond: Cond) => {
    setShown((current) => ({ ...current, [id]: (current[id] ?? []).filter((item) => item !== cond) }));
    if (cond === "exts") setExtText((current) => ({ ...current, [id]: "" }));
    else patch(id, cond === "size" ? { minMB: undefined, maxMB: undefined } : { minMin: undefined, maxMin: undefined });
  };
  const patch = (id: string, change: Partial<Drawer>) => setDraft((current) => current.map((drawer) => (drawer.id === id ? { ...drawer, ...change } : drawer)));
  const add = () => {
    const id = newId();
    setDraft((current) => [...current, { id, name: uniqueName("새 서랍", current.map((drawer) => drawer.name)), kinds: [] }]);
    setExtText((current) => ({ ...current, [id]: "" }));
    setShown((current) => ({ ...current, [id]: [] }));
    // 새 서랍의 이름 칸으로 바로 가요.
    requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>("li:last-child input[type=text]")?.select());
  };
  return (
    <dialog ref={dialog} className="sheet shelf-editor" aria-labelledby="shelf-editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form
        className="sheet-body"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draftName.trim() || "새 서랍장", cleanDrawers(draft.map((drawer) => ({ ...drawer, exts: parseExts(extText[drawer.id] ?? "") }))));
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
        <ol ref={list} className="shelf-editor-drawers">
          {draft.map((drawer) => (
            <li key={drawer.id}>
              <div className="row">
                <input type="text" aria-label="서랍 이름" value={drawer.name} maxLength={shelfNameMax} placeholder="서랍" onChange={(event) => patch(drawer.id, { name: event.target.value })} />
                <button type="button" className="quiet icon-close" aria-label={`${drawer.name || "서랍"} 빼기`} onClick={() => setDraft((current) => current.filter((item) => item.id !== drawer.id))}><Icon name="close" /></button>
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
              {(shown[drawer.id] ?? []).map((cond) => (
                <div key={cond} className="shelf-editor-cond" role="group" aria-label={conds.find((item) => item.key === cond)?.label}>
                  <span>{conds.find((item) => item.key === cond)?.label}</span>
                  {cond === "exts" ? (
                    <input type="text" aria-label="확장자" value={extText[drawer.id] ?? ""} placeholder="ts, tsx, py" onChange={(event) => setExtText((current) => ({ ...current, [drawer.id]: event.target.value }))} />
                  ) : (
                    <span className="shelf-editor-range">
                      <input type="number" min="0" step="any" inputMode="decimal" aria-label="이상" placeholder="이상" value={(cond === "size" ? drawer.minMB : drawer.minMin) ?? ""} onChange={(event) => patch(drawer.id, cond === "size" ? { minMB: amount(event.target.value) } : { minMin: amount(event.target.value) })} />
                      <span aria-hidden="true">~</span>
                      <input type="number" min="0" step="any" inputMode="decimal" aria-label="미만" placeholder="미만" value={(cond === "size" ? drawer.maxMB : drawer.maxMin) ?? ""} onChange={(event) => patch(drawer.id, cond === "size" ? { maxMB: amount(event.target.value) } : { maxMin: amount(event.target.value) })} />
                      <span>{cond === "size" ? "MB" : "분"}</span>
                    </span>
                  )}
                  <button type="button" className="quiet icon-close" aria-label={`${conds.find((item) => item.key === cond)?.label} 조건 빼기`} onClick={() => dropCond(drawer.id, cond)}><Icon name="close" /></button>
                </div>
              ))}
              {conds.some((cond) => !(shown[drawer.id] ?? []).includes(cond.key)) && (
                <div className="shelf-editor-addcond">
                  {conds.filter((cond) => !(shown[drawer.id] ?? []).includes(cond.key)).map((cond) => (
                    <button key={cond.key} type="button" onClick={() => showCond(drawer.id, cond.key)}>+ {cond.label}</button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
        <button type="button" className="shelf-editor-add" onClick={add}>+ 서랍 더하기</button>
        <div className="row end">
          {onDelete && <button type="button" className="quiet" onClick={onDelete}>이 서랍장 지우기</button>}
          {onReset && <button type="button" className="quiet" onClick={onReset}>처음대로</button>}
          <button type="submit" className="primary">저장</button>
        </div>
      </form>
    </dialog>
  );
}
