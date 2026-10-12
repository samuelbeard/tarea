import { listen } from "@tauri-apps/api/event";
import { dirname } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTodo,
  deleteTodo,
  errorMessage,
  getLibrary,
  listDays,
  loadDay,
  moveTodo,
  prepareToday,
  recentProjects,
  saveNote,
  setLibrary,
  updateTodo,
} from "./api";
import "./App.css";
import { DaySidebar } from "./components/DaySidebar";
import {
  SettingsDialog,
  type SettingsTab,
} from "./components/SettingsDialog";
import { SetupScreen } from "./components/SetupScreen";
import { TitleBar } from "./components/TitleBar";
import { TodoPane } from "./components/TodoPane";
import {
  addDays,
  addMonths,
  cursorFromISO,
  todayISO,
  type MonthCursor,
} from "./dates";
import { focusFirstTodo, isTyping } from "./shortcuts";
import type { Todo, TodoPatch } from "./types";

function App() {
  const [library, setLibraryPath] = useState<string | null | undefined>(
    undefined,
  );
  const [today, setToday] = useState(todayISO);
  const [selected, setSelected] = useState(todayISO);
  const [cursor, setCursor] = useState<MonthCursor>(() =>
    cursorFromISO(todayISO()),
  );
  const [days, setDays] = useState<string[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [note, setNote] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [carried, setCarried] = useState(0);
  const [booting, setBooting] = useState(true);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [focusAddRequest, setFocusAddRequest] = useState(0);
  const todayRef = useRef(today);
  const selectedRef = useRef(selected);
  const request = useRef(0);
  const shownProblems = useRef("");
  todayRef.current = today;
  selectedRef.current = selected;

  // Shows file problems from the backend once, rather than on every reload.
  const reportProblems = useCallback((...lists: string[][]) => {
    const message = [...new Set(lists.flat())].join("\n");
    if (message === shownProblems.current) return;
    shownProblems.current = message;
    if (message) setError(message);
  }, []);

  const reload = useCallback(async (day: string) => {
    const token = ++request.current;
    const prepared = await prepareToday();
    if (prepared.moved > 0) setCarried(prepared.moved);
    if (request.current !== token) return prepared.today;
    setToday(prepared.today);
    todayRef.current = prepared.today;
    const [nextDays, items, recent] = await Promise.all([
      listDays(),
      loadDay(day),
      recentProjects(),
    ]);
    if (request.current !== token) return prepared.today;
    setDays(nextDays);
    setProjects(recent);
    if (selectedRef.current === day) {
      setTodos(items.todos);
      setNote(items.note);
    }
    reportProblems(prepared.problems, items.problems);
    return prepared.today;
  }, [reportProblems]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = await getLibrary();
        if (cancelled) return;
        if (!path) {
          setLibraryPath(null);
          return;
        }
        setLibraryPath(path);
        const prepared = await prepareToday();
        if (cancelled) return;
        if (prepared.moved > 0) setCarried(prepared.moved);
        setToday(prepared.today);
        todayRef.current = prepared.today;
        setSelected(prepared.today);
        selectedRef.current = prepared.today;
        setCursor(cursorFromISO(prepared.today));
        const [nextDays, items, recent] = await Promise.all([
          listDays(),
          loadDay(prepared.today),
          recentProjects(),
        ]);
        if (cancelled) return;
        setDays(nextDays);
        setTodos(items.todos);
        setNote(items.note);
        setProjects(recent);
        reportProblems(prepared.problems, items.problems);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportProblems]);

  useEffect(() => {
    if (!library) return;
    const refresh = () => {
      void reload(selectedRef.current).catch((err) =>
        setError(errorMessage(err)),
      );
    };
    const tick = () => {
      if (todayISO() !== todayRef.current) refresh();
    };
    const id = window.setInterval(tick, 30_000);
    // Coming back to the window picks up edits made in other apps or by sync.
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [library, reload]);

  useEffect(() => {
    const listeners = [
      listen("open-settings", () => setSettingsTab("general")),
      listen("open-shortcuts", () => setSettingsTab("shortcuts")),
    ];
    return () => {
      for (const listener of listeners) void listener.then((stop) => stop());
    };
  }, []);

  // Shortcuts that work anywhere outside a text field. Row-level keys live in TodoItem, which
  // marks the events it handles, so they never reach here twice.
  const onGlobalKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onGlobalKey.current = (event) => {
    if (!library || event.defaultPrevented || isTyping(event.target)) return;
    if (document.querySelector("dialog[open], .menu, .project-editor")) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.altKey) return;
    if (event.metaKey) {
      if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        startNewTodo();
      }
      return;
    }
    if (key === "?") {
      event.preventDefault();
      setSettingsTab("shortcuts");
      return;
    }
    if (key === "arrowleft" || key === "arrowright") {
      event.preventDefault();
      const step = event.shiftKey ? 7 : 1;
      void selectDay(
        addDays(selectedRef.current, key === "arrowleft" ? -step : step),
      );
      return;
    }
    if (event.shiftKey) return;
    if (key === "n") {
      event.preventDefault();
      startNewTodo();
    } else if (key === "t") {
      event.preventDefault();
      void selectDay(todayRef.current);
    } else if (key === "arrowdown" && focusFirstTodo()) {
      event.preventDefault();
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onGlobalKey.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  /** Focuses the add field, jumping to today first when the selected day is in the past. */
  function startNewTodo() {
    if (selectedRef.current < todayRef.current) {
      void selectDay(todayRef.current);
    }
    setFocusAddRequest((count) => count + 1);
  }

  async function selectDay(iso: string) {
    const token = ++request.current;
    setSelected(iso);
    selectedRef.current = iso;
    setCursor((current) => {
      const next = cursorFromISO(iso);
      return current.year === next.year && current.month === next.month
        ? current
        : next;
    });
    setError(null);
    try {
      const items = await loadDay(iso);
      if (request.current !== token) return;
      setTodos(items.todos);
      setNote(items.note);
      reportProblems(items.problems);
    } catch (err) {
      if (request.current === token) setError(errorMessage(err));
    }
  }

  /** Asks for a folder and switches to it. Throws if the switch fails; does nothing if cancelled. */
  async function pickLibrary() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Choose where to keep your todos",
      canCreateDirectories: true,
      defaultPath: library ? await dirname(library) : undefined,
    });
    if (picked == null) return;
    const path = await setLibrary(picked);
    setLibraryPath(path);
    setError(null);
    shownProblems.current = "";
    const preparedDay = await reload(todayISO());
    setSelected(preparedDay);
    selectedRef.current = preparedDay;
    setCursor(cursorFromISO(preparedDay));
    const items = await loadDay(preparedDay);
    setTodos(items.todos);
    setNote(items.note);
  }

  async function chooseFolder() {
    setError(null);
    try {
      await pickLibrary();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function create(title: string) {
    const day = selectedRef.current;
    try {
      await createTodo(day, title);
      await reload(day);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  async function update(id: string, patch: TodoPatch) {
    const day = selectedRef.current;
    try {
      await updateTodo(day, id, patch);
      await reload(day);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  async function updateNote(next: string) {
    const day = selectedRef.current;
    try {
      await saveNote(day, next);
      await reload(day);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  async function remove(id: string) {
    const day = selectedRef.current;
    try {
      await deleteTodo(day, id);
      await reload(day);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  async function move(id: string, toDate: string) {
    const day = selectedRef.current;
    try {
      await moveTodo(id, day, toDate);
      await reload(day);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  if (booting) {
    return (
      <div className="frame">
        <TitleBar />
        <main className="setup">
          <p className="kicker">Loading…</p>
        </main>
      </div>
    );
  }

  if (!library) {
    return (
      <div className="frame">
        <TitleBar />
        <SetupScreen
          error={error}
          onChoose={() => void chooseFolder()}
        />
        {settingsTab ? (
          <SettingsDialog
            initialTab={settingsTab}
            library={library ?? null}
            onChangeFolder={pickLibrary}
            onClose={() => setSettingsTab(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="frame">
      <TitleBar />
      <main className="app">
        <TodoPane
          selected={selected}
          today={today}
          todos={todos}
          note={note}
          recentProjects={projects}
          error={error}
          onDismissError={() => setError(null)}
          carried={carried}
          onDismissCarried={() => setCarried(0)}
          onShowToday={() => void selectDay(today)}
          onCreate={create}
          onUpdate={update}
          onMove={move}
          onDelete={remove}
          onSaveNote={updateNote}
          focusAddRequest={focusAddRequest}
        />
        <DaySidebar
          selected={selected}
          today={today}
          cursor={cursor}
          days={days}
          onShiftDay={(delta) => void selectDay(addDays(selected, delta))}
          onShiftMonth={(delta) =>
            setCursor((current) =>
              addMonths(current.year, current.month, delta),
            )
          }
          onSelect={(iso) => void selectDay(iso)}
        />
      </main>
      {settingsTab ? (
        <SettingsDialog
          initialTab={settingsTab}
          library={library ?? null}
          onChangeFolder={pickLibrary}
          onClose={() => setSettingsTab(null)}
        />
      ) : null}
    </div>
  );
}

export default App;
