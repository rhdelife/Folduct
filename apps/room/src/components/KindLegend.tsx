import { ObjectShape } from "../art/ObjectShape";
import { colorGroups } from "../art/palette";
import { objectScale } from "../domain/care";
import { formatBytes, type Kind, type Thing } from "../domain/model";

const groupIndex = Object.fromEntries(colorGroups.flatMap((group, index) => group.kinds.map((kind) => [kind, index]))) as Record<Kind, number>;

// 지금 보이는 파일에 있는 색 묶음만 범례로 보여줍니다. 견본은 실제 오브제와 같은 모양이고, 색만으로 뜻을 전하지 않도록 글자를 붙입니다.
export function KindLegend({ kinds }: { kinds: Iterable<Kind> }) {
  const present = new Set(kinds);
  const shown = colorGroups.filter((group) => group.kinds.some((kind) => present.has(kind)));
  if (shown.length === 0) return null;
  return (
    <ul className="legend" aria-label="파일 형식별 색">
      {shown.map((group) => (
        <li key={group.label}><ObjectShape kind={group.kinds[0]} size={18} />{group.label}</li>
      ))}
    </ul>
  );
}

// 프로젝트 하나에 어떤 색 묶음이 얼마나(용량 기준) 있는지 한 줄 막대로 보여줍니다.
export function KindMix({ things }: { things: Thing[] }) {
  const sizes = colorGroups.map(() => 0);
  for (const thing of things) if (!thing.missing) sizes[groupIndex[thing.kind]] += thing.size;
  const parts = colorGroups.map((group, index) => ({ group, size: sizes[index] })).filter((part) => part.size > 0);
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  const summary = [...parts].sort((a, b) => b.size - a.size).slice(0, 3).map((part) => `${part.group.label} ${Math.round((part.size / total) * 100)}%`).join(", ");
  return (
    <span className="mix" role="img" aria-label={total ? `형식 비율: ${summary}` : "파일 없음"}>
      {parts.map((part) => <span key={part.group.label} style={{ flexGrow: part.size, background: part.group.color }} title={`${part.group.label} ${formatBytes(part.size)}`} />)}
    </span>
  );
}

// 크기 규칙을 글자로도 보여줍니다: 파일이 클수록 아이콘이 커집니다.
export function SizeKey() {
  const samples: [number, string][] = [[1024, "1KB"], [1024 ** 2, "1MB"], [1024 ** 3, "1GB"]];
  return (
    <p className="size-key">
      <span className="sr-only">크기: 파일이 클수록 크게 보여요.</span>
      <span aria-hidden="true">크기</span>
      {samples.map(([bytes, label]) => (
        <span key={label}><ObjectShape kind="unknown" size={Math.round(20 * objectScale(bytes))} />{label}</span>
      ))}
    </p>
  );
}
