import { useRef, useState } from "react";
import type { CareSettings, Room } from "../domain/model";
import { forgetRoom, patchRoom } from "../storage/db";
import { FrodoGuide } from "./FrodoGuide";
import { FacePicker } from "./RoomFace";
import { cue } from "./useFrodo";
import { useModal } from "./useModal";

const saveFailed = "저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.";

// 홈에서 방을 우클릭해 여는 방 설정. 고칠 때마다 바로 저장하고, 닫으면 홈이 방 목록을 다시 읽어요.
export function RoomSettingsDialog({ room: initial, onClose, onForgotten }: { room: Room; onClose: () => void; onForgotten: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const [room, setRoom] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useModal(dialog);

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
      <FrodoGuide />
      <div className="sheet-body">
        <header className="menu-head">
          <h2 id="room-settings-title">방 설정</h2>
          <button type="button" className="quiet" onClick={onClose}>닫기</button>
        </header>
        {/* 모달이 열려 있으면 페이지 알림이 보이지 않아 오류는 창 안에 보여 줍니다. */}
        {error && <p className="banner danger" role="alert">{error}</p>}
        <label className="field">방 이름 <input value={room.name} maxLength={40} onChange={(event) => change((current) => ({ ...current, name: event.target.value }))} /></label>
        <FacePicker face={room.face} onChange={(face) => {
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
        <button type="button" className="danger" onClick={() => void forget()}>이 방을 Folduct에서 지우기 (파일은 그대로)</button>
      </div>
    </dialog>
  );
}
