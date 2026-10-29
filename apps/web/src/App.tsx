import { useEffect, useRef, useState } from "react";
import { useRoute, navigate } from "./hooks/useRoute";
import { DeskPage } from "./pages/DeskPage";
import { ProjectPage } from "./pages/ProjectPage";
import { seedDemoIfEmpty } from "./services/demoDesk";
import { DEMO_DATABASE_NAME, deleteStorage, openStorage, type FolductStorage } from "./services/storage";
import { DATABASE_NAME } from "./repositories/schema";
import { AuthPage } from "./pages/AuthPage";
import { AcceptSharePage, SharedPage } from "./pages/SharedPage";
import { SharedProjectPage } from "./pages/SharedProjectPage";
import { logout, me, shareProject, type User } from "./services/api";

const modeKey = "folduct-mode";

export default function App() {
  const route = useRoute();
  const [mode, setMode] = useState<"live" | "demo">(() => (sessionStorage.getItem(modeKey) === "demo" ? "demo" : "live"));
  const [generation, setGeneration] = useState(0);
  const [storage, setStorage] = useState<FolductStorage | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const skipSeed = useRef(false);
  // undefined: 아직 확인 중, null: 로그인 안 함. 로컬 책상은 로그인 없이 그대로 씁니다.
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    void me().then(setUser);
  }, []);

  useEffect(() => {
    let closed = false;
    let current: FolductStorage | null = null;
    const skip = skipSeed.current;
    skipSeed.current = false;
    setStorage(null);
    setStorageError(null);
    void openStorage(mode === "demo" ? DEMO_DATABASE_NAME : DATABASE_NAME).then(async (opened) => {
      if (!opened.ok) {
        if (!closed) setStorageError(opened.error.message);
        return;
      }
      if (mode === "demo" && !skip) await seedDemoIfEmpty(opened.value);
      if (closed) {
        opened.value.close();
        return;
      }
      current = opened.value;
      setStorage(opened.value);
    });
    return () => {
      closed = true;
      current?.close();
    };
  }, [mode, generation]);

  function enterDemo() {
    sessionStorage.setItem(modeKey, "demo");
    setMode("demo");
    navigate("/desk");
  }

  function exitDemo() {
    sessionStorage.removeItem(modeKey);
    setMode("live");
    navigate("/desk");
  }

  async function reseedDemo() {
    if (!storage || mode !== "demo") return;
    await seedDemoIfEmpty(storage);
    setGeneration((value) => value + 1);
  }

  async function resetDemo() {
    if (!storage || mode !== "demo") return;
    skipSeed.current = true;
    storage.close();
    setStorage(null);
    await deleteStorage(DEMO_DATABASE_NAME);
    setGeneration((value) => value + 1);
  }

  if (storageError) {
    return (
      <main className="page-status">
        <h1>저장소를 열지 못했습니다</h1>
        <p>{storageError}</p>
      </main>
    );
  }
  if (!storage) return <main className="page-status"><p>저장소를 여는 중</p></main>;

  if (route.name === "login" || ((route.name === "shared" || route.name === "acceptShare") && user === null)) {
    return (
      <AuthPage
        reason={route.name === "acceptShare" ? "공유 링크로 들어온 프로젝트를 보려면 로그인하거나 가입하세요. 링크로는 열람 권한만 받습니다." : undefined}
        onDone={(next) => {
          setUser(next);
          if (route.name === "login") navigate("/shared");
        }}
        onBack={() => navigate("/desk")}
      />
    );
  }

  if (route.name === "shared" || route.name === "acceptShare" || route.name === "sharedProject") {
    if (user === undefined) return <main className="page-status"><p>로그인 확인 중</p></main>;
    if (route.name === "acceptShare") {
      return <AcceptSharePage token={route.token} onAccepted={(id) => navigate(`/shared/${id}`)} onBack={() => navigate("/desk")} />;
    }
    if (route.name === "sharedProject") {
      return <SharedProjectPage projectId={route.projectId} onBack={() => navigate("/shared")} onLogin={() => { setUser(null); navigate("/login"); }} />;
    }
    if (user) {
      return (
        <SharedPage
          user={user}
          onOpen={(id) => navigate(`/shared/${id}`)}
          onLogout={() => void logout().then(() => { setUser(null); navigate("/desk"); })}
          onBack={() => navigate("/desk")}
        />
      );
    }
  }

  async function shareLocal(projectId: string) {
    if (!storage) return;
    if (!user) {
      navigate("/login");
      return;
    }
    const [project, workspace, assets] = await Promise.all([storage.getProject(projectId), storage.getWorkspace(projectId), storage.listAssets(projectId)]);
    if (!project || !workspace) throw new Error("프로젝트를 찾지 못했습니다.");
    navigate(`/shared/${await shareProject(project, workspace, assets)}`);
  }

  if (route.name === "missing") {
    return (
      <main className="page-status">
        <h1>없는 주소입니다</h1>
        <p>요청한 페이지가 없습니다. 책상으로 돌아가 프로젝트를 고를 수 있습니다.</p>
        <button type="button" className="primary" onClick={() => navigate("/desk")}>책상으로 돌아가기</button>
      </main>
    );
  }

  if (route.name === "project") {
    return (
      <ProjectPage
        storage={storage}
        projectId={route.projectId}
        demo={mode === "demo"}
        onBack={() => navigate("/desk")}
      />
    );
  }

  return (
    <DeskPage
      storage={storage}
      demo={mode === "demo"}
      onOpenProject={(projectId) => navigate(`/projects/${projectId}`)}
      onEnterDemo={enterDemo}
      onExitDemo={exitDemo}
      onResetDemo={() => void resetDemo()}
      onReseedDemo={() => void reseedDemo()}
      onShareProject={mode === "demo" ? undefined : shareLocal}
      onOpenShared={() => navigate(user ? "/shared" : "/login")}
    />
  );
}
