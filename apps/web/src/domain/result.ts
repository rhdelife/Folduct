export type StorageIssueCode =
  | "invalid"
  | "limit"
  | "conflict"
  | "not-found"
  | "schema-mismatch"
  | "aborted";

export type StorageIssue = {
  code: StorageIssueCode;
  message: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: StorageIssue };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(code: StorageIssueCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}
