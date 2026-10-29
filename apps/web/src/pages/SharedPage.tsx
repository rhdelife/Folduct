import { useEffect, useState } from "react";
import { acceptShareLink, listSharedProjects, type SharedProject, type User } from "../services/api";

export const roleLabel = { owner: "소유자", editor: "편집", viewer: "열람" } as const;

export function SharedPage({ user, onOpen, onLogout, onBack }: { user: User; onOpen: (id: string) => void; onLogout: () => void; onBack: () => void }) {
  const [projects, setProjects] = useState<SharedProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSharedProjects().then(setProjects, (caught: Error) => setError(caught.message));
  }, [user.id]);

  return (
    <main className="desk-page">
      <header className="desk-bar">
        <div>
          <p className="eyebrow">{user.name} · {user.email}</p>
          <h1>공유 프로젝트</h1>
        </div>
        <div className="bar-actions">
          <button type="button" onClick={onBack}>책상</button>
          <button type="button" onClick={onLogout}>로그아웃</button>
        </div>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {projects?.length === 0 && <p className="empty-desk">아직 공유한 프로젝트가 없습니다. 책상의 프로젝트에서 ‘공유하기’를 누르거나 받은 공유 링크를 여세요.</p>}
      {projects && projects.length > 0 && (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <div>
                <h2>{project.name}</h2>
                <p>{roleLabel[project.role]} 권한</p>
              </div>
              <button type="button" className="primary" onClick={() => onOpen(project.id)}>{project.role === "viewer" ? "보기" : "열기"}</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function AcceptSharePage({ token, onAccepted, onBack }: { token: string; onAccepted: (projectId: string) => void; onBack: () => void }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    acceptShareLink(token).then((result) => onAccepted(result.projectId), (caught: Error) => setError(caught.message));
  }, [token]);

  return (
    <main className="page-status">
      <h1>{error ? "공유 링크를 열지 못했습니다" : "공유 프로젝트를 여는 중"}</h1>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={onBack}>책상으로 돌아가기</button>
    </main>
  );
}
