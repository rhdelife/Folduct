import { fitToSquare, halftoneDots, isCutout, markSize, subjectBox, type RoomMark } from "../domain/halftone";

// 이미지를 읽어 방 오브제를 만듭니다. 모두 이 기기 안에서 처리하고, 원본 파일은 건드리지 않아요.
const sourceMax = 512;
const fileMax = 30 * 1024 * 1024;

type Cutout = { ok: true; source: string } | { ok: false; error: string };

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext("2d", { willReadFrequently: true })! };
}

// 배경이 투명한 이미지만 받습니다. 물체만 잘라 작게 저장해요.
export async function cutoutFromFile(file: File): Promise<Cutout> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "이미지 파일을 골라 주세요." };
  if (file.size > fileMax) return { ok: false, error: "30MB보다 작은 이미지를 골라 주세요." };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: "이 이미지를 읽지 못했어요. PNG로 바꿔서 넣어 주세요." };
  }
  const scale = Math.min(1, sourceMax / Math.max(bitmap.width, bitmap.height));
  const { canvas, context } = canvasOf(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const box = subjectBox(pixels);
  if (!box || !isCutout(pixels)) return { ok: false, error: "배경이 투명한 이미지가 필요해요. 사진 앱에서 피사체를 복사해 붙여 넣어 보세요." };
  const crop = canvasOf(box.w, box.h);
  crop.context.drawImage(canvas, -box.x, -box.y);
  return { ok: true, source: crop.canvas.toDataURL("image/png") };
}

// 저장한 원본에서 실루엣과 망점을 그립니다. 둘 다 흰색이고, 색은 화면에서 입혀요.
export async function renderMark(source: string, cell: number): Promise<RoomMark> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const fit = fitToSquare(image.naturalWidth, image.naturalHeight, markSize);

  const paper = canvasOf(markSize, markSize);
  paper.context.drawImage(image, fit.x, fit.y, fit.w, fit.h);
  const pixels = paper.context.getImageData(0, 0, markSize, markSize);
  paper.context.globalCompositeOperation = "source-in";
  paper.context.fillStyle = "white";
  paper.context.fillRect(0, 0, markSize, markSize);

  const ink = canvasOf(markSize, markSize);
  ink.context.fillStyle = "white";
  for (const dot of halftoneDots(pixels, cell)) {
    ink.context.beginPath();
    ink.context.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ink.context.fill();
  }
  return { source, cell, silhouette: paper.canvas.toDataURL("image/png"), dots: ink.canvas.toDataURL("image/png"), height: fit.h / markSize };
}
