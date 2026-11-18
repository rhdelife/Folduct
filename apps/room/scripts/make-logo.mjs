// 로고 파일을 만듭니다: design/logo/folduct-symbol.svg, public/favicon.svg, 메뉴 막대 아이콘 src-tauri/icons/tray-logo.rgba(36px 날 RGBA). 그림은 art/duct.ts의 drawBrandFace예요.
// shortcut: 메뉴 막대 아이콘은 macOS의 Chrome으로 그려 픽셀을 읽어요(make-duct-sprite.mjs와 같은 방식). 다른 환경이면 Chrome 경로만 바꾸면 돼요.
// 데스크톱 앱 아이콘은 별도 원본으로 만듭니다: npx tauri icon design/logo/app-icon.png
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
const svg = `<!-- 프로도 얼굴 로고. scripts/make-logo.mjs 가 만듦 -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 100 824 824">${plate}</svg>\n`;

writeFileSync(join(root, "design/logo/folduct-symbol.svg"), svg);
writeFileSync(join(root, "public/favicon.svg"), svg);

// 메뉴 막대 아이콘: 18pt × 2배 = 36px. 흰 테·흰 눈이 있어 어두운 막대에서도 보여요. 캔버스에 그려 픽셀을 글자로 꺼내요.
const size = 36;
const page = join(work, "tray.html");
// 메뉴 막대에서는 판 없이 얼굴만 꽉 차게 둬요. 테 반지름 29칸 + 펜 반쯤이라 ±31칸이에요.
const face = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-31 -31 62 62">${paths}</svg>`;
const src = `data:image/svg+xml;base64,${Buffer.from(face).toString("base64")}`;
writeFileSync(page, `<!doctype html><body><script>const i=new Image();i.onload=()=>{const c=document.createElement("canvas");c.width=c.height=${size};const x=c.getContext("2d");x.drawImage(i,0,0,${size},${size});const d=x.getImageData(0,0,${size},${size}).data;let s="";for(const b of d)s+=String.fromCharCode(b);const p=document.createElement("pre");p.id="out";p.textContent=btoa(s);document.body.append(p)};i.src="${src}";</script></body>`);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dom = execFileSync(chrome, ["--headless=new", "--disable-gpu", "--virtual-time-budget=3000", `--user-data-dir=${join(work, "profile")}`, "--dump-dom", pathToFileURL(page).href], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const rgba = Buffer.from(dom.match(/<pre id="out">([^<]+)<\/pre>/)[1], "base64");
if (rgba.length !== size * size * 4) throw new Error(`메뉴 막대 아이콘 크기가 달라요: ${rgba.length}`);
writeFileSync(join(root, "src-tauri/icons/tray-logo.rgba"), rgba);
console.log("로고 파일 세 개를 만들었어요");
