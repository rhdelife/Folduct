import type { Room } from "../../domain/model";
import type { RoomStat } from "../../domain/sky";
import type { OpenRoomMenu } from "../ContextMenu";

// 홈 머리줄 탭이 Home이 아닌 화면(Drawer·Icons)을 보고 있나요.
export const awayFromHome = () => (document.querySelector<HTMLElement>(".home")?.dataset.view ?? "home") !== "home";

export type HomeActions = {
  selectRoom: (id: string | null) => void;
  focusThing: (roomId: string, thingId: string) => void;
  openRoom: (id: string) => void;
  openSweep: () => void;
  // 방에 들어가지 않고 파일을 봅니다.
  openFile: (roomId: string, thingId: string) => void;
  // 파일을 다른 방 폴더로 옮겨요. 데스크톱 앱에서만 있고, 아니면 null이에요.
  moveThing: ((roomId: string, thingId: string, toRoomId: string) => void) | null;
  openNew: () => void;
  openMenu: () => void;
  // 데스크톱 앱에는 목록 파일 가져오기가 없어 null입니다.
  importList: (() => void) | null;
  addSample: () => void;
  clearSamples: () => void;
  roomMenu: OpenRoomMenu;
  toggleDone: (id: string, done: boolean) => void;
};

export type SceneProps = {
  rooms: Room[];
  stats: Map<string, RoomStat>;
  now: number;
  actions: HomeActions;
};
