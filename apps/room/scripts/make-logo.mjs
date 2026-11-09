// 로고 파일 세 개를 만듭니다: design/logo/folduct-symbol.svg, design/logo/app-icon.svg, public/favicon.svg. 그림은 art/duct.ts의 drawBrandFace예요.
// 앱 아이콘은 이어서 돌립니다: npx tauri icon design/logo/app-icon.svg
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "logo-"));
execFileSync(join(root, "node_modules/.bin/esbuild"), [join(root, "src/art/duct.ts"), "--bundle", "--format=esm", `--outfile=${join(work, "duct.mjs")}`, "--log-level=error"]);
const { drawBrandFace } = await import(pathToFileURL(join(work, "duct.mjs")).href);

// --brand, --surface, --line-strong 과 같은 색. 파일에 담기는 그림이라 토큰을 쓸 수 없어요.
const { viewBox, items } = drawBrandFace();
const paths = items.map((p) => `<path d="${p.d}" fill="${p.tone === "ink" ? "#171717" : "#fff"}"${p.even ? ' fill-rule="evenodd"' : ""}/>`).join("");
const plate = `<rect x="100" y="100" width="824" height="824" rx="185" fill="#fff"/><svg x="100" y="100" width="824" height="824" viewBox="${viewBox}">${paths}</svg><rect x="100" y="100" width="824" height="824" rx="185" fill="none" stroke="#111" stroke-opacity=".08" stroke-width="4"/>`;
const svg = (box) => `<!-- 프로도 얼굴 로고. scripts/make-logo.mjs 가 만듦 -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${plate}</svg>\n`;

writeFileSync(join(root, "design/logo/folduct-symbol.svg"), svg("100 100 824 824"));
writeFileSync(join(root, "public/favicon.svg"), svg("100 100 824 824"));
writeFileSync(join(root, "design/logo/app-icon.svg"), svg("0 0 1024 1024"));
console.log("로고 세 개를 만들었어요");
