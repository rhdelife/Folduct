import { useEffect, useRef, useState, type FormEvent } from "react";
import { localDay, mergeScan, relativeDay } from "../domain/care";
import { buildRoom } from "../domain/importFile";
import { shortPath } from "../domain/platform";
import { formatBytes, type Room, type RoomSource } from "../domain/model";
import { canPickFolder, pickFolder, scanFileList, type ScanResult } from "../gateways/folder";
import { allowFoundRooms, allowRooms, findFolders, folderName, isNative, pickParent, pickRoomFolder, sameFolder, scanRoomFolder, type ChildFolder, type FoundFolder } from "../gateways/native";
import { getHandle, listRooms, saveHandle, saveRoom } from "../storage/db";
import { useModal } from "./useModal";
import { toggled } from "./sets";
import { Meta } from "./Meta";

type Draft = { source: RoomSource; rootName: string; handle: FileSystemDirectoryHandle | null; origin?: string; scan: ScanResult };

export function NewRoomDialog({ onClose, onCreated, onOpenExisting, onCreatedMany }: { onClose: () => void; onCreated: (id: string) => void; onOpenExisting: (id: string) => void; onCreatedMany: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"pick" | "scanning" | "confirm">("pick");
  const [count, setCount] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  // handle이 있으면 이름만 같은 보기 전용 방이라, 그래도 새 방으로 만들 수 있게 고른 폴더를 들고 있습니다.
  // draft는 브라우저 폴더 입력으로 읽은 것. 경로를 몰라 이름만 같을 수도 있으니, 그래도 새 방으로 만들 수 있게 들고 있습니다.
  const [same, setSame] = useState<{ room: Room; handle: FileSystemDirectoryHandle | null; draft?: Draft } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 데스크톱: 상위 폴더 하나를 고르고, 그 안의 폴더 여러 개를 한 번에 방으로 만듭니다.
  const [parent, setParent] = useState<{ path: string; folders: ChildFolder[] } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [known, setKnown] = useState<Room[]>([]);
  // 데스크톱 첫 화면: 폴더 이름 검색과 후보 목록. 고른 폴더는 검색어를 바꿔도 남아요.
  const [query, setQuery] = useState("");
  // found는 어떤 검색어의 결과인지 함께 들고 있어, 새 결과가 오기 전엔 '찾는 중'으로 보여요.
  const [found, setFound] = useState<{ query: string; folders: FoundFolder[] } | null>(null);
  const [picked, setPicked] = useState<Map<string, FoundFolder>>(() => new Map());
  const scanning = useRef<HTMLParagraphElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useModal(dialog);

  // 데스크톱: 검색어가 바뀌면 잠깐 기다렸다 폴더를 찾아요. 늦게 온 옛 결과는 버려요.
  useEffect(() => {
    if (!isNative()) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void Promise.all([findFolders(query), listRooms()]).then(
        ([folders, rooms]) => {
          if (!live) return;
          setFound({ query, folders });
          setKnown(rooms);
        },
        () => live && setFound({ query, folders: [] }),
      );
    }, query ? 250 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

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

  // 데스크톱: 폴더 하나를 바로 방으로 만듭니다. 같은 경로의 방이 있으면 createMany처럼 새로 만들지 않습니다.
  async function pickPath() {
    setError(null);
    try {
      const path = await pickRoomFolder();
      if (!path) return;
      const old = (await listRooms()).find((room) => sameFolder(room.origin, path));
      if (old?.source === "handle") return setSame({ room: old, handle: null });
      setStep("scanning");
      const scan = await scanRoomFolder(path, setCount);
      if (old) {
        await saveRoom({ ...mergeScan(old, scan.files, scan, Date.now()), source: "handle", origin: path });
        return onOpenExisting(old.id);
      }
      ready({ source: "handle", rootName: folderName(path).normalize("NFC"), handle: null, origin: path, scan });
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
    await createFrom(parent.folders.filter((folder) => chosen.has(folder.path)), allowRooms, "고른 폴더를 열 권한을 받지 못했어요. 상위 폴더를 다시 골라 주세요.");
  }

  // 목록에서 고른 폴더들로 방을 만들어요.
  async function createFound(event: FormEvent) {
    event.preventDefault();
    await createFrom([...picked.values()], allowFoundRooms, "고른 폴더를 열지 못했어요. 홈 폴더 안의 폴더만 방으로 만들 수 있어요.");
  }

  // 직접 고른 폴더라 오래 안 고쳤어도 홈에서 빼지 않아요(2026-11-18 요청). 홈 줄이 차면 홈이 둘 방을 묻어요.
  async function createFrom(picks: ChildFolder[], allow: (paths: string[]) => Promise<void>, denied: string) {
    if (picks.length === 0) return;
    setStep("scanning");
    setCount(0);
    try {
      await allow(picks.map((folder) => folder.path));
    } catch {
      setStep("pick");
      setError(denied);
      return;
    }
    const known = await listRooms().catch(() => [] as Room[]);
    const at = Date.now();
    const taken = known.map((room) => room.face);
    let added = 0;
    let refreshed = 0;
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
        const built = buildRoom({ taken, name: folder.name.slice(0, 40), source: "handle", rootName: folder.name, origin: folder.path, files: scan.files, scan, done: false, workDays: [], now: at });
        taken.push(built.face);
        await saveRoom(built);
        added += 1;
      } catch {
        failed += 1;
      }
    }
    onCreatedMany(
      `새 방 ${added}개${refreshed ? `, 다시 이은 방 ${refreshed}개` : ""}를 만들었어요.` +
        (failed ? ` 읽지 못한 폴더 ${failed}개는 뺐어요.` : ""),
    );
  }

  // 브라우저 폴더 입력은 전체 경로를 몰라 같은 폴더인지 못 가립니다. 폴더 이름이 같은 방이 있으면 먼저 묻습니다.
  async function offerInput(next: Draft) {
    const rooms = await listRooms().catch(() => []);
    const named = rooms.find((room) => room.source !== "sample" && room.rootName.normalize("NFC") === next.rootName.normalize("NFC"));
    if (named) return setSame({ room: named, handle: null, draft: next });
    ready(next);
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
      origin: draft.origin,
      files: draft.scan.files,
      scan: { complete: draft.scan.complete, failed: draft.scan.failed },
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
          {same.handle || same.draft ? (
            <>
              <h2 id="new-room-title">이름이 같은 방이 있어요</h2>
              <p>{same.handle ? `‘${same.room.name}’ 방에서 ‘폴더 연결’을 하면 메모와 자리가 이어져요.` : `같은 폴더라면 ‘${same.room.name}’ 방으로 가세요. 다른 폴더면 새 방으로 만들 수 있어요.`}</p>
            </>
          ) : (
            <>
              <h2 id="new-room-title">이미 방이 있는 폴더예요</h2>
              <p>‘{same.room.name}’ 방과 연결되어 있어요.</p>
            </>
          )}
          <div className="row end">
            {same.handle || same.draft ? (
              <button type="button" onClick={() => {
                if (same.handle) return void scanPicked(same.handle);
                setSame(null);
                ready(same.draft!);
              }}>새 방으로 만들기</button>
            ) : (
              <button type="button" onClick={onClose}>닫기</button>
            )}
            <button type="button" className="primary" autoFocus onClick={() => onOpenExisting(same.room.id)}>그 방으로 가기</button>
          </div>
        </div>
      ) : isNative() && !parent && step === "pick" ? (
        <form className="sheet-body room-finder" onSubmit={(event) => void createFound(event)}>
          <h2 id="new-room-title">새 방 만들기</h2>
          <p className="soft">작업 폴더를 골라요. 폴더 하나가 방 하나예요.</p>
          <input type="search" className="room-finder-search" autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="폴더 이름으로 찾기" aria-label="방으로 만들 폴더를 이름으로 찾기" />
          <p className="room-finder-head" aria-live="polite">{found === null || found.query !== query ? "폴더를 찾는 중…" : query.trim() ? `‘${query.trim()}’ 폴더 ${found.folders.length}개` : "최근에 고친 폴더"}</p>
          <ul className="room-finder-list">
            {(found?.folders ?? []).map((folder) => {
              const old = known.find((room) => sameFolder(room.origin, folder.path));
              const parentPath = folder.path.slice(0, Math.max(0, folder.path.length - folder.name.length - 1));
              return (
                <li key={folder.path}>
                  <label className={picked.has(folder.path) ? "on" : undefined}>
                    <input
                      type="checkbox"
                      checked={picked.has(folder.path)}
                      onChange={(event) =>
                        setPicked((current) => {
                          const next = new Map(current);
                          if (event.target.checked) next.set(folder.path, folder);
                          else next.delete(folder.path);
                          return next;
                        })
                      }
                    />
                    <span className="room-finder-name">
                      <b>{folder.name}</b>
                      <small title={folder.path}>{shortPath(parentPath)}</small>
                    </span>
                    <span className="room-finder-meta">{old ? (old.source === "handle" ? "이미 방이 있어요" : `‘${old.name}’ 방과 이어요`) : folder.modified ? relativeDay(folder.modified, Date.now()) : ""}</span>
                  </label>
                </li>
              );
            })}
            {found !== null && found.query === query && found.folders.length === 0 && <li className="soft">{query.trim() ? "그런 이름의 폴더가 없어요. ‘Finder에서 고르기’로 찾아 주세요." : "후보 폴더가 없어요. 이름으로 찾거나 Finder에서 골라 주세요."}</li>}
          </ul>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row end">
            <button type="button" className="quiet room-finder-finder" onClick={() => void pickPath()}>Finder에서 고르기</button>
            <button type="button" onClick={onClose}>그만두기</button>
            <button type="submit" className="primary" disabled={picked.size === 0}>{picked.size > 0 ? `방 ${picked.size}개 만들기` : "방 만들기"}</button>
          </div>
        </form>
      ) : parent && step !== "scanning" ? (
        <form className="sheet-body" onSubmit={(event) => void createMany(event)}>
          <h2 id="new-room-title">방으로 만들 폴더를 고르세요</h2>
          <p className="soft">‘{folderName(parent.path)}’ 안의 폴더 {parent.folders.length}개. 고른 폴더만 읽어요.</p>
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
                        onChange={(event) => setChosen((current) => toggled(current, [folder.path], event.target.checked))}
                      />
                      <span className="name">{folder.name}</span>
                      {old && <span className="soft">{old.source === "handle" ? "이미 방이 있어요. 다시 봐요." : `‘${old.name}’ 방과 이어요`}</span>}
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
          {step === "pick" && <p>폴더 하나가 방 하나가 돼요.</p>}
          {step === "scanning" ? (
            // 숫자는 오를 때마다 읽히지 않게 숨기고, 문구만 알립니다.
            <p ref={scanning} className="scanning" role="status" tabIndex={-1}>물건을 세는 중…<span aria-hidden="true"> {count.toLocaleString("ko-KR")}개</span></p>
          ) : isNative() ? (
            <button type="button" className="primary big" autoFocus onClick={() => void pickPath()}>폴더 고르기</button>
          ) : canPickFolder() ? (
            <button type="button" className="primary big" autoFocus onClick={() => void pick()}>폴더 고르기</button>
          ) : (
            <>
              <button type="button" className="primary big" autoFocus onClick={() => folderInput.current?.click()}>폴더 고르기</button>
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
                  void offerInput({ source: "input", rootName: scan.rootName, handle: null, scan });
                }}
              />
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row end">
            {isNative() && step === "pick" && <button type="button" className="quiet" onClick={() => void pickParentFolder()}>상위 폴더에서 여러 개 고르기</button>}
            <button type="button" onClick={onClose}>닫기</button>
          </div>
        </div>
      ) : (
        <form className="sheet-body" onSubmit={(event) => void create(event)}>
          <h2 id="new-room-title">이 폴더로 방을 만들까요?</h2>
          <p><Meta items={[`‘${draft.rootName}’`, `물건 ${draft.scan.files.length.toLocaleString("ko-KR")}개`, `${formatBytes(total)}${draft.scan.complete && draft.scan.failed === 0 ? "" : " (최소)"}`]} /></p>
          {draft.scan.note && <p className="soft">{draft.scan.note}</p>}
          {draft.scan.failed > 0 && <p className="soft">읽지 못한 항목 {draft.scan.failed}개는 빼고 들였어요.</p>}
          {draft.source === "input" && <p className="soft">이 브라우저에서는 폴더 안 파일을 옮기지 못해요. 정리 상자는 Folduct 안에서만 쓰여요.</p>}
          <label className="field">방 이름 <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} required /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row end">
            <button type="button" onClick={onClose} disabled={saving}>그만두기</button>
            <button type="submit" className="primary" autoFocus disabled={saving}>{saving ? "방 만드는 중" : "방 만들기"}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
