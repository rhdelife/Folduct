import { useEffect, useRef, useState } from "react";
import { removeFolder, type Doorstep } from "../domain/doorstep";
import { folderName, isNative, pickRoomFolder } from "../gateways/native";
import { getIntroOn, patchDoorstep, setIntroOn } from "../storage/db";
import { addDoorFolder } from "../storage/doorstep";
import { useModal } from "./useModal";

export function SettingsDialog({ doorstep, onDoorstep, onClose, onError }: { doorstep: Doorstep; onDoorstep: (state: Doorstep) => void; onClose: () => void; onError: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const [introOn, setOn] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [doorError, setDoorError] = useState<string | null>(null);
  useModal(dialog);

  useEffect(() => {
    getIntroOn().then(setOn, (error: unknown) => {
      console.error(error);
      onError("설정을 읽지 못했어요. 잠시 뒤 다시 해 주세요.");
    });
  }, [onError]);

  function toggle(on: boolean) {
    setOn(on);
    setIntroOn(on).catch((error: unknown) => {
      console.error(error);
      setOn(!on);
      onError("설정을 저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.");
    });
  }

  // 모달이 열려 있으면 페이지 알림이 보이지 않아 현관 오류는 창 안에 보여 줍니다.
  async function addDoor() {
    setDoorError(null);
    setAdding(true);
    try {
      const folder = await pickRoomFolder();
      if (!folder) return;
      const { state, error } = await addDoorFolder(folder);
      onDoorstep(state);
      setDoorError(error);
    } catch (error) {
      console.error(error);
      setDoorError("폴더를 읽지 못했어요. 권한을 확인해 주세요.");
    } finally {
      setAdding(false);
    }
  }

  async function removeDoor(folder: string) {
    setDoorError(null);
    try {
      onDoorstep(await patchDoorstep((state) => removeFolder(state, folder)));
      // 누른 버튼이 사라지니 포커스를 옮깁니다.
      addButton.current?.focus();
    } catch (error) {
      console.error(error);
      setDoorError("저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.");
    }
  }

  return (
    <dialog
      ref={dialog}
      className="sheet settings"
      aria-labelledby="settings-title"
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
          <h2 id="settings-title">환경설정</h2>
          <button type="button" className="quiet" onClick={onClose}>닫기</button>
        </header>
        <label className="setting-row">
          <span>
            <strong>인트로</strong>
            <small>앱을 켤 때 파일을 화병에 담는 장면을 보여 줘요.</small>
          </span>
          <input type="checkbox" role="switch" checked={introOn ?? false} disabled={introOn === null} onChange={(event) => toggle(event.target.checked)} />
        </label>
        {isNative() && (
          <section className="setting-door" aria-labelledby="setting-door-title">
            <div>
              <strong id="setting-door-title">현관</strong>
              <small>고른 폴더에 새로 생긴 문서를 첫 화면 위쪽에 모아 줘요. 방을 고른 문서만 옮겨요.</small>
            </div>
            {doorstep.folders.length > 0 && (
              <ul>
                {doorstep.folders.map((folder) => (
                  <li key={folder}>
                    <span className="door-folder" title={folder}>{folderName(folder).normalize("NFC")}</span>
                    <button type="button" className="quiet" aria-label={`${folderName(folder).normalize("NFC")} 폴더 빼기`} onClick={() => void removeDoor(folder)}>빼기</button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" ref={addButton} disabled={adding} onClick={() => void addDoor()}>{adding ? "읽는 중…" : "폴더 더하기"}</button>
            {doorError && <p className="error" role="alert">{doorError}</p>}
          </section>
        )}
      </div>
    </dialog>
  );
}
