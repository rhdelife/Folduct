import { createId } from "./ids";
import { defaultZoneTitles, limits } from "./limits";
import type { Workspace } from "./models";

export function createInitialWorkspace(projectId: string, now: number): Workspace {
  const width = 720;
  const height = 1504;
  const gap = 48;
  return {
    projectId,
    revision: 1,
    zones: defaultZoneTitles.map((title, index) => ({
      id: createId(),
      title,
      x: gap + index * (width + gap),
      y: gap,
      width,
      height,
    })),
    cards: [],
    nextAction: "",
    viewport: { x: 0, y: 0, scale: 1 },
    selectedCardId: null,
    mediaPositions: [],
    updatedAt: now,
  };
}

export const initialWorkspaceBounds = {
  width: limits.workspaceWidth,
  height: limits.workspaceHeight,
};
