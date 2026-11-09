// 운영체제마다 다른 것을 한곳에 모읍니다: 경로 구분자, 금지된 이름, OS 오류 번호, 화면에 쓰는 말. 화면·저장소와 무관한 순수 함수만 둡니다.
export type Os = "mac" | "windows" | "linux";

export function osOf(userAgent: string): Os {
  if (/windows/i.test(userAgent)) return "windows";
  return /macintosh|mac os/i.test(userAgent) ? "mac" : "linux";
}

export const currentOs = (): Os => osOf(typeof navigator === "undefined" ? "" : navigator.userAgent);

const fileManagers: Record<Os, string> = { mac: "Finder", windows: "파일 탐색기", linux: "파일 관리자" };
export const fileManagerName = (os = currentOs()): string => fileManagers[os];

// 숨긴 플로팅 창이 들어가는 아이콘 자리. Linux 데스크톱은 알림 영역이 없을 수도 있어요.
const trayPlaces: Record<Os, string> = { mac: "메뉴 막대", windows: "알림 영역", linux: "알림 영역" };
export const trayPlaceName = (os = currentOs()): string => trayPlaces[os];

const permissionHints: Record<Os, string> = {
  mac: "시스템 설정 > 개인정보 보호 및 보안 > 파일 및 폴더에서 허용해 주세요.",
  windows: "폴더 속성의 보안 탭과 Windows 보안의 ‘제어된 폴더 액세스’를 확인해 주세요.",
  linux: "폴더의 읽기·쓰기 권한을 확인해 주세요.",
};
export const permissionHint = (os = currentOs()): string => permissionHints[os];

// 경로 모양만 봅니다. 유닉스에서는 \도 이름에 쓸 수 있는 글자라, 구분자로 치면 안 돼요. 폴더 대화상자는 늘 절대 경로를 줍니다.
const isWindowsPath = (path: string): boolean => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path);

const withoutTrailing = (path: string): string => path.replace(isWindowsPath(path) ? /[\\/]+$/ : /\/+$/, "");

export function joinPath(dir: string, name: string): string {
  return `${withoutTrailing(dir)}${isWindowsPath(dir) ? "\\" : "/"}${name}`;
}

export function baseName(path: string): string {
  const trimmed = withoutTrailing(path);
  const cut = isWindowsPath(path) ? Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) : trimmed.lastIndexOf("/");
  return trimmed.slice(cut + 1) || path;
}

// 같은 폴더인지. Windows는 대소문자와 구분자를 가리지 않습니다. macOS·리눅스는 대소문자를 구분하는 디스크가 있어 그대로 비교해요.
export function samePath(a: string, b: string): boolean {
  const key = (path: string) => {
    const text = withoutTrailing(path).normalize("NFC");
    return isWindowsPath(path) ? text.replaceAll("/", "\\").toLowerCase() : text;
  };
  return key(a) === key(b);
}

export function shortPath(path: string): string {
  return path.replace(/^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/i, "~");
}

const windowsReserved = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])\s*(?:\..*)?$/i;

// Windows가 다른 뜻으로 읽는 이름. 콜론은 드라이브·대체 데이터 스트림이 되고, 끝의 점·공백은 잘려 다른 파일을 가리켜요. 그러면 '덮어쓰지 않기' 확인이 어긋납니다.
export function isSafeWindowsName(name: string): boolean {
  return name.length > 0 && !/[<>:"|?*\\/\u0000-\u001f]/.test(name) && !/[. ]$/.test(name) && !windowsReserved.test(name);
}

// 폴더 바로 아래 항목의 경로. Windows 폴더 안에서는 위 이름을 거절합니다. 읽기·옮기기 모두 이 길로 지나가요.
export function childPath(dir: string, name: string): string {
  if (isWindowsPath(dir) && !isSafeWindowsName(name)) throw new DOMException("안전하지 않은 이름", "NotAllowedError");
  return joinPath(dir, name);
}

export type OsErrorKind = "denied" | "gone" | "crossDevice" | "busy";

// 같은 번호가 OS마다 다른 뜻입니다. 17은 Windows에서 다른 드라이브지만 유닉스에서는 '이미 있음'이고, 5는 Windows에서 권한 없음이지만 유닉스에서는 입출력 오류예요.
const unixErrors: Record<number, OsErrorKind> = { 1: "denied", 13: "denied", 2: "gone", 18: "crossDevice", 16: "busy", 26: "busy" };
const windowsErrors: Record<number, OsErrorKind> = { 5: "denied", 2: "gone", 3: "gone", 21: "gone", 53: "gone", 67: "gone", 17: "crossDevice", 32: "busy", 33: "busy" };

// Tauri는 오류를 문자열로 줍니다. 번호를 먼저 믿어요. Windows 글은 시스템 언어로 번역되고, 글에는 경로가 섞여 있으니까요.
export function osErrorKind(text: string, os = currentOs()): OsErrorKind | null {
  const number = /os error (\d+)\b/i.exec(text)?.[1];
  const known = number === undefined ? undefined : (os === "windows" ? windowsErrors : unixErrors)[Number(number)];
  if (known) return known;
  if (/forbidden path|not allowed|operation not permitted|permission denied|access is denied/i.test(text)) return "denied";
  if (/cross-device|different disk/i.test(text)) return "crossDevice";
  if (/being used by another process|resource busy/i.test(text)) return "busy";
  return /no such file|not found|cannot find the (?:file|path)/i.test(text) ? "gone" : null;
}
