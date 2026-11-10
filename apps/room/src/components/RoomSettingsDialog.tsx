import { useRef, useState } from "react";
import { ductLength, kindParts } from "../art/duct";
import { roomUsage } from "../domain/care";
import type { CareSettings, Room } from "../domain/model";
import { forgetRoom, patchRoom } from "../storage/db";
import { FacePicker } from "./RoomFace";
import { cue } from "./useFrodo";
import { useModal } from "./useModal";

const saveFailed = "저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.";

// 홈에서 방을 우클릭해 여는 방 설정. 고칠 때마다 바로 저장하고, 닫으면 홈이 방 목록을 다시 읽어요.
export function RoomSettingsDialog({ room: initial, onClose, onForgotten }: { room: Room; onClose: () => void; onForgotten: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const [room, setRoom] = useState(initial);
  const [nameDraft, setNameDraft] = useState(initial.name);
  const [error, setError] = useState<string | null>(null);
  useModal(dialog);
  // 고르기 칸의 프로도도 방 화면처럼 용량만큼 길고, 다 읽은 방이면 형식 색 주름을 입어요.
  const usage = roomUsage(room);

  function change(mutate: (room: Room) => Room) {
    setRoom(mutate);
    setError(null);
    patchRoom(room.id, mutate).catch((cause: unknown) => {
      console.error(cause);
      setError(saveFailed);
    });
  }
  const onCare = (patch: Partial<CareSettings>) => change((current) => ({ ...current, care: { ...current.care, ...patch } }));
  const days = (value: string) => Math.min(365, Math.max(1, Math.round(Number(value)) || 1));

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
        onClose();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-body">
        <header className="menu-head">
          <h2 id="room-settings-title">방 설정</h2>
          <button type="button" className="quiet" onClick={onClose}>닫기</button>
        </header>
        {/* 모달이 열려 있으면 페이지 알림이 보이지 않아 오류는 창 안에 보여 줍니다. */}
        {error && <p className="banner danger" role="alert">{error}</p>}
        {/* 칸이 비어 있는 동안에는 연 때의 이름을 저장해 두고, 칸을 떠나면 그 이름으로 채워요. 빈 이름은 폴더 이름으로 바뀌어 지은 이름이 사라졌어요. */}
        <label className="field">방 이름 <input value={nameDraft} maxLength={40} onChange={(event) => {
          setNameDraft(event.target.value);
          change((current) => ({ ...current, name: event.target.value.trim() || initial.name }));
        }} onBlur={() => setNameDraft(room.name)} /></label>
        {!nameDraft.trim() && <p className="soft" role="status">비워 두면 ‘{initial.name}’(으)로 돌아가요.</p>}
        <FacePicker face={room.face} length={ductLength(usage.totalBytes)} parts={usage.exact ? kindParts(room.things) : []} onChange={(face) => {
          change((current) => ({ ...current, face }));
          cue(room.id, { body: "hop" });
        }} />
        <fieldset className="care">
          <legend>방 돌보기</legend>
          <div className="seg" role="radiogroup" aria-label="홈에 둘지">
            <label><input type="radio" name="room-status" checked={!room.care.done} onChange={() => onCare({ done: false })} />홈에 둠</label>
            <label><input type="radio" name="room-status" checked={room.care.done} onChange={() => onCare({ done: true })} />홈에서 뺌</label>
          </div>
          <p className="soft">{room.care.done ? "홈에서 뺌: 주간 정리를 멈추고 메뉴의 방 목록으로 옮겨요" : "홈에 둠: 오래 안 쓴 물건은 주간 정리 때 정리 상자로 옮길지 물어요"}</p>
          <div className="row">
            <label>오래됨 기준 <input type="number" min={1} max={365} value={room.care.staleAfterDays} onChange={(event) => onCare({ staleAfterDays: days(event.target.value) })} />일</label>
          </div>
        </fieldset>
        <button type="button" className="danger" aria-describedby="forget-note" onClick={() => void forget()}>Folduct에서 이 방 지우기</button>
        <p id="forget-note" className="soft">폴더와 파일은 그대로예요. 방 기록만 사라져요.</p>
      </div>
    </dialog>
  );
}
