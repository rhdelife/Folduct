import { useEffect, useMemo, useState } from "react";
import { WorkspaceEditor } from "../components/WorkspaceEditor";
import { ApiError, createShareLink, loadSharedWorkspace, remoteStore } from "../services/api";
import { roleLabel } from "./SharedPage";

type Loaded = Awaited<ReturnType<typeof loadSharedWorkspace>>;

export function SharedProjectPage({ projectId, onBack, onLogin }: { projectId: string; onBack: () => void; onLogin: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoaded(null); // 다시 불러오면 편집 화면을 새로 띄워 로컬에서 바꾼 내용을 버립니다.
    loadSharedWorkspace(projectId).then(
      (next) => { if (!cancelled) setLoaded(next); },
      (caught: Error) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) onLogin();
        else setError(caught.message);
      },
    );
    return () => { cancelled = true; };
  }, [projectId, generation]); // onLogin은 매번 새 함수라 넣지 않습니다.

  const store = useMemo(() => remoteStore(loaded?.assets ?? []), [loaded]);

  async function makeLink() {
    setLinkError(null);
    try {
      const created = await createShareLink(projectId);
      setLink(`${window.location.origin}/share/${created.token}`);
    } catch (caught) {
      setLinkError(caught instanceof Error ? caught.message : "링크를 만들지 못했습니다.");
    }
  }

  if (error) {
    return (
      <main className="page-status">
        <h1>공유 프로젝트를 열지 못했습니다</h1>
        <p>{error}</p>
        <button type="button" className="primary" onClick={onBack}>공유 목록으로</button>
      </main>
    );
  }
  if (!loaded) return <main className="page-status"><p>공유 프로젝트를 불러오는 중</p></main>;

  const { project, workspace, assets, scenes } = loaded;
  return (
    <WorkspaceEditor
      key={project.id}
      storage={store}
      projectId={project.id}
      projectName={project.name}
      demo={false}
      assets={assets}
      initialWorkspace={workspace}
      initialScenes={scenes}
      lastPausedSceneId={null}
      directoryHandle={null}
      readOnly={project.role === "viewer"}
      eyebrow={`공유 프로젝트 · ${roleLabel[project.role]}`}
      onBack={onBack}
      banner={
        <section className="access-banner" aria-live="polite">
          <p>
            {project.role === "viewer"
              ? "열람 권한입니다. 배치와 메모를 볼 수만 있고 바꾼 내용은 저장되지 않습니다."
              : "공유 서버에 저장됩니다. 다른 사람이 먼저 저장하면 내 저장은 거절되니 최신 작업면을 불러온 뒤 다시 하세요."}
            {" "}원본 파일은 공유되지 않아 파일 내용은 열 수 없습니다.
          </p>
          <div className="sheet-actions">
            <button type="button" onClick={() => setGeneration((value) => value + 1)}>최신 작업면 불러오기</button>
            {project.role === "owner" && <button type="button" onClick={() => void makeLink()}>열람 링크 만들기</button>}
          </div>
          {link && <label>7일 동안 쓸 수 있는 열람 링크 <input readOnly value={link} onFocus={(event) => event.currentTarget.select()} /></label>}
          {linkError && <p className="error" role="alert">{linkError}</p>}
        </section>
      }
    />
  );
}
