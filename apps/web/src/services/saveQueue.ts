import type { Workspace } from "../domain/models";
import type { Result } from "../domain/result";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type SaveQueue = {
  enqueue: (workspace: Workspace) => Promise<void>;
  revision: () => number;
  status: () => SaveStatus;
  setRevision: (revision: number) => void;
};

export function createSaveQueue(options: {
  initialRevision: number;
  save: (expectedRevision: number, workspace: Workspace) => Promise<Result<Workspace>>;
  onChange?: (status: SaveStatus, error: string | null) => void;
}): SaveQueue {
  let revision = options.initialRevision;
  let latest: Workspace | null = null;
  let draining: Promise<void> | null = null;
  let status: SaveStatus = "idle";

  function report(next: SaveStatus, error: string | null) {
    status = next;
    options.onChange?.(next, error);
  }

  async function drain() {
    while (latest) {
      const snapshot = latest;
      latest = null;
      report("saving", null);
      const result = await options.save(revision, snapshot);
      if (!result.ok) {
        report("error", result.error.message);
        if (latest) continue;
        latest = snapshot;
        return;
      }
      revision = result.value.revision;
      if (!latest) report("saved", null);
    }
  }

  return {
    revision: () => revision,
    status: () => status,
    setRevision(next) {
      revision = next;
    },
    enqueue(workspace) {
      latest = workspace;
      if (!draining) {
        draining = drain().finally(() => {
          draining = null;
        });
      }
      return draining;
    },
  };
}
