import { useEffect, useReducer, useRef, useState } from "react";
import { markWorkDay } from "../domain/care";
import type { Room, Thing } from "../domain/model";
import { shortPath } from "../domain/platform";
import { isNotFound } from "../gateways/mover";
import { askFolder, folderAccess, openInApp, readFolderFile, type Folder } from "../gateways/native";
import { roomFolder } from "../storage/box";
import { patchRoom } from "../storage/db";
import { FileViewer, previewLimit, previewMode, writeClipboard, type ViewerState } from "./FileViewer";

// 집 화면에서 방에 들어가지 않고 파일을 봅니다. 폴더 연결은 방 화면의 일이라, 연결이 없으면 그 방으로 보냅니다.
export function QuickViewer({ room, thing, onClose, onToRoom, onError }: { room: Room; thing: Thing; onClose: () => void; onToRoom: () => void; onError: (message: string) => void }) {
  const [state, setState] = useState<ViewerState | null>(null);
  const [tries, retry] = useReducer((count: number) => count + 1, 0);
  const folder = useRef<Folder | null>(null);
  const started = useRef(-1);

  // 미리보기를 연 것도 손댄 것으로 셉니다.
  const touch = () => {
    const at = Date.now();
    patchRoom(room.id, (current) => ({ ...current, workDays: markWorkDay(current.workDays, at), things: current.things.map((item) => (item.id === thing.id ? { ...item, touchedAt: at } : item)) })).catch((error: unknown) => console.error(error));
  };

  const openApp = async (path: string) => {
    try {
      await openInApp(path, thing.path);
      touch();
      return null;
    } catch (error) {
      return `파일을 열지 못했어요. 옮겨졌거나 지워졌다면 방에서 ‘폴더 다시 보기’로 목록을 맞춰 주세요. (${String(error)})`;
    }
  };

  useEffect(() => {
    // StrictMode의 두 번째 실행에서 앱이 두 번 열리지 않게 합니다.
    if (started.current === tries) return;
    started.current = tries;
    void (async () => {
      if (room.source === "sample") return setState({ status: "sample" });
      try {
        folder.current ??= await roomFolder(room);
        const found = folder.current;
        if (!found) return setState({ status: "need-folder" });
        if (typeof found === "string" && (previewMode(thing) === "none" || thing.size > previewLimit)) {
          const error = await openApp(found);
          if (error) onError(error);
          return onClose();
        }
        setState({ status: "loading" });
        if ((await folderAccess(found)) !== "granted" && !(await askFolder(found))) return setState({ status: "denied" });
        setState({ status: "ready", file: await readFolderFile(found, thing.path) });
        touch();
      } catch (error) {
        const missing = isNotFound(error);
        // 브라우저는 클릭 없이 권한을 묻지 못합니다. 다시 시도 버튼이 그 클릭이 돼요.
        if (error instanceof DOMException && error.name === "SecurityError") return setState({ status: "denied" });
        setState({ status: "error", message: missing ? "폴더에서 이 파일을 찾지 못했어요. 옮겨졌거나 지워졌다면 방에서 ‘폴더 다시 보기’로 목록을 맞춰 주세요." : "파일을 열지 못했어요. 다른 앱이 쓰고 있는지 확인해 주세요." });
      }
    })();
  }, [tries]);

  if (!state) return null;
  const found = folder.current;
  return (
    <FileViewer
      thing={thing}
      state={state}
      busy={false}
      folderHint={room.origin ? shortPath(room.origin) : room.rootName}
      onClose={onClose}
      onConnect={onToRoom}
      onRetry={retry}
      onCopy={writeClipboard}
      onOpenApp={
        typeof found === "string"
          ? () => {
              void openApp(found).then((error) => {
                if (error) setState({ status: "error", message: error });
              });
            }
          : undefined
      }
    />
  );
}
