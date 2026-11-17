import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { isNative } from "../gateways/native";
import { useModal } from "./useModal";

// 작업 시간을 재는 중에 끄려고 하면 Rust(ask_quit)가 메인 창을 앞으로 데려와 'quit-asked'를 보내요. 그때 뜨는 Folduct 모달이에요(2026-11-17 요청, OS 알림 창 대신).
// 끄기를 고르면 quit_answer가 앱을 끄고, 계속 작업이나 Esc면 그대로 둬요.
export function QuitConfirm() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isNative()) return;
    let left = false;
    let stop = () => {};
    void listen("quit-asked", () => setOpen(true)).then((unlisten) => (left ? unlisten() : (stop = unlisten)));
    return () => {
      left = true;
      stop();
    };
  }, []);
  if (!open) return null;
  return (
    <QuitSheet
      onAnswer={(quit) => {
        setOpen(false);
        invoke("quit_answer", { quit }).catch((error: unknown) => console.error(error));
      }}
    />
  );
}

function QuitSheet({ onAnswer }: { onAnswer: (quit: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog);
  return (
    <dialog
      ref={dialog}
      className="sheet quit-sheet"
      aria-labelledby="quit-title"
      aria-describedby="quit-text"
      onCancel={(event) => {
        event.preventDefault();
        onAnswer(false);
      }}
    >
      <div className="sheet-body">
        <h2 id="quit-title">작업 중에 끌까요?</h2>
        <p id="quit-text" className="soft">끄면 작업 시간 재기가 멈춰요.</p>
        <div className="quit-actions">
          {/* 실수로 끄지 않게 계속 작업을 앞에 둬 먼저 포커스를 받아요(showModal이 첫 단추에 포커스를 줘요). */}
          <button type="button" className="primary" onClick={() => onAnswer(false)}>계속 작업</button>
          <button type="button" onClick={() => onAnswer(true)}>끄기</button>
        </div>
      </div>
    </dialog>
  );
}
