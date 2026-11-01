import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark, Icon } from "../components/Icon";
import { NewRoomDialog } from "../components/NewRoomDialog";
import { KindLegend, SizeKey } from "../components/KindLegend";
import { HomeSummary, scrollBehavior, SkyPanel } from "../components/SkyPanel";
import { SkyMap } from "../components/SkyMap";
import { SweepDialog } from "../components/SweepDialog";
import { useToast } from "../components/Toast";
import { mergeScan, sweepDue } from "../domain/care";
import { buildRoom, doneAfterDays, looksDone, parseRoomsFile } from "../domain/importFile";
import type { Room } from "../domain/model";
import { roomStats } from "../domain/sky";
import { isNative } from "../gateways/native";
import { planSweep, type SweepPlan } from "../storage/box";
import { forgetRoom, getLastSweepAt, listRooms, patchRoom, saveRoom, setLastSweepAt } from "../storage/db";
import { sampleRooms } from "../storage/sample";

// 주간 정리 창은 앱을 켤 때 한 번만 저절로 뜹니다. 창으로 돌아올 때는 시각만 새로 고치고, 밀린 정리는 버튼 글자로 알립니다.
let sweepChecked = false;

const scanCommand = "node apps/room/scripts/scan-folders.mjs --out folduct-rooms.json 폴더1 폴더2…";

export function Home({ returnTo, onOpen }: { returnTo: string | null; onOpen: (id: string) => void }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastSweepAt, setLastSweep] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [plans, setPlans] = useState<SweepPlan[] | null>(null);
  // 방에서 돌아오면 그 방이 골라진 채로 시작합니다.
  const [selectedId, setSelectedId] = useState(returnTo);
  const [focusId, setFocusId] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const { toast, toastRegion } = useToast();

  const load = useCallback(async () => {
    try {
      const list = await listRooms();
      setRooms(list);
      setLoadFailed(false);
      return list;
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
      return null;
    }
  }, []);

  const start = useCallback(async () => {
    const list = await load();
    if (!list) return;
    try {
      const last = await getLastSweepAt();
      if (last === null) {
        const at = Date.now();
        await setLastSweepAt(at);
        setLastSweep(at);
        return;
      }
      setLastSweep(last);
      if (sweepChecked) return;
      sweepChecked = true;
      if (!sweepDue(last, Date.now())) return;
      const due = await planSweep(list);
      if (due.length > 0) setPlans(due);
    } catch (error) {
      // 정리 확인이 안 돼도 방은 그대로 씁니다.
      console.error(error);
    }
  }, [load]);

  useEffect(() => {
    document.title = "Folduct · 내 방들";
    void start();
  }, [start]);

  // 오래 켜 둔 창으로 돌아오면 시각만 새로 고칩니다. 기울기와 밀린 정리 표시가 따라옵니다.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // 지운 방이 골라져 있으면 고르지 않은 것으로 봅니다.
  const selected = rooms?.find((room) => room.id === selectedId) ?? null;

  // 좁은 창에서는 목록이 지도 아래에 있으니, 방을 고르면 목록이 보이게 내립니다.
  useEffect(() => {
    if (!selected || !matchMedia("(max-width: 719.98px)").matches) return;
    panel.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, [selected?.id]);

  const selectRoom = useCallback((id: string | null) => {
    setSelectedId(id);
    setFocusId(null);
  }, []);
  const focusThing = useCallback((roomId: string, thingId: string) => {
    setSelectedId(roomId);
    setFocusId(thingId);
  }, []);

  const stats = useMemo(() => roomStats(rooms ?? [], now), [rooms, now]);
  const kinds = useMemo(() => new Set((rooms ?? []).flatMap((room) => room.things.map((thing) => thing.kind))), [rooms]);
  let fallen = 0;
  for (const stat of stats.values()) fallen += stat.mess.fallen;
  const overdue = sweepDue(lastSweepAt, now) && fallen > 0;

  const fail = (message: string) => (error: unknown) => {
    console.error(error);
    toast(message);
  };

  async function openSweep() {
    const due = await planSweep(rooms ?? undefined);
    if (due.length === 0) toast("지금은 쓰러진 물건이 없어요. 방들이 깔끔해요.");
    else setPlans(due);
  }

  async function addSample() {
    const samples = sampleRooms(Date.now());
    for (const room of samples) await saveRoom(room);
    setRooms((list) => [...(list ?? []), ...samples]);
    selectRoom(samples[0].id);
  }

  // 샘플 방은 한 번에 치우고, 잠깐 동안 되돌릴 수 있습니다.
  async function clearSamples() {
    const samples = (rooms ?? []).filter((room) => room.source === "sample");
    await Promise.all(samples.map((room) => forgetRoom(room.id)));
    const gone = new Set(samples.map((room) => room.id));
    setRooms((list) => list && list.filter((room) => !gone.has(room.id)));
    toast(`샘플 방 ${samples.length}개를 치웠어요.`, {
      label: "되돌리기",
      run: () => void Promise.all(samples.map((room) => saveRoom(room))).then(load).catch(fail("샘플 방을 되돌리지 못했어요.")),
    });
  }

  // scan-folders 스크립트가 만든 목록으로 방을 한꺼번에 띄웁니다. 이미 있는 폴더는 새로 만들지 않고 다시 봅니다.
  async function importRooms(file: File) {
    const parsed = parseRoomsFile(await file.text());
    if (!parsed) {
      toast(`Folduct 목록 파일이 아니에요. 터미널에서 ${scanCommand} 로 만든 파일을 골라 주세요.`);
      return;
    }
    const at = Date.now();
    const existing = new Map((rooms ?? []).filter((room) => room.origin).map((room) => [room.origin!, room]));
    let added = 0;
    let refreshed = 0;
    let done = 0;
    for (const item of parsed.rooms) {
      const old = existing.get(item.origin);
      if (old) {
        await saveRoom(mergeScan(old, item.files, item, at));
        refreshed += 1;
        continue;
      }
      const finished = looksDone(item.files, at);
      if (finished) done += 1;
      await saveRoom(buildRoom({ name: item.name, source: "input", rootName: item.name, origin: item.origin, files: item.files, scan: item, budgetBytes: null, done: finished, workDays: [], now: at }));
      added += 1;
    }
    toast(
      `새 방 ${added}개${refreshed ? `, 다시 본 방 ${refreshed}개` : ""}를 띄웠어요.` +
        (done ? ` 그중 ${done}개는 ${doneAfterDays}일 넘게 고친 파일이 없어 완료한 방으로 두었어요. 방을 고르면 바꿀 수 있어요.` : "") +
        (parsed.skipped ? ` 읽을 수 없는 항목 ${parsed.skipped}개는 뺐어요.` : ""),
    );
    await load();
  }

  async function toggleDone(id: string) {
    const done = !rooms?.find((room) => room.id === id)?.care.done;
    const saved = await patchRoom(id, (room) => ({ ...room, care: { ...room.care, done } }));
    setRooms((list) => list && list.map((room) => (room.id === id ? saved : room)));
  }

  const saveFailed = "저장하지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.";
  const hasSample = rooms?.some((room) => room.source === "sample");
  return (
    <main className="home">
      <header className="topnav topnav-centered">
        <div className="topnav-brand">
          <BrandMark size={36} />
          <h1 className="sr-only">Folduct</h1>
        </div>
        <div className="row">
          <button type="button" className="quiet" onClick={() => void openSweep().catch(fail("정리할 파일을 찾지 못했어요. 잠시 뒤 다시 해 주세요."))}>
            <Icon name="sweep" />
            주간 정리{overdue ? " · 할 때예요" : ""}
          </button>
          {rooms && !isNative() && (
            <>
              <button type="button" className="quiet" disabled={importing} onClick={() => importInput.current?.click()}>
                <Icon name="import" />
                {importing ? "가져오는 중…" : "목록 파일 가져오기"}
              </button>
              <input
                ref={importInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setImporting(true);
                  void importRooms(file)
                    .catch(fail("가져오지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요."))
                    .finally(() => setImporting(false));
                }}
              />
            </>
          )}
          {hasSample ? (
            <button type="button" className="quiet" onClick={() => void clearSamples().catch(fail("샘플 방을 치우지 못했어요. 잠시 뒤 다시 해 주세요."))}>샘플 방 치우기</button>
          ) : rooms?.length ? (
            <button type="button" className="quiet" onClick={() => void addSample().catch(fail(saveFailed))}>샘플 방 구경하기</button>
          ) : null}
          <button type="button" className="primary" onClick={() => setCreating(true)}>+ 새 방 만들기</button>
        </div>
      </header>

      {loadFailed ? (
        <div className="page-status" role="alert">
          <p>저장소를 열지 못했어요. 저장 공간이 가득 찼거나 다른 창이 쓰고 있을 수 있어요.</p>
          <button type="button" onClick={() => { setLoadFailed(false); void start(); }}>다시 시도</button>
        </div>
      ) : rooms === null ? (
        <p className="loading">저장된 방을 불러오는 중…</p>
      ) : (
        <div className={`sky-layout${rooms.length === 0 ? " is-empty" : ""}`}>
          <section className="sky-stage">
            <SkyMap rooms={rooms} stats={stats} now={now} selectedId={selected?.id ?? null} focusId={focusId} onSelectRoom={selectRoom} onFocusThing={focusThing}>
              {rooms.length === 0 ? (
                <div className="sky-empty">
                  <h2>아직 비어 있어요</h2>
                  <p>작업 폴더를 하나 골라 첫 방을 만들어 보세요. 파일은 형식별 색의 반투명한 오브제가 되고, 클수록 크게 놓여요.</p>
                  <div className="row">
                    <button type="button" className="primary" onClick={() => setCreating(true)}>첫 방 만들기</button>
                    <button type="button" onClick={() => void addSample().catch(fail(saveFailed))}>샘플 방 구경하기</button>
                  </div>
                </div>
              ) : (
                <HomeSummary rooms={rooms} room={selected} stats={stats} />
              )}
            </SkyMap>
            {rooms.length > 0 && (
              <div className="legend-strip">
                <KindLegend kinds={kinds} />
                <SizeKey />
              </div>
            )}
          </section>
          {rooms.length > 0 && (
            <aside className="sky-panel" ref={panel}>
              <SkyPanel
                rooms={rooms}
                room={selected}
                stats={stats}
                now={now}
                focusId={focusId}
                onSelectRoom={selectRoom}
                onFocusThing={focusThing}
                onEnter={onOpen}
                onToggleDone={(id) => void toggleDone(id).catch(fail(saveFailed))}
              />
            </aside>
          )}
        </div>
      )}

      {creating && (
        <NewRoomDialog
          onClose={() => setCreating(false)}
          onCreated={onOpen}
          onOpenExisting={onOpen}
          onCreatedMany={(message) => {
            setCreating(false);
            toast(message);
            void load();
          }}
        />
      )}
      {plans && (
        <SweepDialog
          plans={plans}
          now={now}
          onDone={(changed) => {
            setPlans(null);
            // '다음 주에'도 정리 시각을 미루므로 늘 다시 읽습니다.
            getLastSweepAt().then(setLastSweep, (error: unknown) => console.error(error));
            if (changed) void load();
          }}
        />
      )}
      {toastRegion}
    </main>
  );
}
