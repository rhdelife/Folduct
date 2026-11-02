import { useEffect, useRef, useState, type FormEvent } from "react";
import { localDay, mergeScan } from "../domain/care";
import { buildRoom, doneAfterDays, looksDone } from "../domain/importFile";
import { formatBytes, type Room, type RoomSource } from "../domain/model";
import { canPickFolder, pickFolder, scanFileList, type ScanResult } from "../gateways/folder";
import { allowRooms, folderName, isNative, pickParent, sameFolder, scanRoomFolder, type ChildFolder } from "../gateways/native";
import { getHandle, listRooms, saveHandle, saveRoom } from "../storage/db";
import { BudgetPicker } from "./Capacity";
import { useModal } from "./useModal";

type Draft = { source: RoomSource; rootName: string; handle: FileSystemDirectoryHandle | null; scan: ScanResult };

export function NewRoomDialog({ onClose, onCreated, onOpenExisting, onCreatedMany }: { onClose: () => void; onCreated: (id: string) => void; onOpenExisting: (id: string) => void; onCreatedMany: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"pick" | "scanning" | "confirm">("pick");
  const [count, setCount] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  // handle이 있으면 이름만 같은 보기 전용 방이라, 그래도 새 방으로 만들 수 있게 고른 폴더를 들고 있습니다.
  const [same, setSame] = useState<{ room: Room; handle: FileSystemDirectoryHandle | null } | null>(null);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 데스크톱: 상위 폴더 하나를 고르고, 그 안의 폴더 여러 개를 한 번에 방으로 만듭니다.
  const [parent, setParent] = useState<{ path: string; folders: ChildFolder[] } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [known, setKnown] = useState<Room[]>([]);
  const scanning = useRef<HTMLParagraphElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useModal(dialog);

  // 누른 버튼이 사라지니 세는 중 문구로 포커스를 옮깁니다.
  useEffect(() => {
    if (step === "scanning") scanning.current?.focus();
  }, [step]);

  function readFailed() {
    setStep("pick");
    setError("폴더를 읽지 못했어요. 다른 폴더를 골라 주세요.");
  }

  async function pick() {
    setError(null);
    try {
      const handle = await pickFolder();
      if (!handle) return;
      let named: Room | null = null;
      for (const room of await listRooms()) {
        const existing = room.source === "handle" ? await getHandle(room.id) : null;
        if (existing && (await existing.isSameEntry(handle))) return setSame({ room, handle: null });
        // 보기 전용 방은 핸들이 없어 이름으로만 견줄 수 있습니다. 그래서 잇지 않고 묻습니다.
        if (!named && room.source === "input" && room.rootName.normalize("NFC") === handle.name.normalize("NFC")) named = room;
      }
      if (named) return setSame({ room: named, handle });
      await scanPicked(handle);
    } catch {
      readFailed();
    }
  }

  async function scanPicked(handle: FileSystemDirectoryHandle) {
    setSame(null);
    setStep("scanning");
    try {
      const scan = await scanRoomFolder(handle, setCount);
      ready({ source: "handle", rootName: handle.name, handle, scan });
    } catch {
      readFailed();
    }
  }

  async function pickParentFolder() {
    setError(null);
    try {
      const picked = await pickParent();
      if (!picked) return;
      setKnown(await listRooms());
      setChosen(new Set());
      setParent(picked);
    } catch {
      setError("폴더를 읽지 못했어요. 다른 폴더를 골라 주세요.");
    }
  }

  // 같은 경로의 방이 이미 있으면 새로 만들지 않고 다시 봅니다(메모·자리 유지). 가져오기로 만든 보기 전용 방도 여기서 실제 폴더와 이어집니다.
  async function createMany(event: FormEvent) {
    event.preventDefault();
    if (!parent) return;
    const picks = parent.folders.filter((folder) => chosen.has(folder.path));
    setStep("scanning");
    setCount(0);
    try {
      await allowRooms(picks.map((folder) => folder.path));
    } catch {
      setStep("pick");
      setError("고른 폴더를 열 권한을 받지 못했어요. 상위 폴더를 다시 골라 주세요.");
      return;
    }
    const at = Date.now();
    const taken = known.map((room) => room.face);
    let added = 0;
    let refreshed = 0;
    let done = 0;
    let failed = 0;
    let counted = 0;
    for (const folder of picks) {
      try {
        const scan = await scanRoomFolder(folder.path, (n) => setCount(counted + n));
        counted += scan.files.length;
        const old = known.find((room) => sameFolder(room.origin, folder.path));
        if (old) {
          await saveRoom({ ...mergeScan(old, scan.files, scan, at), source: "handle", origin: folder.path });
          refreshed += 1;
          continue;
        }
        const finished = looksDone(scan.files, at);
        if (finished) done += 1;
        const built = buildRoom({ taken, name: folder.name.slice(0, 40), source: "handle", rootName: folder.name, origin: folder.path, files: scan.files, scan, budgetBytes: null, done: finished, workDays: [], now: at });
        taken.push(built.face);
        await saveRoom(built);
        added += 1;
      } catch {
        failed += 1;
      }
    }
    onCreatedMany(
      `새 방 ${added}개${refreshed ? `, 다시 이은 방 ${refreshed}개` : ""}를 만들었어요.` +
        (done ? ` 그중 ${done}개는 ${doneAfterDays}일 넘게 쓰거나 고친 파일이 없어 완료된 프로젝트로 두었어요.` : "") +
        (failed ? ` 읽지 못한 폴더 ${failed}개는 뺐어요.` : ""),
    );
  }

  function ready(next: Draft) {
    setDraft(next);
    setName(next.rootName);
    setStep("confirm");
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!draft || !name.trim()) return;
    setSaving(true);
    const now = Date.now();
    // 다른 방 얼굴을 못 읽어도 방은 만듭니다.
    const taken = await listRooms().then((rooms) => rooms.map((room) => room.face), () => []);
    const room = buildRoom({
      taken,
      name: name.trim().slice(0, 40),
      source: draft.source,
      rootName: draft.rootName,
      files: draft.scan.files,
      scan: { complete: draft.scan.complete, failed: draft.scan.failed },
      budgetBytes: budget,
      done: false,
      workDays: [localDay(now)],
      now,
    });
    try {
      if (draft.handle) await saveHandle(room.id, draft.handle);
      await saveRoom(room);
      onCreated(room.id);
    } catch {
      setSaving(false);
      setError(`방을 저장하지 못했어요. ${isNative() ? "" : "브라우저 "}저장 공간을 확인해 주세요.`);
    }
  }

  const total = draft?.scan.files.reduce((sum, file) => sum + file.size, 0) ?? 0;
  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="new-room-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
      {same ? (
        <div className="sheet-body">
          {same.handle ? (
            <>
              <h2 id="new-room-title">이름이 같은 방이 있어요</h2>
              <p>‘{same.room.name}’ 방(보기 전용)과 이름이 같아요. 그 방에서 ‘폴더 연결’을 하면 메모와 자리가 이어져요.</p>
            </>
          ) : (
            <>
              <h2 id="new-room-title">이미 방이 있는 폴더예요</h2>
              <p>이 폴더는 ‘{same.room.name}’ 방으로 연결되어 있어요. 새 방을 만들지 않았어요.</p>
            </>
          )}
          <div className="row end">
            {same.handle ? (
              <button type="button" onClick={() => void scanPicked(same.handle!)}>새 방으로 만들기</button>
            ) : (
              <button type="button" onClick={onClose}>닫기</button>
            )}
            <button type="button" className="primary" autoFocus onClick={() => onOpenExisting(same.room.id)}>그 방으로 가기</button>
          </div>
        </div>
      ) : parent && step !== "scanning" ? (
        <form className="sheet-body" onSubmit={(event) => void createMany(event)}>
          <h2 id="new-room-title">‘{folderName(parent.path)}’ 안의 폴더 {parent.folders.length}개</h2>
          <p>방으로 만들 폴더를 고르세요. 고른 폴더만 하위까지 읽고, 주간 정리 때 그 안의 정리 상자로 옮겨요.</p>
          <div className="row">
            <button type="button" onClick={() => setChosen(chosen.size === parent.folders.length ? new Set() : new Set(parent.folders.map((folder) => folder.path)))}>{chosen.size === parent.folders.length ? "모두 풀기" : "모두 고르기"}</button>
          </div>
          <section className="sweep-room">
            <ul>
              {parent.folders.map((folder) => {
                const old = known.find((room) => sameFolder(room.origin, folder.path));
                return (
                  <li key={folder.path}>
                    <label>
                      <input
                        type="checkbox"
                        checked={chosen.has(folder.path)}
                        onChange={(event) => setChosen((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(folder.path);
                          else next.delete(folder.path);
                          return next;
                        })}
                      />
                      <span className="name">{folder.name}</span>
                      {old && <span className="soft">{old.source === "handle" ? "이미 방 있음 · 다시 봐요" : `‘${old.name}’ 방과 이어요`}</span>}
                    </label>
                  </li>
                );
              })}
              {parent.folders.length === 0 && <li className="soft">안에 폴더가 없어요. 프로젝트 폴더들이 들어 있는 상위 폴더를 골라 주세요.</li>}
            </ul>
          </section>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row end">
            <button type="button" onClick={() => void pickParentFolder()}>다른 폴더 고르기</button>
            <button type="button" onClick={onClose}>그만두기</button>
            <button type="submit" className="primary" disabled={chosen.size === 0}>방 {chosen.size}개 만들기</button>
          </div>
        </form>
      ) : step !== "confirm" || !draft ? (
        <div className="sheet-body">
          <h2 id="new-room-title">새 방 만들기</h2>
          <p>작업 폴더 하나가 방 하나가 돼요. 폴더 안 파일은 방 안의 물건이 되고, 크면 클수록 크게 놓여요.</p>
          <ul className="hints">
            <li>파일 내용은 저장하지 않아요. 이름·크기·자리·메모만 {isNative() ? "이 컴퓨터에" : "이 브라우저에"} 남아요.</li>
            <li>숨김 파일과 node_modules는 빼고, 파일 1,000개·깊이 10까지 들여요.</li>
            <li>Folduct가 폴더에 하는 일은 주간 정리 때 정리 상자로 옮기기와 되돌리기뿐이에요. 지우지 않아요.</li>
          </ul>
          {isNative() && step === "pick" && <p className="soft">프로젝트 폴더들이 들어 있는 상위 폴더(예: 홈 폴더)를 한 번 고르면, 그 안의 폴더 여러 개를 한꺼번에 방으로 만들 수 있어요.</p>}
          {step === "scanning" ? (
            // 숫자는 오를 때마다 읽히지 않게 숨기고, 문구만 알립니다.
            <p ref={scanning} className="scanning" role="status" tabIndex={-1}>물건을 세는 중…<span aria-hidden="true"> {count.toLocaleString("ko-KR")}개</span></p>
          ) : isNative() ? (
            <button type="button" className="primary big" onClick={() => void pickParentFolder()}>상위 폴더 고르기</button>
          ) : canPickFolder() ? (
            <button type="button" className="primary big" onClick={() => void pick()}>폴더 고르기</button>
          ) : (
            <>
              <button type="button" className="primary big" onClick={() => folderInput.current?.click()}>폴더 고르기</button>
              <input
                ref={folderInput}
                type="file"
                hidden
                // @ts-expect-error webkitdirectory는 표준 속성 목록에 없지만 모든 주요 브라우저가 지원합니다.
                webkitdirectory=""
                multiple
                onChange={(event) => {
                  const files = event.target.files;
                  if (!files?.length) return;
                  const scan = scanFileList(files);
                  // 같은 폴더를 다시 골라도 onChange가 오도록 비웁니다.
                  event.target.value = "";
                  ready({ source: "input", rootName: scan.rootName, handle: null, scan });
                }}
              />
            </>
          )}
          {!canPickFolder() && !isNative() && <p className="soft">이 브라우저에서는 폴더 안 파일을 실제로 옮길 수 없어요. 정리 상자는 Folduct 안에서만 쓰여요.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row end"><button type="button" onClick={onClose}>닫기</button></div>
        </div>
      ) : (
        <form className="sheet-body" onSubmit={(event) => void create(event)}>
          <h2 id="new-room-title">‘{draft.rootName}’ 방 꾸미기</h2>
          <p>물건 {draft.scan.files.length.toLocaleString("ko-KR")}개 · {formatBytes(total)}{draft.scan.complete && draft.scan.failed === 0 ? "" : " (최소)"}</p>
          {draft.scan.note && <p className="soft">{draft.scan.note}</p>}
          {draft.scan.failed > 0 && <p className="soft">읽지 못한 항목 {draft.scan.failed}개는 빼고 들였어요.</p>}
          <label className="field">방 이름 <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} required autoFocus /></label>
          <BudgetPicker totalBytes={total} value={budget} onChange={setBudget} />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row end">
            <button type="button" onClick={onClose} disabled={saving}>그만두기</button>
            <button type="submit" className="primary" disabled={saving}>{saving ? "방 만드는 중" : "방 만들기"}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
