import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from "react";
import { limitText } from "../domain/composedText";
import { textLength } from "../domain/text";

export function LimitedField({
  label,
  value,
  max,
  multiline = false,
  onCommit,
}: {
  label: string;
  value: string;
  max: number;
  multiline?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);

  useEffect(() => {
    if (!composing.current) setDraft(value);
  }, [value]);

  function publish(next: string, isComposing: boolean) {
    const limited = limitText(next, max, isComposing);
    setDraft(limited.value);
    if (limited.commit) onCommit(limited.value);
  }

  const shared = {
    value: draft,
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = false;
      publish(event.currentTarget.value, false);
    },
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      publish(event.target.value, composing.current);
    },
  };
  const atLimit = textLength(draft) >= max;

  return (
    <label className="limited-field">
      <span>{label}</span>
      {multiline ? <textarea rows={6} {...shared} /> : <input type="text" {...shared} />}
      <span className={atLimit ? "count at-limit" : "count"}>{textLength(draft)}/{max}</span>
    </label>
  );
}
