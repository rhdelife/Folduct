import type { AssetKind } from "./models";

export const previewLimits = {
  imageBytes: 20 * 1024 * 1024,
  textBytes: 2 * 1024 * 1024,
  mediaBytes: 500 * 1024 * 1024,
} as const;

export type PreviewMode = "image" | "video" | "audio" | "pdf" | "text";

export type PreviewBlock =
  | "image-size"
  | "text-size"
  | "media-size"
  | "office"
  | "design"
  | "archive"
  | "spreadsheet"
  | "unknown";

export type PreviewPlan = { status: "show"; mode: PreviewMode } | { status: "blocked"; block: PreviewBlock };

const rasterExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "ico"]);
const textExtensions = new Set([
  "txt", "md", "markdown", "json", "xml", "yaml", "yml", "html", "htm", "svg", "css", "scss",
  "js", "jsx", "ts", "tsx", "py", "java", "kt", "swift", "go", "rs", "c", "h", "cpp", "hpp",
  "sh", "zsh", "sql", "log", "ini", "toml", "csv", "tsv",
]);
const videoExtensions = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);
const officeExtensions = new Set(["doc", "docx", "ppt", "pptx", "hwp", "hwpx", "pages", "key"]);
const designExtensions = new Set(["psd", "ai", "sketch", "fig", "xd", "indd", "eps"]);
const archiveExtensions = new Set(["zip", "rar", "7z", "tar", "gz", "dmg", "iso"]);
const spreadsheetExtensions = new Set(["xls", "xlsx", "numbers"]);

const safeTextNoteExtensions = new Set([
  "md", "markdown", "html", "htm", "svg", "js", "jsx", "ts", "tsx", "css", "scss", "xml", "json",
]);

export function extensionOfName(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function planPreview(input: { displayName: string; kind: AssetKind; size: number }): PreviewPlan {
  const extension = extensionOfName(input.displayName);
  if (textExtensions.has(extension) || (input.kind === "text" && !spreadsheetExtensions.has(extension))) {
    if (input.size > previewLimits.textBytes) return { status: "blocked", block: "text-size" };
    return { status: "show", mode: "text" };
  }
  if (spreadsheetExtensions.has(extension) || (input.kind === "table" && !textExtensions.has(extension))) {
    return { status: "blocked", block: "spreadsheet" };
  }
  if (extension === "pdf" || input.kind === "pdf") return { status: "show", mode: "pdf" };
  if (videoExtensions.has(extension) || input.kind === "video") {
    if (input.size > previewLimits.mediaBytes) return { status: "blocked", block: "media-size" };
    return { status: "show", mode: "video" };
  }
  if (audioExtensions.has(extension) || input.kind === "audio") {
    if (input.size > previewLimits.mediaBytes) return { status: "blocked", block: "media-size" };
    return { status: "show", mode: "audio" };
  }
  if (rasterExtensions.has(extension)) {
    if (input.size > previewLimits.imageBytes) return { status: "blocked", block: "image-size" };
    return { status: "show", mode: "image" };
  }
  if (officeExtensions.has(extension) || input.kind === "office") return { status: "blocked", block: "office" };
  if (designExtensions.has(extension) || input.kind === "design") return { status: "blocked", block: "design" };
  if (archiveExtensions.has(extension) || input.kind === "archive") return { status: "blocked", block: "archive" };
  return { status: "blocked", block: "unknown" };
}

export function previewBlockMessage(block: PreviewBlock): string {
  switch (block) {
    case "image-size":
      return "이미지가 20MB를 넘어 이 카드에서는 미리보기를 열지 않습니다.";
    case "text-size":
      return "텍스트가 2MB를 넘어 이 카드에서는 내용을 열지 않습니다.";
    case "media-size":
      return "미디어가 500MB를 넘어 이 카드에서는 재생하지 않습니다.";
    case "office":
      return "오피스·한글 문서는 이름과 크기만 보여 줍니다. 원본과 똑같이 재현하지 않습니다.";
    case "design":
      return "디자인 파일은 이름과 크기만 보여 줍니다. 원본과 똑같이 재현하지 않습니다.";
    case "archive":
      return "압축 파일은 내용을 열지 않습니다. 이름과 크기만 보여 줍니다.";
    case "spreadsheet":
      return "표 계산 파일은 이름과 크기만 보여 줍니다. 원본과 똑같이 재현하지 않습니다.";
    case "unknown":
      return "이 형식은 미리보기를 지원하지 않습니다. 카드와 메모는 그대로 사용할 수 있습니다.";
  }
}

export function safeTextNote(displayName: string): string | null {
  const extension = extensionOfName(displayName);
  if (!safeTextNoteExtensions.has(extension)) return null;
  return "스크립트나 서식을 실행하지 않고 텍스트로 보여 줍니다.";
}

export function clampPlaybackSeconds(saved: number, duration: number): number | null {
  if (!Number.isFinite(saved) || saved < 0) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.min(saved, duration);
}

export function readUtf8Text(bytes: Uint8Array): { ok: true; text: string } | { ok: false; reason: "corrupt" } {
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

export function formatByteSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "크기 알 수 없음";
  if (size < 1024) return `${Math.round(size)}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)}KB`;
  if (size < 1024 ** 3) return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)}MB`;
  return `${Number((size / 1024 ** 3).toFixed(1))}GB`;
}

export function createPreviewTicket() {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    isCurrent(ticket: number) {
      return ticket === current;
    },
  };
}

const playbackMimes: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
};

export function playbackMime(displayName: string, fileType: string): string {
  if (fileType) return fileType;
  return playbackMimes[extensionOfName(displayName)] ?? "";
}
