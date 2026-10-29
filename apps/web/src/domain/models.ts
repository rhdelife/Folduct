export const assetKinds = [
  "image",
  "video",
  "audio",
  "pdf",
  "text",
  "table",
  "office",
  "design",
  "archive",
  "unknown",
] as const;

export type AssetKind = (typeof assetKinds)[number];

export const availabilityStates = [
  "unknown",
  "available",
  "changed",
  "missing",
  "permissionRequired",
] as const;

export type Availability = (typeof availabilityStates)[number];

export const sourceModes = ["handle", "input"] as const;

export type SourceMode = (typeof sourceModes)[number];

export const sceneTypes = ["pause", "manual", "safety"] as const;

export type SceneType = (typeof sceneTypes)[number];

export type DeskPosition = {
  x: number;
  y: number;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  coverAssetId: string | null;
  coverColor: string;
  deskPosition: DeskPosition;
  deskPlacedByUser: boolean;
  rootRefId: string | null;
  lastPausedSceneId: string | null;
};

export type ScanStopReason = "file-limit" | "depth-limit" | "cancelled";

export type ScanRecord = {
  complete: boolean;
  collected: number;
  failed: number;
  stoppedReason: ScanStopReason | null;
};

export type RootRecord = {
  id: string;
  projectId: string;
  sourceMode: SourceMode;
  rootName: string;
  lastScanAt: number | null;
  scan: ScanRecord | null;
};

export type RootHandleRecord = {
  rootId: string;
  directoryHandle: FileSystemDirectoryHandle;
};

export type Asset = {
  id: string;
  projectId: string;
  relativePath: string;
  displayName: string;
  kind: AssetKind;
  size: number;
  lastModified: number;
  availability: Availability;
};

export type Zone = {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Card = {
  id: string;
  assetId: string | null;
  title: string;
  note: string;
  zoneId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type MediaPosition = {
  assetId: string;
  seconds: number;
};

export type Workspace = {
  projectId: string;
  revision: number;
  zones: Zone[];
  cards: Card[];
  nextAction: string;
  viewport: Viewport;
  selectedCardId: string | null;
  mediaPositions: MediaPosition[];
  updatedAt: number;
};

export type AssetManifestEntry = {
  assetId: string;
  relativePath: string;
  displayName: string;
  size: number;
  lastModified: number;
};

export type Scene = {
  id: string;
  projectId: string;
  title: string;
  type: SceneType;
  createdAt: number;
  sourceRevision: number;
  snapshot: Workspace;
  assetManifest: AssetManifestEntry[];
};

export type CreateProjectInput = {
  name: string;
  coverColor: string;
  deskPosition: DeskPosition;
  root?: {
    sourceMode: SourceMode;
    rootName: string;
    directoryHandle?: FileSystemDirectoryHandle | null;
  };
};

export type CreatedProject = {
  project: Project;
  workspace: Workspace;
  root: RootRecord | null;
};

export type RememberAssetInput = {
  projectId: string;
  relativePath: string;
  displayName: string;
  kind: AssetKind;
  size: number;
  lastModified: number;
  availability: Availability;
};

export type SaveWorkspaceInput = {
  projectId: string;
  expectedRevision: number;
  workspace: unknown;
};

export type ConnectedFileInput = {
  relativePath: string;
  displayName: string;
  kind: AssetKind;
  size: number;
  lastModified: number;
  availability: Availability;
};

export type CreateConnectedProjectInput = {
  name: string;
  coverColor: string;
  deskPosition: DeskPosition;
  root: {
    sourceMode: SourceMode;
    rootName: string;
    directoryHandle?: FileSystemDirectoryHandle | null;
  };
  files: ConnectedFileInput[];
  scan: ScanRecord;
  coverRelativePath: string | null;
};

export type UpdateProjectInput = {
  projectId: string;
  name?: string;
  coverColor?: string;
  coverAssetId?: string | null;
  deskPosition?: DeskPosition;
  deskPlacedByUser?: boolean;
};
