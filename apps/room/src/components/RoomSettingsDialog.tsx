import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cleanGroup, ownCoverId, roomGroupMax, roomGroups, type CareSettings, type Room } from "../domain/model";
import { clearPicture, PictureError, setPicture, usePicture } from "../storage/pictures";
import { forgetRoom, listRooms, patchRoom } from "../storage/db";
import { canThumb, coverOf, useReadableFolders } from "../storage/thumbs";
import { faceColors, faceColorVar } from "../domain/face";
import { CoverPaper, faceHex, OwnCover } from "./RoomCover";
import { useModal } from "./useModal";
import { iconCoverId } from "../domain/icon";
import { useIcons } from "../storage/icons";
import { IconArt } from "./IconMaker";

const saveFailed = "저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.";
// 썸네일로 고를 수 있게 보여 주는 방 그림 수. 최근 것부터예요.
const coverChoices = 23;
const choicePx = 56;

type Draft = { name: string; care: CareSettings; cover: string | null; color: number; group: string };

// 홈에서 방을 우클릭해 여는 방 설정. 고친 것은 아래 저장을 눌러야 방에 들어가요. 저장하지 않고 닫으면 한 번 물어요.
export function RoomSettingsDialog({ room, onClose, onForgotten }: { room: Room; onClose: () => void; onForgotten: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const start: Draft = { name: room.name, care: room.care, cover: room.cover ?? null, color: room.face.color, group: room.group ?? "" };
  const [draft, setDraft] = useState<Draft>(start);
  const [nameDraft, setNameDraft] = useState(room.name);
  // 새로 고른 내 그림. 저장할 때 그림 저장소에 넣어요.
  const [upload, setUpload] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useModal(dialog);
  // 다른 방에 붙인 분류를 고를 수 있게 모아 둬요. 못 읽어도 직접 적을 수 있어요.
  const [groups, setGroups] = useState<string[]>([]);
  useEffect(() => {
    listRooms().then((rooms) => setGroups(roomGroups(rooms)), (cause: unknown) => console.error(cause));
  }, []);
  const folder = useReadableFolders([room]).get(room.id) ?? null;
  const own = ownCoverId(room.id);
  const savedOwnUrl = usePicture(own);
  const ownUrl = upload?.url ?? savedOwnUrl;
  useEffect(() => () => (upload ? URL.revokeObjectURL(upload.url) : undefined), [upload]);

  // 고를 수 있는 그림: 방에 있는 그릴 수 있는 파일, 최근 것부터. 지금 고른 파일이 목록 밖이면 앞에 둬요.
  const choices = useMemo(() => {
    const list = room.things.filter((thing) => !thing.box && canThumb(thing)).sort((a, b) => b.lastModified - a.lastModified);
    const shown = list.slice(0, coverChoices);
    const picked = list.find((thing) => thing.id === room.cover);
    return picked && !shown.includes(picked) ? [picked, ...shown.slice(0, -1)] : shown;
  }, [room.things, room.cover]);
  const auto = coverOf({ things: room.things, cover: null });
  const icons = useIcons();

  const changed = draft.name !== start.name || draft.care.done !== start.care.done || draft.care.staleAfterDays !== start.care.staleAfterDays || draft.cover !== start.cover || draft.color !== start.color || cleanGroup(draft.group) !== cleanGroup(start.group) || upload !== null;
  const tint = faceHex(draft.color);
  const onCare = (patch: Partial<CareSettings>) => setDraft((now) => ({ ...now, care: { ...now.care, ...patch } }));
  const days = (value: string) => Math.min(365, Math.max(1, Math.round(Number(value)) || 1));
  const pick = (cover: string | null) => {
    setError(null);
    setDraft((now) => ({ ...now, cover }));
  };

  function choose(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("그림 파일만 고를 수 있어요.");
    setUpload({ file, url: URL.createObjectURL(file) });
    pick(own);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (draft.cover === own && upload) await setPicture(room.id, own, upload.file);
      await patchRoom(room.id, (current) => ({ ...current, name: draft.name, care: draft.care, cover: draft.cover, face: { ...current.face, color: draft.color }, group: cleanGroup(draft.group) }));
      // 내 그림을 그만 쓰면 저장소에서도 지워요. 앱 저장소에만 있던 그림이에요.
      if (draft.cover !== own && savedOwnUrl) await clearPicture(room.id, own).catch((cause: unknown) => console.error(cause));
      onClose();
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof PictureError ? cause.message : saveFailed);
      setSaving(false);
    }
  }

  async function close() {
    if (changed && !(await window.confirm("고친 내용을 저장하지 않고 닫을까요?"))) return;
    onClose();
  }

  async function forget() {
    if (!(await window.confirm(`‘${room.name}’ 방을 Folduct에서 지울까요? 폴더와 파일은 그대로예요. 방 기록만 사라져요.`))) return;
    try {
      await forgetRoom(room.id);
      onForgotten();
    } catch (cause) {
      console.error(cause);
      setError("방을 지우지 못했어요. 잠시 뒤 다시 해 주세요.");
    }
  }

  return (
    <dialog
      ref={dialog}
      className="sheet settings"
      aria-labelledby="room-settings-title"
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
          <h2 id="room-settings-title">방 설정</h2>
        </header>
        {/* 모달이 열려 있으면 페이지 알림이 보이지 않아 오류는 창 안에 보여 줍니다. */}
        {error && <p className="banner danger" role="alert">{error}</p>}
        {/* 칸을 비우면 연 때의 이름으로 저장해요. 빈 이름은 폴더 이름으로 바뀌어 지은 이름이 사라졌어요. */}
        <label className="field">방 이름 <input value={nameDraft} maxLength={40} onChange={(event) => {
          setNameDraft(event.target.value);
          setDraft((now) => ({ ...now, name: event.target.value.trim() || room.name }));
        }} onBlur={() => setNameDraft(draft.name)} /></label>
        {!nameDraft.trim() && <p className="soft" role="status">비워 두면 ‘{room.name}’(으)로 돌아가요.</p>}
        {/* 방 분류: 직접 적거나 다른 방에 붙인 분류를 골라요. 홈 방 카드 줄 위 분류 칩으로 걸러 볼 수 있어요. */}
        <label className="field">방 분류 <input value={draft.group} maxLength={roomGroupMax} list="room-group-list" placeholder="예: 수업, 회사" onChange={(event) => {
          const group = event.target.value;
          setDraft((now) => ({ ...now, group }));
        }} /></label>
        <datalist id="room-group-list">{groups.map((name) => <option key={name} value={name} />)}</datalist>
        <p className="soft">홈 방 카드 위 분류로 걸러 볼 수 있어요. 비워 두면 분류 없음이에요.</p>
        {/* 방 색: 홈 방 카드 썸네일, 작업 시작 알약, 프로도 받침, 작업 기록 막대에 같이 쓰여요. */}
        <fieldset className="face-picker">
          <legend>방 색</legend>
          <div className="face-swatches" role="radiogroup" aria-label="방 색 고르기">
            {faceColors.map((name, color) => (
              <button key={name} type="button" role="radio" className="face-swatch" aria-checked={draft.color === color} aria-label={name} title={name} style={{ "--room-color": faceColorVar(color) } as CSSProperties} onClick={() => setDraft((now) => ({ ...now, color }))} />
            ))}
          </div>
        </fieldset>
        <fieldset className="cover-picker">
          <legend>방 썸네일</legend>
          <p className="soft">홈 방 카드에 보여요. 고르지 않으면 가장 최근 그림을 써요. 아이콘은 메뉴의 아이콘 만들기에서 만들어요.</p>
          <div className="cover-options" role="group" aria-label="방 썸네일 고르기" style={{ "--room-color": faceColorVar(draft.color) } as CSSProperties}>
            <button type="button" className="cover-option" aria-pressed={draft.cover === null} onClick={() => pick(null)}>
              {auto ? <CoverPaper thing={auto} folder={folder} px={choicePx} color={tint} /> : <span className="cover-empty" aria-hidden="true" />}
              <span>자동</span>
            </button>
            {ownUrl && (
              <button type="button" className="cover-option" aria-pressed={draft.cover === own} onClick={() => pick(own)}>
                <OwnCover seed={room.id} url={ownUrl} px={choicePx} color={tint} />
                <span>내 그림</span>
              </button>
            )}
            {icons.map((icon) => (
              <button key={icon.id} type="button" className="cover-option" aria-pressed={draft.cover === iconCoverId(icon.id)} title={icon.name} onClick={() => pick(iconCoverId(icon.id))}>
                <span className="room-cover icon-cover" aria-hidden="true"><IconArt icon={icon} px={choicePx} /></span>
                <span>{icon.name || "내 아이콘"}</span>
              </button>
            ))}
            {choices.map((thing) => (
              <button key={thing.id} type="button" className="cover-option" aria-pressed={draft.cover === thing.id} title={thing.name} onClick={() => pick(thing.id)}>
                <CoverPaper thing={thing} folder={folder} px={choicePx} color={tint} />
                <span>{thing.name}</span>
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" onClick={() => fileInput.current?.click()}>{ownUrl ? "다른 그림 올리기" : "내 그림 올리기"}</button>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => {
              choose(event.target.files?.[0]);
              event.target.value = "";
            }} />
          </div>
        </fieldset>
        <fieldset className="care">
          <legend>방 돌보기</legend>
          <div className="seg" role="radiogroup" aria-label="홈에 둘지">
            <label><input type="radio" name="room-status" checked={!draft.care.done} onChange={() => onCare({ done: false })} />홈에 둠</label>
            <label><input type="radio" name="room-status" checked={draft.care.done} onChange={() => onCare({ done: true })} />홈에서 뺌</label>
          </div>
          <p className="soft">{draft.care.done ? "홈에서 뺌: 주간 정리를 멈추고 메뉴의 방 목록으로 옮겨요" : "홈에 둠: 오래 안 쓴 물건은 주간 정리 때 정리 상자로 옮길지 물어요"}</p>
          <div className="row">
            <label>오래됨 기준 <input type="number" min={1} max={365} value={draft.care.staleAfterDays} onChange={(event) => onCare({ staleAfterDays: days(event.target.value) })} />일</label>
          </div>
        </fieldset>
        <button type="button" className="danger" aria-describedby="forget-note" onClick={() => void forget()}>Folduct에서 이 방 지우기</button>
        <p id="forget-note" className="soft">폴더와 파일은 그대로예요. 방 기록만 사라져요.</p>
        <div className="row end settings-foot">
          <button type="button" onClick={() => void close()}>닫기</button>
          <button type="button" className="primary" disabled={!changed || saving} onClick={() => void save()}>{saving ? "저장하는 중" : "저장"}</button>
        </div>
      </div>
    </dialog>
  );
}
