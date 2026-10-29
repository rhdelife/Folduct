export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "table"
  | "office"
  | "design"
  | "archive"
  | "unknown";

export type LocalEntry = {
  id: string;
  name: string;
  path: string;
  extension: string;
  kind: FileKind;
  size: number;
  modifiedAt: number;
  file: File;
};

export type FolderSnapshot = {
  name: string;
  files: LocalEntry[];
  source: "directory-picker" | "directory-input";
};

export type FolderObject = {
  id: string;
  name: string;
  path: string;
  files: LocalEntry[];
  imageFiles: LocalEntry[];
  modifiedAt: number;
  totalSize: number;
  variant: number;
};
