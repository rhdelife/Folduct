import { normalizeEvery, normalizeNotes, normalizeReports, type ReportEvery, type WorkNote, type WorkReport } from "../domain/workReport";
import { run } from "./db";

// 작업 보고 주기·적어 둔 한 일·받은 보고. 저장소를 새로 만들지 않고 meta에 둬요(스키마 그대로).

export async function getReportEvery(): Promise<ReportEvery> {
  return normalizeEvery(await run<unknown>("meta", "readonly", (store) => store.get("reportEvery")));
}

export function saveReportEvery(every: ReportEvery): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(every, "reportEvery"));
}

export async function getWorkNotes(): Promise<WorkNote[]> {
  return normalizeNotes(await run<unknown>("meta", "readonly", (store) => store.get("workNotes")));
}

export function saveWorkNotes(notes: WorkNote[]): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(notes, "workNotes"));
}

export async function getWorkReports(): Promise<WorkReport[]> {
  return normalizeReports(await run<unknown>("meta", "readonly", (store) => store.get("workReports")));
}

export function saveWorkReports(reports: WorkReport[]): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(reports, "workReports"));
}
