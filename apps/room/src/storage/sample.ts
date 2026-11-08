import { dayMs, defaultCare, GB, localDay } from "../domain/care";
import { kindOf, newId, type Room, type RoomFace, type Thing } from "../domain/model";

const MB = 1024 ** 2;

// 실제 파일 없이 구경하는 방들. 정리는 Folduct 안에서만 일어납니다.
// [경로, 크기, 바닥 x(없으면 막 들어온 새 파일), 바닥 y, 며칠 전 손댐, 이유 메모, 며칠 전 방 밖에서 씀]
type Item = [path: string, size: number, x: number | null, y: number, daysAgo: number, note: string, usedAgo?: number];

const workshop: Item[] = [
  ["영상/졸업전시_최종.mov", 2.4 * GB, 7.4, 1.9, 1, "최종 렌더. 상영 전에 색 보정 한 번 더"],
  ["디자인/레퍼런스_v2.psd", 820 * MB, 2.3, 3.1, 41, "표지 색감 참고용"],
  ["압축/사진모음_원본.zip", 640 * MB, 8.5, 5.4, 4, ""],
  ["소리/인터뷰_녹음.m4a", 48 * MB, 4.7, 1.9, 2, "2분 30초부터 인용할 부분"],
  ["그림/표지_시안3.png", 12 * MB, 6.1, 4.4, 35, "시안 3이 제일 나았음"],
  ["문서/기획서.pdf", 3.2 * MB, 3.3, 6.0, 0, "다음 회의 전에 3쪽 고치기"],
  ["표/예산.xlsx", 86 * 1024, 6.6, 7.9, 5, "", 1],
  ["글/메모.md", 4 * 1024, 4.2, 8.3, 0, "오늘 할 일: 자막 맞추기"],
  ["문서/발표자료.key", 210 * MB, null, 0, 0, "", 3],
  ["그림/스케치_01.jpg", 2.1 * MB, null, 0, 0, ""],
  ["글/참고링크.txt", 1200, null, 0, 0, ""],
];

const lecture: Item[] = [
  ["강의/01_오리엔테이션.mp4", 1.6 * GB, 6.8, 2.2, 1, "편집 끝. 자막만 남음"],
  ["강의/02_기초.mp4", 1.4 * GB, 3.0, 2.6, 38, ""],
  ["소스/원본소스.zip", 900 * MB, 8.2, 6.6, 52, "백업용, 지워도 될지 확인"],
  ["소리/배경음악.mp3", 8 * MB, 5.0, 5.6, 4, "저작권 확인 필요", 2],
  ["그림/썸네일.png", 3 * MB, 2.8, 6.4, 0, ""],
  ["글/편집메모.md", 2 * 1024, 4.6, 8.0, 0, "2강 컷 순서 다시"],
  ["글/자막_01.txt", 40 * 1024, null, 0, 0, ""],
];

const photos: Item[] = [
  ["원본/RAW_모음.zip", 2.2 * GB, 7.6, 2.4, 46, "이미 외장하드에 있음"],
  ["보정/표지후보.psd", 300 * MB, 3.2, 2.8, 5, ""],
  ["앨범/앨범_초안.pdf", 25 * MB, 5.4, 5.0, 0, "인쇄소에 보낼 버전"],
  ["여행/여행_001.jpg", 5.4 * MB, 2.6, 5.6, 1, ""],
  ["여행/여행_014.jpg", 4.8 * MB, 7.0, 6.2, 9, "", 3],
  ["여행/여행_027.jpg", 6.1 * MB, 4.2, 7.8, 2, "앨범 첫 장"],
  ["여행/여행_033.jpg", 5.2 * MB, null, 0, 0, ""],
  ["여행/여행_040.jpg", 4.4 * MB, null, 0, 0, ""],
];

function build(name: string, items: Item[], workedAgo: number[], face: RoomFace, now: number): Room {
  const things: Thing[] = items.map(([path, size, x, y, daysAgo, note, usedAgo]) => ({
    id: newId(),
    path,
    name: path.split("/").pop()!,
    kind: kindOf(path),
    size: Math.round(size),
    lastModified: now - 90 * dayMs,
    lastUsedAt: usedAgo === undefined ? null : now - usedAgo * dayMs,
    missing: false,
    spot: x === null ? null : { x, y },
    note,
    touchedAt: x === null ? null : now - daysAgo * dayMs,
    // 바닥에 없던 파일은 방을 만든 뒤에 막 들어온 새 파일로 보여 줘요.
    seenAt: x === null ? now : now - dayMs,
    pinned: false,
    box: null,
  }));
  return {
    id: newId(),
    name,
    // 새 파일 줄이 보이게 방은 하루 전에 만든 것으로 둡니다.
    createdAt: now - dayMs,
    source: "sample",
    rootName: "샘플",
    scan: { complete: true, failed: 0, at: now, freedBytes: 0 },
    things,
    // 최근에 이 방을 쓴 날이 있어야 손대지 않은 물건이 오래됨으로 잡힙니다.
    workDays: workedAgo.map((ago) => localDay(now - ago * dayMs)),
    care: defaultCare,
    doneOfferAt: null,
    face,
  };
}

export function sampleRooms(now = Date.now()): Room[] {
  return [
    build("샘플 작업실", workshop, [10, 6, 3, 1], { shape: 7, color: 0 }, now),
    build("영상 수업", lecture, [11, 8, 4, 2, 0], { shape: 4, color: 1 }, now + 1),
    build("사진 정리", photos, [12, 7, 3, 1], { shape: 6, color: 2 }, now + 2),
  ];
}
