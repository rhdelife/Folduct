// 방 하나 = 연결한 폴더 하나. 폴더 안 파일은 방 안의 '물건'이 됩니다.
export type Kind = "image" | "video" | "audio" | "pdf" | "text" | "table" | "office" | "design" | "archive" | "unknown";

export type BoxEntry = {
  // moving-*는 옮기기 직전에 남기는 기록이라, 중간에 꺼져도 실제 위치를 보고 맞출 수 있습니다.
  state: "moving-in" | "boxed" | "moving-out" | "virtual";
  fromPath: string;
  boxPath: string;
  at: number;
};

export type Spot = { x: number; y: number };

export type Thing = {
  id: string;
  path: string;
  name: string;
  kind: Kind;
  size: number;
  lastModified: number;
  // 방 밖에서 마지막으로 연 시각(macOS Spotlight). 알 수 없으면 null.
  lastUsedAt: number | null;
  missing: boolean;
  // null이면 아직 선반 위에 있습니다(방 바닥에 놓지 않음).
  spot: Spot | null;
  note: string;
  touchedAt: number | null;
  pinned: boolean;
  box: BoxEntry | null;
};

// done: 홈에서 뺀 방. 주간 정리가 멈춥니다. 다 끝나지 않은 방도 있어 화면에는 '완료'라고 쓰지 않아요.
export type CareSettings = { done: boolean; staleAfterDays: number };

// 방의 얼굴: 화병 모양 번호와 목 색 번호. domain/face.ts
export type RoomFace = { shape: number; color: number };

export type RoomSource = "handle" | "input" | "sample";

export type Room = {
  id: string;
  name: string;
  createdAt: number;
  source: RoomSource;
  rootName: string;
  // 가져오기로 만든 방의 원래 폴더 경로. 같은 폴더를 다시 가져오면 새 방 대신 이 방을 다시 봅니다.
  origin?: string;
  scan: { complete: boolean; failed: number; at: number; freedBytes: number };
  things: Thing[];
  // 방 안에서 손대거나 방 밖에서 파일을 쓴 날(YYYY-MM-DD). 방치 판정의 기준입니다.
  workDays: string[];
  care: CareSettings;
  // 오래 안 쓴 방을 홈에서 뺄지 마지막으로 물은 시각. 그 뒤로 방을 다시 쓰기 전까지 묻지 않습니다.
  doneOfferAt: number | null;
  face: RoomFace;
};

export type ScannedFile = { path: string; name: string; kind: Kind; size: number; lastModified: number; lastUsedAt?: number | null };

const extensions: [Kind, string[]][] = [
  ["image", ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "heic", "ico"]],
  ["video", ["mp4", "webm", "mov", "m4v", "avi", "mkv"]],
  ["audio", ["mp3", "wav", "ogg", "m4a", "aac", "flac", "aiff"]],
  ["pdf", ["pdf"]],
  ["table", ["csv", "tsv", "xls", "xlsx", "numbers"]],
  ["office", ["doc", "docx", "ppt", "pptx", "hwp", "hwpx", "pages", "key"]],
  ["design", ["psd", "ai", "sketch", "fig", "xd", "indd", "eps", "blend", "procreate"]],
  ["archive", ["zip", "rar", "7z", "tar", "gz", "dmg", "iso"]],
  ["text", ["txt", "md", "json", "xml", "yaml", "yml", "html", "css", "scss", "js", "cjs", "mjs", "jsx", "ts", "tsx", "vue", "svelte", "ipynb", "r", "kt", "php", "rb", "py", "java", "swift", "go", "rs", "c", "cpp", "sh", "sql", "log", "toml", "rtf"]],
];

export function kindOf(name: string): Kind {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return extensions.find(([, list]) => list.includes(ext))?.[0] ?? "unknown";
}

export const kindLabels: Record<Kind, string> = {
  image: "이미지", video: "영상", audio: "소리", pdf: "PDF", text: "글·코드", table: "표", office: "문서", design: "디자인", archive: "압축", unknown: "기타",
};

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "크기 모름";
  if (size < 1024) return `${Math.round(size)}B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)}KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(size < 10 * 1024 ** 2 ? 1 : 0)}MB`;
  return `${Number((size / 1024 ** 3).toFixed(1))}GB`;
}

export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 1024 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  const parts = value.split("/");
  return parts.length <= 12 && parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function newId(): string {
  return crypto.randomUUID();
}
