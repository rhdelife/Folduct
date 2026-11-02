// 앱에 함께 배포되는 라이브러리의 라이선스 고지를 src-tauri/THIRD-PARTY-LICENSES.txt로 만듭니다.
// 의존성을 바꾸면 다시 돌립니다: node apps/room/scripts/gen-licenses.mjs
// 전 OS의 크레이트를 합쳐 적어 파일 하나로 macOS·Windows·리눅스에 함께 씁니다.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [];

function licenseTexts(dir) {
  return readdirSync(dir)
    .filter((name) => /^(licen[cs]e|copying|notice)/i.test(name))
    .sort()
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => readFileSync(path, "utf8").trim());
}

// 화면에 실려 나가는 npm 패키지(dependencies와 그 하위). 개발 도구는 배포되지 않아요.
function walkNpm(name, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);
  const dir = join(app, "node_modules", name);
  const info = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  packages.push({ name, version: info.version, license: info.license ?? "미표기", texts: licenseTexts(dir) });
  for (const child of Object.keys(info.dependencies ?? {})) walkNpm(child, seen);
}
for (const name of Object.keys(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).dependencies)) walkNpm(name);

// 실행 파일에 링크되는 크레이트. 빌드·테스트 전용 의존성은 따라가지 않습니다.
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", join(app, "src-tauri/Cargo.toml")], { encoding: "utf8", maxBuffer: 1 << 28 }));
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const crates = new Map(metadata.packages.map((item) => [item.id, item]));
const reached = new Set();
const stack = [metadata.resolve.root];
while (stack.length > 0) {
  const id = stack.pop();
  if (reached.has(id)) continue;
  reached.add(id);
  for (const dep of nodes.get(id).deps) if (dep.dep_kinds.some((kind) => kind.kind === null)) stack.push(dep.pkg);
}
for (const id of reached) {
  if (id === metadata.resolve.root) continue;
  const item = crates.get(id);
  packages.push({ name: item.name, version: item.version, license: item.license ?? "미표기", texts: licenseTexts(dirname(item.manifest_path)) });
}

packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const byText = new Map();
for (const item of packages) for (const text of item.texts) byText.set(text, [...(byText.get(text) ?? []), item.name]);

const lines = [
  "Folduct에 포함된 제3자 소프트웨어 / Third-party software included in Folduct",
  "Pretendard 글꼴의 라이선스는 LICENSE-Pretendard.txt에 따로 있습니다.",
  "",
  ...packages.map((item) => `${item.name} ${item.version} — ${item.license}${item.texts.length === 0 ? " (패키지에 라이선스 파일 없음. 표기된 SPDX 라이선스를 따릅니다.)" : ""}`),
  "",
  ...[...byText].flatMap(([text, names]) => ["=".repeat(72), `적용 대상: ${[...new Set(names)].join(", ")}`, "=".repeat(72), text, ""]),
];
writeFileSync(join(app, "src-tauri/THIRD-PARTY-LICENSES.txt"), `${lines.join("\n")}\n`);
const noText = packages.filter((item) => item.texts.length === 0).length;
const licenses = [...new Set(packages.map((item) => item.license))].sort();
console.log(`패키지 ${packages.length}개, 라이선스 글 ${byText.size}종, 글 없는 패키지 ${noText}개`);
console.log(licenses.join("\n"));
