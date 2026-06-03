"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "custom-schedule-os-v2";
const BELL_KEY = "custom-bell-enabled";

const defaultScheduleTimes = [
  ["08:10", "09:00"],
  ["09:10", "10:00"],
  ["10:10", "11:00"],
  ["11:10", "12:00"],
  ["12:30", "13:15"],
  ["13:20", "14:10"],
  ["14:20", "15:10"],
  ["15:25", "16:15"],
  ["16:20", "17:10"],
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatClock(date) {
  if (!date) return "--:--:--";
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toMinutes(time) {
  const [h, m] = String(time || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function toTime(minutes) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const h = String(Math.floor(safe / 60)).padStart(2, "0");
  const m = String(safe % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function sortByTime(items) {
  return [...items].sort((a, b) => {
    const at = a.startTime || "99:99";
    const bt = b.startTime || "99:99";
    return at.localeCompare(bt);
  });
}

function daysLeft(targetDate) {
  if (!targetDate) return null;
  const today = new Date(todayKey());
  const target = new Date(targetDate);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function createScheduleItem(startTime, endTime, title = "") {
  return {
    id: createId(),
    startTime,
    endTime,
    title,
    muted: false,
    bellEnabled: true,
    bellTime: startTime,
  };
}

function makeDefaultSchedule() {
  return defaultScheduleTimes.map(([startTime, endTime]) =>
    createScheduleItem(startTime, endTime)
  );
}

function normalizeItems(items) {
  return sortByTime(
    (items || []).map((item) => ({
      ...item,
      muted: item.muted ?? item.bellEnabled === false,
      bellEnabled: item.bellEnabled ?? true,
      bellTime: item.bellTime || item.startTime,
    }))
  );
}

export default function Home() {
  const fileInputRef = useRef(null);
  const audioRef = useRef(null);

  const [now, setNow] = useState(null);
  const [soundReady, setSoundReady] = useState(false);
  const [items, setItems] = useState([]);
  const [notified, setNotified] = useState([]);
  const [lastBell, setLastBell] = useState(null);

  const [countdownTitle, setCountdownTitle] = useState("");
  const [countdownDate, setCountdownDate] = useState("");

  const todayItems = useMemo(() => sortByTime(items), [items]);

  const currentItem = useMemo(() => {
    if (!now) return null;
    const hhmm = now.toTimeString().slice(0, 5);
    return todayItems.find((item) => item.startTime <= hhmm && hhmm < item.endTime) || null;
  }, [now, todayItems]);

  const nextBell = useMemo(() => {
    if (!now) return null;

    const hhmm = now.toTimeString().slice(0, 5);

    const currentClass = todayItems.find(
      (item) =>
        !item.muted &&
        item.startTime <= hhmm &&
        hhmm < item.endTime
    );

    if (currentClass) {
      return {
        time: currentClass.endTime,
        label: "下課鐘",
        title: currentClass.title,
      };
    }

    const bells = todayItems
      .filter((item) => !item.muted)
      .flatMap((item) => [
        {
          time: item.startTime,
          label: "上課鐘",
          title: item.title,
        },
        {
          time: item.endTime,
          label: "下課鐘",
          title: item.title,
        },
      ])
      .filter((bell) => bell.time > hhmm)
      .sort((a, b) => a.time.localeCompare(b.time));

    return bells[0] || null;
  }, [now, todayItems]);

const isBreakTime = useMemo(() => {
  if (!now) return false;
  if (currentItem) return false;

  const hhmm = now.toTimeString().slice(0, 5);

  return todayItems.some((item, index) => {
    const nextItem = todayItems[index + 1];
    if (!nextItem) return false;

    return item.endTime <= hhmm && hhmm < nextItem.startTime;
  });
}, [now, currentItem, todayItems]);

  const countdownDays = daysLeft(countdownDate);

  useEffect(() => {
    setNow(new Date());
    setSoundReady(localStorage.getItem(BELL_KEY) === "true");

    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      try {
        const data = JSON.parse(saved);
        const today = todayKey();
        const savedItems = data.itemsByDate?.[today];

        setItems(
          savedItems && savedItems.length > 0
            ? normalizeItems(savedItems)
            : makeDefaultSchedule()
        );
        setCountdownTitle(data.countdownTitle ?? "");
        setCountdownDate(data.countdownDate ?? "");
      } catch {
        setItems(makeDefaultSchedule());
      }
    } else {
      setItems(makeDefaultSchedule());
    }

    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const today = todayKey();

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...saved,
        itemsByDate: {
          ...(saved.itemsByDate || {}),
          [today]: items,
        },
        countdownTitle,
        countdownDate,
      })
    );
  }, [items, countdownTitle, countdownDate]);

  useEffect(() => {
    if (!now || !soundReady) return;

    const hhmm = now.toTimeString().slice(0, 5);

    todayItems.forEach((item) => {
      if (item.muted) return;

      const bells = [
        { type: "start", time: item.startTime, label: "上課鐘" },
        { type: "end", time: item.endTime, label: "下課鐘" },
      ];

      bells.forEach((bell) => {
        if (bell.time !== hhmm) return;

        const notifyId = `${todayKey()}-${item.id}-${bell.type}-${bell.time}`;
        if (notified.includes(notifyId)) return;

        playBell(`${bell.label}：${item.title || bell.time}`);
        setLastBell({ ...item, bellType: bell.label, bellTime: bell.time });
        setNotified((prev) => [...prev, notifyId]);
      });
    });
  }, [now, soundReady, todayItems, notified]);

  async function enableBell() {
    if (soundReady) return;

    audioRef.current = new Audio("/bell.mp3");
    audioRef.current.volume = 1;
    audioRef.current
      .play()
      .then(() => {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      })
      .catch(() => {});

    localStorage.setItem(BELL_KEY, "true");
    setSoundReady(true);

    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    playBell("打鐘已啟用");
  }

function playBell(message) {
  try {
    const audio = audioRef.current || new Audio("/bell.mp3");
    audio.currentTime = 0;
    audio.volume = 1;
    audio.play().catch(() => {});
  } catch {}

  const isStartBell = message.includes("上課鐘");
  const isEndBell = message.includes("下課鐘");
  const title = isStartBell ? "上課鐘" : isEndBell ? "下課鐘" : "自律管理系統";

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body: message });
  } else {
    alert(title);
  }
}

  function addItem() {
    const last = todayItems[todayItems.length - 1];
    const startTime = last ? last.endTime : "09:00";
    const endTime = toTime(toMinutes(startTime) + 50);
    setItems((prev) => sortByTime([...prev, createScheduleItem(startTime, endTime)]));
  }

  function insertAfter(index) {
    const current = todayItems[index];
    const next = todayItems[index + 1];

    const startTime = current?.endTime || "09:00";
    const nextStart = next?.startTime;
    const endTime =
      nextStart && toMinutes(nextStart) > toMinutes(startTime)
        ? nextStart
        : toTime(toMinutes(startTime) + 50);

    setItems((prev) => {
      const ordered = sortByTime(prev);
      ordered.splice(index + 1, 0, createScheduleItem(startTime, endTime));
      return ordered;
    });
  }

  function updateItem(id, patch) {
    setItems((prev) =>
      sortByTime(prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    );
  }

  function deleteItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function clearToday() {
    if (!confirm("確定清空今天的時間表？")) return;
    setItems([]);
    setNotified([]);
    setLastBell(null);
  }

  function exportData() {
    const data = localStorage.getItem(STORAGE_KEY) || "{}";
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `self-discipline-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        window.location.reload();
      } catch {
        alert("匯入失敗：檔案格式錯誤");
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] text-zinc-950 antialiased dark:bg-[#101012] dark:text-zinc-50">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={importData}
        className="hidden"
      />

      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <header className="mb-5 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-zinc-500 shadow-sm backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
              SELF DISCIPLINE OS
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl dark:text-zinc-50">
              自律管理系統
            </h1>
            <p className="mt-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              今日排程、倒數日與打鐘提醒
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:justify-end">
            <button onClick={exportData} className="topBtn">
              匯出
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="topBtn">
              匯入
            </button>
            <button onClick={enableBell} className="topPrimaryBtn">
              {soundReady ? "已啟用" : "打鐘"}
            </button>
          </div>
        </header>

        <section className="appleCard p-5 sm:p-7 lg:p-8">
          <div className="text-center">
            <div className="sectionLabel">現在時間</div>

            <div className="mt-3 text-[56px] font-semibold leading-none tracking-[-0.08em] text-zinc-950 sm:text-[110px] lg:text-[150px] dark:text-zinc-50">
              {formatClock(now)}
            </div>

            <div className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-2">
              <div className="statusPanel">
                <div className="sectionLabel">目前進行</div>

                {isBreakTime ? (
                  <div className="mt-2 text-[64px] font-semibold leading-none tracking-[-0.08em] text-zinc-950 sm:text-[96px] lg:text-[120px] dark:text-zinc-50">
                    下課
                  </div>
                ) : (
                  <div className="mt-2 truncate text-2xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-3xl dark:text-zinc-50">
                    {currentItem ? currentItem.title || "未填課名" : "目前沒有安排"}
                  </div>
                )}

                {currentItem && (
                  <div className="mt-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                    {currentItem.startTime} - {currentItem.endTime}
                  </div>
                )}
              </div>

              <div className="statusPanel">
                <div className="sectionLabel">下一個打鐘</div>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-3xl dark:text-zinc-50">
                  {nextBell ? nextBell.time : "--:--"}
                </div>
                <div className="mt-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  {nextBell ? nextBell.label : "今天沒有下一個打鐘"}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 overflow-hidden rounded-[34px] bg-zinc-950 text-white shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
          <div className="px-6 py-8 text-center sm:px-8 sm:py-10">
            <div className="text-xs font-semibold tracking-[0.32em] text-zinc-400">
              COUNTDOWN
            </div>

            <div className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              {countdownTitle || "尚未設定"}
            </div>

            <div className="mt-5 text-[88px] font-semibold leading-none tracking-[-0.08em] sm:text-[128px]">
              {countdownDays === null ? "--" : countdownDays}
            </div>

            <div className="mt-2 text-base font-semibold tracking-[0.42em] text-zinc-400 sm:text-xl">
              DAYS
            </div>
          </div>
        </section>

        <section className="mt-4 appleCard p-5 sm:p-6">
          <div className="sectionLabel">Guide</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-3xl dark:text-zinc-50">
            使用說明
          </h2>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="guideCard">
              <div className="text-lg font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
                1. 設定時間表
              </div>
              <p className="mt-2 text-sm font-medium leading-6 text-zinc-500 dark:text-zinc-400">
                新增每一節課或任務，填入開始時間、結束時間與名稱。
              </p>
            </div>

            <div className="guideCard">
              <div className="text-lg font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
                2. 啟用打鐘
              </div>
              <p className="mt-2 text-sm font-medium leading-6 text-zinc-500 dark:text-zinc-400">
                第一次使用請點右上角打鐘，瀏覽器允許通知後才會播放。
              </p>
            </div>

            <div className="guideCard">
              <div className="text-lg font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
                3. 靜音單節
              </div>
              <p className="mt-2 text-sm font-medium leading-6 text-zinc-500 dark:text-zinc-400">
                不想讓某一節打鐘，就勾選「靜音這節」。
              </p>
            </div>
          </div>
        </section>

        <section className="mt-4 appleCard p-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="sectionLabel">Schedule</div>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-3xl dark:text-zinc-50">
                今日時間表
              </h2>
              <p className="mt-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                開始時間打上課鐘，結束時間打下課鐘。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button onClick={addItem} className="smallPrimaryBtn">
                新增一節
              </button>
              <button onClick={clearToday} className="smallDangerBtn">
                清空今日
              </button>
            </div>
          </div>

          {todayItems.length === 0 ? (
            <div className="rounded-[32px] border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center dark:border-zinc-700 dark:bg-zinc-900/70">
              <div className="text-2xl font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
                今天尚未安排
              </div>
              <p className="mt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                先新增第一節，再設定時間與名稱。
              </p>
              <button onClick={addItem} className="mt-5 smallPrimaryBtn">
                新增第一節
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {todayItems.map((item, index) => {
                const isCurrent = currentItem?.id === item.id;

                return (
                  <div key={item.id}>
                    <div
                      className={`rounded-[32px] border p-4 transition ${
                        isCurrent
                          ? "border-zinc-950 bg-zinc-50 shadow-sm dark:border-zinc-100 dark:bg-zinc-800/80"
                          : item.done
                            ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="sectionLabel">
                            {isCurrent ? "目前進行" : `第 ${index + 1} 節`}
                          </div>
                          <div className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
                            {item.startTime} - {item.endTime}
                          </div>
                        </div>

                        <button
                          onClick={() => deleteItem(item.id)}
                          className="ghostDangerBtn"
                        >
                          刪除
                        </button>
                      </div>

                      <input
                        value={item.title}
                        onChange={(e) => updateItem(item.id, { title: e.target.value })}
                        placeholder="課名 / 任務名稱"
                        className={`mt-4 w-full rounded-[22px] border border-zinc-200 bg-zinc-50 px-4 py-4 text-lg font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-4 focus:ring-zinc-200/70 sm:text-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600 dark:focus:bg-zinc-950 dark:focus:ring-zinc-700/50 ${
                          item.done ? "text-zinc-950" : "text-zinc-950"
                        }`}
                      />

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <input
                          type="time"
                          value={item.startTime}
                          onChange={(e) =>
                            updateItem(item.id, {
                              startTime: e.target.value,
                              bellTime: e.target.value,
                            })
                          }
                          className="timeInput"
                        />

                        <input
                          type="time"
                          value={item.endTime}
                          onChange={(e) => updateItem(item.id, { endTime: e.target.value })}
                          className="timeInput"
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <label className="pillCheck">
                          <input
                            type="checkbox"
                            checked={item.muted}
                            onChange={(e) =>
                              updateItem(item.id, {
                                muted: e.target.checked,
                                bellEnabled: !e.target.checked,
                              })
                            }
                            className="h-4 w-4 accent-zinc-950 dark:accent-zinc-50"
                          />
                          靜音這節
                        </label>
                      </div>
                    </div>

                    <button
                      onClick={() => insertAfter(index)}
                      className="mx-auto mt-2 block rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-500 transition hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      ＋ 插入一節
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-4 appleCard p-5 sm:p-6">
          <div className="sectionLabel">Countdown Settings</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
            倒數日編輯
          </h2>
          <p className="mt-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            編輯完成後，上方倒數日卡片會自動更新。
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <input
              value={countdownTitle}
              onChange={(e) => setCountdownTitle(e.target.value)}
              placeholder="事件名稱"
              className="formInput"
            />

            <input
              type="date"
              value={countdownDate}
              onChange={(e) => setCountdownDate(e.target.value)}
              className="formInput"
            />
          </div>
        </section>

        <footer className="px-2 py-8 text-center text-xs font-medium text-zinc-400 dark:text-zinc-600">
          Self Discipline OS · Local First
        </footer>
      </div>

      <style jsx>{`
        .appleCard {
          border-radius: 34px;
          border: 1px solid rgb(228 228 231);
          background: rgba(255, 255, 255, 0.86);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          backdrop-filter: blur(20px);
        }

        :global(.dark) .appleCard {
          border-color: rgb(39 39 42);
          background: rgba(24, 24, 27, 0.84);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
        }

        .sectionLabel {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgb(113 113 122);
        }

        :global(.dark) .sectionLabel {
          color: rgb(161 161 170);
        }

        .statusPanel,
        .guideCard {
          border-radius: 28px;
          border: 1px solid rgb(228 228 231);
          background: rgb(250 250 250);
          padding: 1.15rem;
        }

        :global(.dark) .statusPanel,
        :global(.dark) .guideCard {
          border-color: rgb(39 39 42);
          background: rgb(24 24 27);
        }

        .topBtn {
          min-height: 44px;
          border-radius: 9999px;
          border: 1px solid rgb(212 212 216);
          background: rgba(255, 255, 255, 0.9);
          padding: 0.72rem 0.95rem;
          font-size: 0.875rem;
          font-weight: 700;
          color: rgb(63 63 70);
          transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
        }

        .topBtn:hover {
          background: rgb(250 250 250);
          border-color: rgb(161 161 170);
        }

        .topBtn:active {
          transform: scale(0.98);
        }

        .topBtn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(161, 161, 170, 0.28);
        }

        :global(.dark) .topBtn {
          border-color: rgb(63 63 70);
          background: rgba(39, 39, 42, 0.86);
          color: rgb(228 228 231);
        }

        :global(.dark) .topBtn:hover {
          background: rgb(63 63 70);
        }

        .topPrimaryBtn {
          min-height: 44px;
          border-radius: 9999px;
          background: rgb(9 9 11);
          padding: 0.72rem 0.95rem;
          font-size: 0.875rem;
          font-weight: 800;
          color: white;
          transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease;
        }

        .topPrimaryBtn:hover {
          background: rgb(39 39 42);
        }

        .topPrimaryBtn:active {
          transform: scale(0.98);
        }

        .topPrimaryBtn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(24, 24, 27, 0.22);
        }

        :global(.dark) .topPrimaryBtn {
          background: rgb(244 244 245);
          color: rgb(9 9 11);
        }

        :global(.dark) .topPrimaryBtn:hover {
          background: white;
        }

        .smallPrimaryBtn {
          min-height: 48px;
          border-radius: 9999px;
          background: rgb(9 9 11);
          padding: 0.8rem 1.15rem;
          font-size: 0.875rem;
          font-weight: 800;
          color: white;
          transition: transform 0.15s ease, background 0.15s ease;
        }

        .smallPrimaryBtn:hover {
          background: rgb(39 39 42);
        }

        .smallPrimaryBtn:active {
          transform: scale(0.98);
        }

        .smallPrimaryBtn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(24, 24, 27, 0.22);
        }

        :global(.dark) .smallPrimaryBtn {
          background: rgb(244 244 245);
          color: rgb(9 9 11);
        }

        .smallDangerBtn {
          min-height: 48px;
          border-radius: 9999px;
          border: 1px solid rgb(228 228 231);
          background: white;
          padding: 0.8rem 1.15rem;
          font-size: 0.875rem;
          font-weight: 800;
          color: rgb(180 83 9);
          transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
        }

        .smallDangerBtn:hover {
          background: rgb(255 251 235);
          border-color: rgb(253 230 138);
        }

        .smallDangerBtn:active {
          transform: scale(0.98);
        }

        .smallDangerBtn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.18);
        }

        :global(.dark) .smallDangerBtn {
          border-color: rgb(63 63 70);
          background: rgb(24 24 27);
          color: rgb(251 191 36);
        }

        :global(.dark) .smallDangerBtn:hover {
          background: rgb(39 39 42);
        }

        .ghostDangerBtn {
          min-height: 36px;
          border-radius: 9999px;
          border: 1px solid rgb(228 228 231);
          background: white;
          padding: 0.45rem 0.8rem;
          font-size: 0.75rem;
          font-weight: 800;
          color: rgb(113 113 122);
          transition: transform 0.15s ease, background 0.15s ease, color 0.15s ease;
        }

        .ghostDangerBtn:hover {
          background: rgb(254 242 242);
          color: rgb(185 28 28);
        }

        .ghostDangerBtn:active {
          transform: scale(0.98);
        }

        .ghostDangerBtn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.16);
        }

        :global(.dark) .ghostDangerBtn {
          border-color: rgb(63 63 70);
          background: rgb(24 24 27);
          color: rgb(161 161 170);
        }

        :global(.dark) .ghostDangerBtn:hover {
          background: rgb(69 10 10);
          color: rgb(254 202 202);
        }

        .formInput {
          min-height: 58px;
          width: 100%;
          border-radius: 22px;
          border: 1px solid rgb(228 228 231);
          background: rgb(250 250 250);
          padding: 0.95rem 1rem;
          font-size: 1rem;
          font-weight: 700;
          color: rgb(24 24 27);
          outline: none;
          transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .formInput::placeholder {
          color: rgb(161 161 170);
        }

        .formInput:focus {
          border-color: rgb(161 161 170);
          background: white;
          box-shadow: 0 0 0 4px rgba(161, 161, 170, 0.22);
        }

        :global(.dark) .formInput {
          border-color: rgb(63 63 70);
          background: rgb(24 24 27);
          color: rgb(244 244 245);
        }

        :global(.dark) .formInput::placeholder {
          color: rgb(113 113 122);
        }

        :global(.dark) .formInput:focus {
          border-color: rgb(113 113 122);
          background: rgb(24 24 27);
          box-shadow: 0 0 0 4px rgba(113, 113, 122, 0.22);
        }

        .timeInput {
          min-height: 56px;
          border-radius: 20px;
          border: 1px solid rgb(228 228 231);
          background: rgb(250 250 250);
          padding: 0.85rem 1rem;
          font-size: 0.95rem;
          font-weight: 800;
          color: rgb(24 24 27);
          outline: none;
          transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .timeInput:focus {
          border-color: rgb(161 161 170);
          background: white;
          box-shadow: 0 0 0 4px rgba(161, 161, 170, 0.22);
        }

        :global(.dark) .timeInput {
          border-color: rgb(63 63 70);
          background: rgb(24 24 27);
          color: rgb(244 244 245);
        }

        :global(.dark) .timeInput:focus {
          border-color: rgb(113 113 122);
          background: rgb(24 24 27);
          box-shadow: 0 0 0 4px rgba(113, 113, 122, 0.22);
        }

        .pillCheck {
          min-height: 44px;
          display: flex;
          align-items: center;
          gap: 0.55rem;
          border-radius: 9999px;
          border: 1px solid rgb(228 228 231);
          background: rgb(250 250 250);
          padding: 0.65rem 1rem;
          font-size: 0.875rem;
          font-weight: 800;
          color: rgb(63 63 70);
          user-select: none;
        }

        :global(.dark) .pillCheck {
          border-color: rgb(63 63 70);
          background: rgb(24 24 27);
          color: rgb(212 212 216);
        }
      `}</style>
    </main>
  );
}