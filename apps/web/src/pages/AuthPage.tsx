import { useState, type FormEvent } from "react";
import { login, register, type User } from "../services/api";

export function AuthPage({ reason, onDone, onBack }: { reason?: string; onDone: (user: User) => void; onBack: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(mode === "login" ? await login(email, password) : await register(email, name, password));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-status">
      <h1>{mode === "login" ? "로그인" : "가입"}</h1>
      <p>{reason ?? "프로젝트를 다른 사람과 공유하려면 로그인하세요. 원본 파일은 올라가지 않고 작업면과 파일 목록만 공유됩니다."}</p>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label>이메일 <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {mode === "register" && <label>이름 <input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} /></label>}
        <label>비밀번호 <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="button" onClick={onBack}>책상으로</button>
          <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "처음이면 가입" : "이미 계정이 있음"}</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? "확인 중" : mode === "login" ? "로그인" : "가입하기"}</button>
        </div>
      </form>
    </main>
  );
}
