import { useMemo, useRef, useState, type CSSProperties } from "react";
import { colorGroups } from "../../art/palette";
import { formatBytes, kindLabels, type Kind } from "../../domain/model";
import { drawerStats, extCounts, kindCounts, leftoverItems, type ShelfItem } from "../../domain/shelves";
import { allKinds, cleanDrawers, parseExts, shelfNameMax, uniqueName, type Drawer } from "../../domain/shelfViews";
import { Icon } from "../Icon";
import { useModal } from "../useModal";

const kindColor = (kind: Kind) => colorGroups.find((group) => group.kinds.includes(kind))?.color;
const kindStyle = (kind: Kind) => ({ "--kind": kindColor(kind) }) as CSSProperties;
const countText = (count: number) => count.toLocaleString("ko-KR");
let made = 0;
const newId = () => `drawer-${Date.now().toString(36)}-${made++}`;
// 숫자 칸: 비었거나 0 이하면 조건을 빼요.
const amount = (text: string) => {
  const value = Number(text);
  return text.trim() && Number.isFinite(value) && value > 0 ? value : undefined;
};
// 확장자 칩은 많은 것부터 이만큼만 보여 줘요. 고른 것은 늘 보여요.
const extShown = 12;
// 영상 길이는 영상을 고르거나 형식을 안 골랐을 때만 걸 수 있어요.
const canLength = (drawer: Drawer) => drawer.kinds.length === 0 || drawer.kinds.includes("video");

// 서랍장 편집: 서랍마다 한 줄(색 점·이름·담길 개수), 누른 서랍 하나만 펼쳐 형식·확장자·크기·길이를 골라요.
// 고르는 대로 지금 방 파일로 담길 개수를 바로 셈하고, 어느 서랍에도 없는 파일은 맨 아래 줄로 보여 줘요.
// name이 undefined면 이름이 고정된 형식별 서랍장이에요. 저장하기 전까지는 서랍장에 반영하지 않아요.
export function ShelfEditor({ title, name, drawers, items, seconds, onSave, onDelete, onReset, onClose }: {
  title: string;
  name?: string;
  drawers: Drawer[];
  items: ShelfItem[];
  seconds: Map<string, number | null>;
  onSave: (name: string, drawers: Drawer[]) => void;
  onDelete?: () => void;
  onReset?: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [draftName, setDraftName] = useState(name ?? "");
  const [draft, setDraft] = useState(drawers);
  // 서랍이 하나면 처음부터 펼쳐요.
  const [openId, setOpenId] = useState<string | null>(drawers.length === 1 ? drawers[0].id : null);
  // 확장자 칸에 쓰는 중인 글. 쉼표·띄어쓰기·Enter에서 칩이 돼요.
  const [extTyping, setExtTyping] = useState("");
  const [initial] = useState(() => JSON.stringify([name ?? "", drawers]));
  useModal(dialog);
  const dirty = JSON.stringify([draftName, draft]) !== initial;
  const kinds = useMemo(() => kindCounts(items), [items]);
  const leftovers = leftoverItems(draft, items, seconds);
  const leftKinds = allKinds.filter((kind) => leftovers.some((item) => item.thing.kind === kind));

  const patch = (id: string, change: Partial<Drawer>) => setDraft((current) => current.map((drawer) => (drawer.id === id ? { ...drawer, ...change } : drawer)));
  const open = (id: string | null) => {
    setOpenId(id);
    setExtTyping("");
  };
  const add = (kindsOf: Kind[] = [], label = "새 서랍") => {
    const id = newId();
    setDraft((current) => [...current, { id, name: uniqueName(label, current.map((drawer) => drawer.name)), kinds: kindsOf }]);
    open(id);
    // 새 서랍의 이름 칸으로 바로 가요.
    requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>("[data-open] .shelf-editor-field input")?.select());
  };
  const move = (index: number, by: number) =>
    setDraft((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  const toggleKind = (drawer: Drawer, kind: Kind) => {
    const kindsNext = drawer.kinds.includes(kind) ? drawer.kinds.filter((item) => item !== kind) : allKinds.filter((item) => item === kind || drawer.kinds.includes(item));
    // 영상이 빠지면 영상 길이 조건도 함께 빠져요. 안 보이는 조건이 몰래 거르지 않게요.
    const lengthGone = kindsNext.length > 0 && !kindsNext.includes("video");
    patch(drawer.id, lengthGone ? { kinds: kindsNext, minMin: undefined, maxMin: undefined } : { kinds: kindsNext });
  };
  const addExts = (drawer: Drawer, text: string) => {
    const more = parseExts(text);
    if (more.length > 0) patch(drawer.id, { exts: [...new Set([...(drawer.exts ?? []), ...more])] });
    setExtTyping("");
  };
  const toggleExt = (drawer: Drawer, ext: string) => {
    const exts = drawer.exts ?? [];
    patch(drawer.id, { exts: exts.includes(ext) ? exts.filter((item) => item !== ext) : [...exts, ext] });
  };

  return (
    <dialog ref={dialog} className="sheet shelf-editor" aria-labelledby="shelf-editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <form
        className="sheet-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) onSave(draftName.trim() || "새 서랍장", cleanDrawers(draft));
          else onClose();
        }}
      >
        <header className="shelf-editor-head">
          {name !== undefined ? (
            <input id="shelf-editor-title" className="shelf-editor-title" type="text" aria-label="서랍장 이름" value={draftName} maxLength={shelfNameMax} placeholder="새 서랍장" onChange={(event) => setDraftName(event.target.value)} />
          ) : (
            <h2 id="shelf-editor-title">{title}</h2>
          )}
          <button type="button" className="quiet icon-close" aria-label="닫기" onClick={onClose}><Icon name="close" /></button>
        </header>

        <div className="shelf-editor-scroll">
          <ol ref={list} className="shelf-editor-drawers">
            {draft.map((drawer, index) => {
              const isOpen = openId === drawer.id;
              const stats = drawerStats(drawer, items, seconds);
              const exts = drawer.exts ?? [];
              const found = extCounts(items, drawer.kinds).slice(0, extShown);
              const extChips: [string, number][] = [...found, ...exts.filter((ext) => !found.some(([item]) => item === ext)).map((ext): [string, number] => [ext, extCounts(items, drawer.kinds).find(([item]) => item === ext)?.[1] ?? 0])];
              const label = drawer.name.trim() || "이름 없는 서랍";
              return (
                <li key={drawer.id} data-open={isOpen || undefined}>
                  <button type="button" className="shelf-editor-row" aria-expanded={isOpen} onClick={() => open(isOpen ? null : drawer.id)}>
                    <span className="shelf-editor-dots" aria-hidden="true">
                      {drawer.kinds.length === 0 ? <span className="kind-dot empty" /> : drawer.kinds.map((kind) => <span key={kind} className="kind-dot" style={kindStyle(kind)} />)}
                    </span>
                    <span className="shelf-editor-row-name">{label}</span>
                    <span className="shelf-editor-row-meta">{stats.count > 0 ? `${countText(stats.count)}개 · ${formatBytes(stats.size)}` : "비어 있어요"}</span>
                    <span className="shelf-editor-chevron" aria-hidden="true"><Icon name="chevron" /></span>
                  </button>
                  {isOpen && (
                    <div className="shelf-editor-detail">
                      <label className="shelf-editor-field">
                        <span>이름</span>
                        <input type="text" value={drawer.name} maxLength={shelfNameMax} placeholder="서랍" onChange={(event) => patch(drawer.id, { name: event.target.value })} />
                      </label>
                      <fieldset className="shelf-editor-field">
                        <legend>형식</legend>
                        <div className="shelf-editor-chips">
                          {allKinds.map((kind) => (
                            <label key={kind} className="shelf-editor-chip" style={kindStyle(kind)}>
                              <input type="checkbox" checked={drawer.kinds.includes(kind)} onChange={() => toggleKind(drawer, kind)} />
                              <span className="kind-dot" aria-hidden="true" />
                              {kindLabels[kind]}
                              <small>{countText(kinds.get(kind) ?? 0)}</small>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <fieldset className="shelf-editor-field">
                        <legend>확장자</legend>
                        <div className="shelf-editor-chips">
                          {extChips.map(([ext, count]) => (
                            <label key={ext} className="shelf-editor-chip">
                              <input type="checkbox" checked={exts.includes(ext)} onChange={() => toggleExt(drawer, ext)} />
                              .{ext}
                              <small>{countText(count)}</small>
                            </label>
                          ))}
                          <input
                            className="shelf-editor-ext-input"
                            type="text"
                            aria-label="확장자 더하기"
                            placeholder={extChips.length > 0 ? "더하기" : "ts, py"}
                            value={extTyping}
                            onChange={(event) => (/[\s,]$/.test(event.target.value) ? addExts(drawer, event.target.value) : setExtTyping(event.target.value))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addExts(drawer, extTyping);
                              }
                            }}
                            onBlur={() => addExts(drawer, extTyping)}
                          />
                        </div>
                      </fieldset>
                      <fieldset className="shelf-editor-field">
                        <legend>크기</legend>
                        <span className="shelf-editor-range">
                          <input type="number" min="0" step="any" inputMode="decimal" aria-label="크기 이상(MB)" placeholder="이상" value={drawer.minMB ?? ""} onChange={(event) => patch(drawer.id, { minMB: amount(event.target.value) })} />
                          <span aria-hidden="true">~</span>
                          <input type="number" min="0" step="any" inputMode="decimal" aria-label="크기 미만(MB)" placeholder="미만" value={drawer.maxMB ?? ""} onChange={(event) => patch(drawer.id, { maxMB: amount(event.target.value) })} />
                          <span>MB</span>
                        </span>
                      </fieldset>
                      {canLength(drawer) && (
                        <fieldset className="shelf-editor-field">
                          <legend>영상 길이</legend>
                          <span className="shelf-editor-range">
                            <input type="number" min="0" step="any" inputMode="decimal" aria-label="영상 길이 이상(분)" placeholder="이상" value={drawer.minMin ?? ""} onChange={(event) => patch(drawer.id, { minMin: amount(event.target.value) })} />
                            <span aria-hidden="true">~</span>
                            <input type="number" min="0" step="any" inputMode="decimal" aria-label="영상 길이 미만(분)" placeholder="미만" value={drawer.maxMin ?? ""} onChange={(event) => patch(drawer.id, { maxMin: amount(event.target.value) })} />
                            <span>분</span>
                          </span>
                        </fieldset>
                      )}
                      <div className="shelf-editor-detail-foot">
                        <button type="button" className="quiet shelf-editor-move up" aria-label={`${label} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><Icon name="chevron" /></button>
                        <button type="button" className="quiet shelf-editor-move down" aria-label={`${label} 아래로`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}><Icon name="chevron" /></button>
                        <button type="button" className="quiet shelf-editor-remove" onClick={() => { setDraft((current) => current.filter((item) => item.id !== drawer.id)); open(null); }}>서랍 빼기</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <button type="button" className="shelf-editor-add" onClick={() => add()}>+ 서랍 더하기</button>
          {leftovers.length > 0 && (
            <div className="shelf-editor-left" role="status">
              <span className="shelf-editor-dots" aria-hidden="true">{leftKinds.map((kind) => <span key={kind} className="kind-dot" style={kindStyle(kind)} />)}</span>
              <span>어느 서랍에도 없는 파일 <b>{countText(leftovers.length)}개</b></span>
              <button type="button" className="quiet" onClick={() => add(leftKinds, leftKinds.length === 1 ? kindLabels[leftKinds[0]] : "기타")}>서랍으로 만들기</button>
            </div>
          )}
        </div>

        <footer className="shelf-editor-foot">
          {onDelete && <button type="button" className="quiet shelf-editor-remove" onClick={onDelete}>서랍장 지우기</button>}
          {onReset && <button type="button" className="quiet" onClick={onReset}>처음대로</button>}
          <span className="shelf-editor-spacer" />
          <button type="button" className="quiet" onClick={onClose}>취소</button>
          <button type="submit" className="primary" disabled={!dirty}>저장</button>
        </footer>
      </form>
    </dialog>
  );
}
