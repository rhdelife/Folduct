import { makePen, type DuctPiece } from "../art/duct";
import { poly, ring } from "../art/paperArts";

export type IconName = "sweep" | "import" | "pin" | "settings" | "close" | "trash" | "chevron" | "work" | "pause" | "play";

// 프로도와 같은 펜으로 그린 손그림 아이콘(2026-11-18 요청). 200칸 격자의 절대 좌표 길(M·L·C·Z)을 makePen이 흔들리는 잉크 면으로 바꿔요.
// 색은 글자색(currentColor)을 따라가고, 뜻은 늘 옆의 글자가 말합니다. 그림은 한 번만 만들어 둬요.
const lines: Record<IconName, string[]> = {
  sweep: ["M170 30L110 90", "M95 75L125 105", poly([[95, 75], [30, 100], [100, 170], [125, 105]]), "M105 85L53 123", "M115 95L77 147"],
  import: [poly([[30, 110], [30, 165], [170, 165], [170, 110]]), "M100 30L100 120", poly([[65, 85], [100, 120], [135, 85]])],
  pin: ["M65 30L135 30", poly([[80, 30], [80, 75], [50, 110], [50, 130], [150, 130], [150, 110], [120, 75], [120, 30]]), "M100 130L100 172"],
  trash: ["M40 60L160 60", poly([[80, 60], [80, 44], [120, 44], [120, 60]]), poly([[55, 60], [64, 165], [136, 165], [145, 60]]), "M85 92L85 138", "M115 92L115 138"],
  close: ["M52 52L148 148", "M148 52L52 148"],
  chevron: [poly([[80, 50], [130, 100], [80, 150]])],
  work: [ring(100, 106, 62), poly([[100, 70], [100, 106], [124, 120]]), "M84 22L116 22"],
  pause: ["M72 48L72 152", "M128 48L128 152"],
  play: [poly([[64, 44], [156, 100], [64, 156]], true)],
  settings: [ring(100, 100, 24), ring(100, 100, 50), "M100 22L100 50", "M100 150L100 178", "M22 100L50 100", "M150 100L178 100", "M45 45L65 65", "M135 135L155 155", "M45 155L65 135", "M135 65L155 45"],
};
const pen = makePen(7, 2.6, 1);
const shapes = Object.fromEntries(Object.entries(lines).map(([name, ds]) => [name, ds.flatMap((d) => pen(d, 17))])) as Record<IconName, DuctPiece[]>;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 200 200" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      {shapes[name].map((piece, at) => <path key={at} d={piece.d} fillRule={piece.even ? "evenodd" : undefined} />)}
    </svg>
  );
}

// 웹 로고는 데스크톱 앱 아이콘과 같은 입체 프로도 얼굴(design/logo/app-icon.png → public/app-icon.png, 2026-11-18 요청)이에요. size는 높이예요.
export function BrandMark({ size }: { size: number }) {
  return <img className="mark" src="/app-icon.png" width={size} height={size} alt="" />;
}
