import { useEffect, useState } from "react";
import { defaultAi, type AiSettings } from "../domain/aiNote";
import { getAiSettings, saveAiSettings } from "../storage/ai";
import { aiSettingsChanged } from "./AiNotePanel";

// 환경설정의 AI 요약 칸: 켜기와 API 키. 키는 이 기기의 앱 저장소에만 두고, 요약을 누를 때 Anthropic에만 보내요.
export function AiSettingsRows({ onError }: { onError: (message: string) => void }) {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAiSettings().then(
      (stored) => {
        setAi(stored);
        setKey(stored.apiKey);
      },
      (error: unknown) => {
        console.error(error);
        setAi(defaultAi);
      },
    );
  }, []);

  async function change(next: AiSettings): Promise<boolean> {
    const before = ai;
    setAi(next);
    try {
      await saveAiSettings(next);
      window.dispatchEvent(new Event(aiSettingsChanged));
      return true;
    } catch (error) {
      console.error(error);
      setAi(before);
      onError("설정을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.");
      return false;
    }
  }

  function saveKey() {
    if (!ai || key.trim() === ai.apiKey) return;
    void change({ ...ai, apiKey: key.trim() }).then((ok) => setSaved(ok));
  }

  return (
    <>
      <label className="setting-row">
        <span>
          <strong>AI 요약</strong>
          <small>파일 상세 아래에서 누를 때만 그 파일을 Anthropic에 보내 짧은 요약과 판단을 받아요. 자동으로 보내지 않아요.</small>
        </span>
        <input type="checkbox" role="switch" checked={ai?.on ?? false} disabled={ai === null} onChange={(event) => ai && void change({ ...ai, on: event.target.checked })} />
      </label>
      {/* 끈 뒤에도 키 칸을 보여 줘요. 저장해 둔 키를 지울 수 있어야 해요. */}
      {ai && (ai.on || ai.apiKey) && (
        <label className="field setting-key">
          Anthropic API 키
          <input
            type="password"
            value={key}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            onChange={(event) => {
              setKey(event.target.value);
              setSaved(false);
            }}
            onBlur={saveKey}
            onKeyDown={(event) => event.key === "Enter" && saveKey()}
          />
          <small role="status">{saved ? (key.trim() ? "저장했어요. 이 기기에만 둬요." : "키를 지웠어요.") : "이 기기의 앱 저장소에만 두고, 요약을 누를 때 Anthropic에만 보내요. 비우면 지워져요."}</small>
        </label>
      )}
    </>
  );
}
