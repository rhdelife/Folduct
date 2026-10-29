import { useEffect, useMemo, useState, type FormEvent } from "react";
import { coverPalette, defaultCoverPath, defaultProjectName, isCoverImage, nameWithinLimit } from "../domain/deskLayout";
import { sameNameWarning } from "../domain/connectPolicy";
import { limits } from "../domain/limits";
import type { DeskPosition } from "../domain/models";
import type { FolderDraft } from "../gateways/fileGateway";
import { saveConfirmedFolder } from "../services/projectConnection";
import { BudgetPicker } from "./RoomCapacity";
import type { FolductStorage } from "../services/storage";

type NamedRoot = { id: string; name: string; rootName: string | null };

export function AddProjectDialog({
  storage,
  draft,
  projects,
  position,
  sameHandleProject,
  onCancel,
  onOpenProject,
  onCreated,
}: {
  storage: FolductStorage;
  draft: FolderDraft;
  projects: NamedRoot[];
  position: DeskPosition;
  sameHandleProject: { id: string; name: string } | null;
  onCancel: () => void;
  onOpenProject: (projectId: string) => void;
  onCreated: (projectId: string) => void;
}) {
  const [name, setName] = useState(defaultProjectName(draft.rootName));
  const [coverColor, setCoverColor] = useState<string>(coverPalette[0]);
  const [coverPath, setCoverPath] = useState<string | null>(defaultCoverPath(draft.scan.files));
  const [budgetBytes, setBudgetBytes] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const images = useMemo(() => draft.scan.files.filter(isCoverImage).slice(0, 8), [draft]);
  const warning = sameNameWarning(
    draft.sourceMode,
    projects.filter((project) => project.rootName === draft.rootName).length,
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  if (sameHandleProject) {
    return (
      <dialog className="sheet" open aria-labelledby="same-folder-title">
        <form className="panel" method="dialog">
          <h2 id="same-folder-title">이미 연결된 폴더입니다</h2>
          <p>이 폴더는 ‘{sameHandleProject.name}’ 프로젝트로 연결되어 있습니다. 새 프로젝트를 만들지 않았습니다.</p>
          <div className="sheet-actions">
            <button type="button" onClick={onCancel}>책상으로</button>
            <button type="button" className="primary" onClick={() => onOpenProject(sameHandleProject.id)}>그 프로젝트 열기</button>
          </div>
        </form>
      </dialog>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!nameWithinLimit(name)) {
      setError(`프로젝트 이름은 1~${limits.projectName}자입니다.`);
      return;
    }
    setSaving(true);
    setError(null);
    const saved = await saveConfirmedFolder(storage, {
      confirmed: true,
      draft,
      name,
      coverColor,
      deskPosition: position,
      coverRelativePath: coverPath,
      sameHandleProjectId: null,
    });
    if (saved.ok && budgetBytes !== null) await storage.updateCare(saved.value.project.id, { budgetBytes });
    setSaving(false);
    if (!saved.ok) {
      setError(saved.error.message);
      return;
    }
    onCreated(saved.value.project.id);
  }

  const scan = draft.scan;
  return (
    <dialog className="sheet" open aria-labelledby="confirm-folder-title">
      <form className="panel" onSubmit={onSubmit}>
        <h2 id="confirm-folder-title">프로젝트로 만들기</h2>
        <p>폴더 ‘{draft.rootName}’에서 파일 {scan.files.length.toLocaleString("ko-KR")}개를 읽었습니다. 확인하기 전에는 저장되지 않습니다.</p>
        <ul className="scan-notes">
          <li>숨김 파일, .git, node_modules는 제외했습니다. 파일 내용은 저장하지 않습니다.</li>
          {!scan.complete && scan.stoppedReason === "file-limit" && (
            <li>파일 1,000개까지만 가져왔습니다. 더 작은 폴더를 고르면 나머지도 연결할 수 있습니다.</li>
          )}
          {!scan.complete && scan.stoppedReason === "depth-limit" && (
            <li>하위 폴더 깊이 10을 넘는 항목은 포함하지 않았습니다.</li>
          )}
          {scan.failures.length > 0 && (
            <li>읽지 못한 항목 {scan.failures.length.toLocaleString("ko-KR")}개가 있습니다. 가져온 파일만 이 프로젝트에 남습니다.</li>
          )}
          {scan.files.length === 0 && <li>조건에 맞는 파일이 없는 폴더입니다. 빈 프로젝트로 만들 수 있습니다.</li>}
          {warning && <li>{warning}</li>}
          {draft.sourceMode === "input" && (
            <li>이 연결 방식은 같은 폴더인지 확정할 수 없습니다. 이름이 같아도 자동으로 합치지 않습니다.</li>
          )}
        </ul>
        {warning && (
          <div className="existing-links">
            {projects
              .filter((project) => project.rootName === draft.rootName)
              .map((project) => (
                <button key={project.id} type="button" onClick={() => onOpenProject(project.id)}>
                  기존 프로젝트 열기: {project.name}
                </button>
              ))}
          </div>
        )}
        <label>
          프로젝트 이름
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={limits.projectName * 2} required />
        </label>
        <fieldset>
          <legend>표지 색</legend>
          <div className="swatches">
            {coverPalette.map((color) => (
              <button
                key={color}
                type="button"
                className={color === coverColor ? "swatch selected" : "swatch"}
                style={{ background: color }}
                aria-label={`표지 색 ${color}`}
                aria-pressed={color === coverColor}
                onClick={() => setCoverColor(color)}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>표지 이미지</legend>
          <label className="choice">
            <input type="radio" name="cover" checked={coverPath === null} onChange={() => setCoverPath(null)} />
            이니셜과 색
          </label>
          {images.map((image) => (
            <label key={image.relativePath} className="choice">
              <input
                type="radio"
                name="cover"
                checked={coverPath === image.relativePath}
                onChange={() => setCoverPath(image.relativePath)}
              />
              {image.displayName}
            </label>
          ))}
          {images.length === 0 && <p>표시할 이미지가 없어 이니셜 표지를 사용합니다.</p>}
        </fieldset>
        <BudgetPicker totalBytes={scan.files.reduce((sum, file) => sum + file.size, 0)} value={budgetBytes} onChange={setBudgetBytes} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="button" onClick={onCancel} disabled={saving}>취소</button>
          <button type="submit" className="primary" disabled={saving}>{saving ? "저장 중" : "책상에 놓기"}</button>
        </div>
      </form>
    </dialog>
  );
}
