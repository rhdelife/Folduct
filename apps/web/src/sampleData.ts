import type { LocalEntry } from "./types";

function virtualFile(name: string, path: string, type: string, content: string, forcedKind?: LocalEntry["kind"]): LocalEntry {
  const file = new File([content], name, { type, lastModified: Date.now() - Math.random() * 8.64e8 });
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const kind = forcedKind ?? (extension === "csv" ? "table" : type.startsWith("text/") || extension === "md" ? "text" : "unknown");
  return { id: `demo:${path}`, name, path, extension, kind, size: file.size, modifiedAt: file.lastModified, file };
}

const researchCover = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#243c32"/><stop offset="1" stop-color="#b65e34"/></linearGradient></defs>
  <rect width="800" height="1000" fill="#e7dfd1"/><rect x="70" y="80" width="660" height="840" rx="22" fill="url(#g)"/>
  <circle cx="580" cy="300" r="155" fill="#e3b95d" opacity=".88"/><path d="M70 690L330 420l400 340v160H70z" fill="#d7dfd4" opacity=".92"/>
  <text x="110" y="150" fill="#fff" font-family="Arial" font-size="28" letter-spacing="7">FIELD NOTES</text>
</svg>`;

const brandCover = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="#1f5a44"/><rect x="92" y="95" width="616" height="810" rx="310" fill="#f3efe4"/>
  <path d="M260 255h280v80H350v145h170v80H350v220h-90z" fill="#1f5a44"/>
  <circle cx="575" cy="700" r="86" fill="#d16c39"/><text x="96" y="940" fill="#f3efe4" font-family="Arial" font-size="24" letter-spacing="8">FOLDUCT</text>
</svg>`;

function virtualBytes(name: string, path: string, type: string, bytes: Uint8Array, kind: LocalEntry["kind"]): LocalEntry {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const file = new File([body], name, { type, lastModified: 1_700_000_000_000 });
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return { id: `demo:${path}`, name, path, extension, kind, size: file.size, modifiedAt: file.lastModified, file };
}

function pngPixel(): Uint8Array {
  const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function silentWav(): Uint8Array {
  const sampleRate = 8000;
  const samples = sampleRate;
  const dataSize = samples * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  return bytes;
}

export const sampleFiles: LocalEntry[] = [
  virtualFile("프로젝트 노트.md", "Folduct/프로젝트 노트.md", "text/markdown", "# Folduct\n\n흩어진 로컬 파일을 하나의 작업공간에서 탐색하고 맥락을 이어갑니다.\n\n## 이번 주\n- 웹 기반 파일 탐색\n- 형식별 미리보기\n- 개인 아카이브 구조 설계"),
  virtualFile("콘텐츠 인벤토리.csv", "Folduct/리서치/콘텐츠 인벤토리.csv", "text/csv", "분류,파일 수,최근 수정\n문서,48,오늘\n이미지,126,어제\n영상,17,3일 전\n참고자료,32,일주일 전"),
  virtualFile("field-notes.svg", "Folduct/리서치/field-notes.svg", "image/svg+xml", researchCover, "image"),
  virtualFile("folduct-cover.svg", "Folduct/브랜드/folduct-cover.svg", "image/svg+xml", brandCover, "image"),
  virtualFile("읽어보기.txt", "Folduct/아카이브/읽어보기.txt", "text/plain", "폴더를 연결하면 실제 파일이 이 자리에 나타납니다.\n파일 내용은 서버로 업로드되지 않고 이 브라우저 안에서만 열립니다."),
  virtualFile("주의.html", "Folduct/아카이브/주의.html", "text/html", "<script>window.__folductHtmlRan = true</script><img src=x onerror=\"window.__folductHtmlRan=true\"><p>실행되면 안 됩니다</p>", "text"),
  virtualFile("제안.hwp", "Folduct/아카이브/제안.hwp", "application/x-hwp", "한글 문서 자리", "office"),
  virtualBytes("표지.png", "Folduct/브랜드/표지.png", "image/png", pngPixel(), "image"),
  virtualBytes("짧은 메모.wav", "Folduct/아카이브/짧은 메모.wav", "audio/wav", silentWav(), "audio"),
];
