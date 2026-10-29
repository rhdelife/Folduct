import { useEffect, useRef, useState } from "react";
import type { Workspace } from "../domain/models";
import { createSaveQueue, type SaveQueue, type SaveStatus } from "../services/saveQueue";
import type { WorkspaceStore } from "../services/storage";

export function useAutosave(options: { storage: WorkspaceStore; projectId: string; revision: number }) {
  const queue = useRef<SaveQueue | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<Workspace | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const storageRef = useRef(options.storage);
  const revisionRef = useRef(options.revision);
  storageRef.current = options.storage;
  const projectId = options.projectId;

  useEffect(() => {
    let active = true;
    const saveQueue = createSaveQueue({
      initialRevision: revisionRef.current,
      save: (expected, snapshot) => storageRef.current.saveWorkspace(projectId, expected, snapshot),
      onChange: (next, message) => {
        if (!active || pending.current) return;
        setStatus(next);
        setError(next === "error" ? message : null);
      },
    });
    queue.current = saveQueue;
    return () => {
      active = false;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      const leftover = pending.current;
      pending.current = null;
      if (leftover) void saveQueue.enqueue(leftover);
      queue.current = null;
    };
  }, [projectId]);

  function clearTimer() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }

  return {
    status,
    error,
    schedule(workspace: Workspace) {
      pending.current = workspace;
      setStatus("saving");
      setError(null);
      clearTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        pending.current = null;
        void queue.current?.enqueue(workspace);
      }, 800);
    },
    flush(workspace: Workspace) {
      pending.current = null;
      setStatus("saving");
      setError(null);
      clearTimer();
      void queue.current?.enqueue(workspace);
    },
    async commitNow(workspace: Workspace): Promise<{ ok: true; revision: number } | { ok: false; message: string }> {
      pending.current = null;
      setStatus("saving");
      setError(null);
      clearTimer();
      const current = queue.current;
      if (!current) return { ok: false, message: "저장소가 준비되지 않았습니다." };
      await current.enqueue(workspace);
      if (current.status() === "error") return { ok: false, message: "작업면을 저장하지 못했습니다. 다시 시도해 주세요." };
      return { ok: true, revision: current.revision() };
    },
    advanceRevision(revision: number) {
      queue.current?.setRevision(revision);
      setStatus("saved");
      setError(null);
    },
  };
}
