// 연결한 폴더에서 가져온 File을 브라우저 디코더로 읽어요. 재생이나 업로드는 하지 않아요.
export function readVideo<T>(file: File, event: "loadedmetadata" | "loadeddata", read: (video: HTMLVideoElement) => T | null): Promise<T | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = event === "loadedmetadata" ? "metadata" : "auto";
  video.muted = true;
  return new Promise((resolve) => {
    const finish = (value: T | null) => {
      clearTimeout(timeout);
      video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const failed = () => finish(null);
    const ready = () => {
      let value: T | null = null;
      try { value = read(video); } catch { /* 코덱이나 캔버스가 이 장면을 못 읽어요. */ }
      finish(value);
    };
    const timeout = setTimeout(failed, 8000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.src = url;
  });
}
