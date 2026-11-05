// 인트로의 먹는 스프라이트 시트를 만듭니다: src/art/duct-eat.png. 프레임을 고치면(art/duct.ts) 다시 돌립니다.
// shortcut: macOS의 Chrome으로 투명 PNG를 찍습니다. 다른 환경에서 만들 일이 생기면 Chrome 경로만 바꾸면 돼요.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const work = mkdtempSync(join(tmpdir(), "duct-sprite-"));
execFileSync(join(root, "node_modules/.bin/esbuild"), [join(root, "src/art/duct.ts"), "--bundle", "--format=esm", `--outfile=${join(work, "duct.mjs")}`, "--log-level=error"]);
const { drawEatFrame, eatBoard, eatFrameCount } = await import(pathToFileURL(join(work, "duct.mjs")).href);

// 벡터 그림(.duct-ink, .duct-white)과 같은 색. 파일에 담기는 그림이라 토큰을 쓸 수 없어요.
const fills = { ink: "#171717", white: "#ffffff", foot: "#ffffff", paper: "#ffffff" };
const frameWidth = 640;
const scale = frameWidth / eatBoard.width;
const frameHeight = Math.round(eatBoard.height * scale);
// 인트로 벡터 그림의 선 굵기와 같아야 0번 프레임에서 이어집니다(Intro.tsx의 introPx).
const introPx = 240;
const path = (piece) => `<path d="${piece.d}" fill="${fills[piece.tone]}"${piece.even ? ' fill-rule="evenodd"' : ""}/>`;
const cells = Array.from({ length: eatFrameCount }, (_, at) => {
  const { viewBox, items } = drawEatFrame(at, introPx);
  const inner = items.map((item) => ("parts" in item ? `<g${item.transform ? ` transform="${item.transform}"` : ""}>${item.parts.map(path).join("")}</g>` : path(item))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" x="${at * frameWidth}" y="0" width="${frameWidth}" height="${frameHeight}" viewBox="${viewBox}">${inner}</svg>`;
}).join("");
const width = frameWidth * eatFrameCount;
const page = join(work, "sheet.html");
writeFileSync(page, `<!doctype html><html style="background:transparent"><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${frameHeight}" style="display:block">${cells}</svg></body></html>`);
const out = join(root, "src/art/duct-eat.png");
mkdirSync(dirname(out), { recursive: true });
execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--default-background-color=00000000", `--window-size=${width},${frameHeight}`, `--user-data-dir=${join(work, "profile")}`, `--screenshot=${out}`, pathToFileURL(page).href], { stdio: "ignore" });
console.log(`${eatFrameCount}프레임 ${width}×${frameHeight} → ${out}`);
