import { useSyncExternalStore } from "react";
import { deletePicture, listPictures, putPicture, type StoredPicture } from "./db";

// 파일마다 사용자가 고른 그림을 종이 위에 보여 줍니다. 물건 id(UUID)로 찾아서 ObjectShape 어디서든 같은 그림이 나와요.
// 그림은 앱 저장소에만 두고, 사용자 폴더에는 아무것도 쓰지 않아요.

// 가장 큰 방 오브제(약 120px)를 2배 화면에서도 또렷하게.
export const pictureSide = 384;
// 이보다 큰 원본은 줄이기 전에 메모리를 너무 써서 받지 않아요.
export const pictureSourceLimit = 40 * 1024 ** 2;

const shown = new Map<string, string>();
// 처음 읽기가 끝나기 전에 바꾸거나 지운 물건은 읽어 온 옛 값으로 덮지 않아요.
const changed = new Set<string>();
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

const notify = () => listeners.forEach((listener) => listener());
const urlOf = (picture: StoredPicture) => URL.createObjectURL(new Blob([picture.bytes], { type: picture.type }));

function show(thing: string, url: string | null) {
  const old = shown.get(thing);
  if (old) URL.revokeObjectURL(old);
  if (url) shown.set(thing, url);
  else shown.delete(thing);
  notify();
}

function load() {
  loading ??= listPictures().then(
    (list) => {
      for (const { thing, picture } of list) if (!changed.has(thing) && !shown.has(thing)) shown.set(thing, urlOf(picture));
      notify();
    },
    // 못 읽으면 기본 그림으로 두고, 다음에 그릴 때 다시 읽어요.
    () => {
      loading = null;
    },
  );
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

// 물건 id가 없으면(범례 등) 늘 기본 그림이에요.
export function usePicture(thing?: string): string | undefined {
  return useSyncExternalStore(subscribe, () => (thing ? shown.get(thing) : undefined), () => undefined);
}

export function fitWithin(width: number, height: number, max = pictureSide) {
  // 크기를 모르는 그림(폭·높이 없는 SVG)은 정사각형으로 그려요.
  if (!(width > 0 && height > 0)) return { width: max, height: max };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// JPEG 사진만 JPEG로, 나머지는 투명한 곳이 검게 바뀌지 않게 PNG로 줄여요(.ico·확장자 없는 파일 등).
export const outputType = (sourceType: string) => (sourceType === "image/jpeg" ? "image/jpeg" : "image/png");
// 압축이 잘 된 큰 그림은 파일은 작아도 풀면 GB가 돼요. 풀기 전에 화소 수로 막아요.
export const pictureMaxPixels = 50_000_000;

export class PictureError extends Error {}

async function shrink(file: File): Promise<StoredPicture> {
  if (file.size > pictureSourceLimit) throw new PictureError("이미지가 너무 커요. 40MB까지 고를 수 있어요.");
  const source = URL.createObjectURL(file);
  try {
    // <img>로 읽어야 SVG와 macOS의 HEIC도 그릴 수 있어요. load는 머리만 읽어 크기를 알려 주고, 다 푸는 건 그릴 때예요.
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new PictureError("이 이미지는 읽지 못했어요."));
      image.src = source;
    });
    if (image.naturalWidth * image.naturalHeight > pictureMaxPixels) throw new PictureError("이미지가 너무 커요. 더 작은 이미지를 골라 주세요.");
    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
    const type = outputType(file.type);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
    if (!blob) throw new PictureError("이 이미지는 읽지 못했어요.");
    return { type: blob.type || type, bytes: await blob.arrayBuffer() };
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function setPicture(room: string, thing: string, file: File): Promise<void> {
  const picture = await shrink(file);
  await putPicture(room, thing, picture);
  changed.add(thing);
  show(thing, urlOf(picture));
}

export async function clearPicture(room: string, thing: string): Promise<void> {
  await deletePicture(room, thing);
  changed.add(thing);
  show(thing, null);
}
