import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatLong, formatRelative } from "../dates";
import { focusFirstTodo, todoElements } from "../shortcuts";
import type { Todo, TodoPatch } from "../types";
import { DayNote } from "./DayNote";
import { TodoItem } from "./TodoItem";

type TodoPaneProps = {
  selected: string;
  today: string;
  todos: Todo[];
  note: string;
  recentProjects: string[];
  error: string | null;
  onDismissError: () => void;
  /** How many unfinished todos were last carried forward to today; 0 hides the notice. */
  carried: number;
  onDismissCarried: () => void;
  onShowToday: () => void;
  onCreate: (title: string) => Promise<void>;
  onUpdate: (id: string, patch: TodoPatch) => Promise<void>;
  onMove: (id: string, toDate: string) => Promise<void>;
  /** Saves the day's order; `ids` lists every todo top to bottom. */
  onReorder: (ids: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSaveNote: (note: string) => Promise<void>;
  /** Bumped to ask for the add field to be focused once it can be. */
  focusAddRequest: number;
};

type Group = { project: string | null; todos: Todo[] };

/** A drag in progress: the todo being dragged and its group's order as previewed. */
type Drag = { id: string; ids: string[] };

function groupByProject(todos: Todo[]): Group[] {
  const untagged: Todo[] = [];
  const order: string[] = [];
  const grouped = new Map<string, Todo[]>();
  for (const todo of todos) {
    const project = todo.project?.trim() ? todo.project : null;
    if (!project) {
      untagged.push(todo);
      continue;
    }
    const bucket = grouped.get(project);
    if (bucket) {
      bucket.push(todo);
    } else {
      order.push(project);
      grouped.set(project, [todo]);
    }
  }
  const groups: Group[] = [];
  if (untagged.length > 0) groups.push({ project: null, todos: untagged });
  for (const project of order) {
    const items = grouped.get(project);
    if (items) groups.push({ project, todos: items });
  }
  return groups;
}

function headingId(project: string) {
  return `project-${encodeURIComponent(project)}`;
}

function NoteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TodoPane({
  selected,
  today,
  todos,
  note,
  recentProjects,
  error,
  onDismissError,
  carried,
  onDismissCarried,
  onShowToday,
  onCreate,
  onUpdate,
  onMove,
  onReorder,
  onDelete,
  onSaveNote,
  focusAddRequest,
}: TodoPaneProps) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteRequest, setNoteRequest] = useState(0);
  const addInputRef = useRef<HTMLInputElement>(null);
  const handledFocusRequest = useRef(focusAddRequest);
  const canAdd = selected >= today;

  useEffect(() => {
    if (!canAdd || focusAddRequest === handledFocusRequest.current) return;
    handledFocusRequest.current = focusAddRequest;
    addInputRef.current?.focus();
  }, [canAdd, focusAddRequest]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const refocusId = useRef<string | null>(null);
  const groups = groupByProject(todos);

  // Moving a row can drop its focus, so a keyboard move puts it back.
  useLayoutEffect(() => {
    const id = refocusId.current;
    if (!id) return;
    refocusId.current = null;
    document
      .querySelector<HTMLElement>(`.todo[data-todo-id="${CSS.escape(id)}"]`)
      ?.focus();
  }, [todos]);

  function groupOf(id: string) {
    return groups.find((group) => group.todos.some((todo) => todo.id === id));
  }

  /** The whole day's order with one group's todos replaced by `ids`. Groups keep their places. */
  function dayOrder(target: Group, ids: string[]) {
    return groups.flatMap((group) =>
      group === target ? ids : group.todos.map((todo) => todo.id),
    );
  }

  /** Moves a todo up or down within its project. */
  function shift(id: string, delta: number) {
    const group = groupOf(id);
    if (!group) return;
    const ids = group.todos.map((todo) => todo.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    refocusId.current = id;
    void onReorder(dayOrder(group, ids));
  }

  /** Runs `leave` for a todo that is about to leave the list, then focuses its neighbour. */
  async function leaving(id: string, leave: () => Promise<void>) {
    const items = todoElements();
    const index = items.findIndex((item) => item.dataset.todoId === id);
    const neighbour = items[index + 1] ?? items[index - 1];
    refocusId.current = index >= 0 ? (neighbour?.dataset.todoId ?? null) : null;
    try {
      await leave();
    } catch (err) {
      refocusId.current = null;
      throw err;
    }
  }

  /** Saves a change. A new project moves the row to another group, remounting it, so focus follows. */
  async function update(id: string, patch: TodoPatch) {
    const focused = document.activeElement?.closest<HTMLElement>(".todo");
    if (patch.project !== undefined && focused?.dataset.todoId === id) {
      refocusId.current = id;
    }
    try {
      await onUpdate(id, patch);
    } catch (err) {
      refocusId.current = null;
      throw err;
    }
  }

  /** Drags a todo by its handle. It can only land among the todos of its own project. */
  function startDrag(id: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const group = groupOf(id);
    const section = event.currentTarget.closest<HTMLElement>(".project-group");
    if (!group || !section || group.todos.length < 2) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const original = group.todos.map((todo) => todo.id);
    const others = original.filter((other) => other !== id);
    let current = original;
    setDrag({ id, ids: original });

    const onPointerMove = (move: PointerEvent) => {
      const rows = Array.from(
        section.querySelectorAll<HTMLElement>(":scope > .todo"),
      ).filter((row) => row.dataset.todoId !== id);
      const index = rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top + rect.height / 2 < move.clientY;
      }).length;
      const next = [...others.slice(0, index), id, ...others.slice(index)];
      if (next.join() === current.join()) return;
      current = next;
      setDrag({ id, ids: next });
    };
    const finish = (commit: boolean) => {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      setDrag(null);
      if (commit && current.join() !== original.join()) {
        void onReorder(dayOrder(group, current));
      }
    };
    const onPointerUp = () => finish(true);
    const onPointerCancel = () => finish(false);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
  }

  /** A group's todos, in the previewed order while one of them is being dragged. */
  function shownTodos(group: Group) {
    if (!drag || !group.todos.some((todo) => todo.id === drag.id)) {
      return group.todos;
    }
    return drag.ids.flatMap((id) => {
      const todo = group.todos.find((item) => item.id === id);
      return todo ? [todo] : [];
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next || saving) return;
    setSaving(true);
    try {
      await onCreate(next);
      setTitle("");
    } catch {
      // The pane shows the error from the parent.
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="todo-pane">
      <header className="todo-header">
        <p className="kicker">{formatRelative(selected, today)}</p>
        <h1>{formatLong(selected)}</h1>
        {note.trim() ? null : (
          <button
            type="button"
            className="note-button"
            aria-label="Add a note for the day"
            title="Add a note for the day"
            onClick={() => setNoteRequest((count) => count + 1)}
          >
            <NoteIcon />
          </button>
        )}
      </header>
      {error ? (
        <p
          className="error"
          role="alert"
        >
          <span>{error}</span>
          <button
            type="button"
            className="text-button"
            onClick={onDismissError}
          >
            Dismiss
          </button>
        </p>
      ) : null}
      {carried > 0 ? (
        <p
          className="notice"
          role="status"
        >
          <span>
            Moved {carried} unfinished {carried === 1 ? "todo" : "todos"} to
            today.
          </span>
          <span className="notice-actions">
            {selected !== today ? (
              <button
                type="button"
                className="text-button"
                onClick={onShowToday}
              >
                Show
              </button>
            ) : null}
            <button
              type="button"
              className="text-button"
              onClick={onDismissCarried}
            >
              Dismiss
            </button>
          </span>
        </p>
      ) : null}
      {canAdd ? (
        <form
          className="add-form"
          onSubmit={(event) => void submit(event)}
        >
          <input
            ref={addInputRef}
            value={title}
            placeholder="Add a todo"
            aria-label="Add a todo"
            onChange={(event) => setTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && focusFirstTodo()) {
                event.preventDefault();
              }
              if (event.key === "Escape") event.currentTarget.blur();
            }}
          />
          <button
            type="submit"
            disabled={!title.trim() || saving}
          >
            Add
          </button>
        </form>
      ) : null}
      <div className="todo-scroll">
        <DayNote
          day={selected}
          note={note}
          onSave={onSaveNote}
          editRequest={noteRequest}
        />
        {todos.length === 0 ? (
          <p className="empty">Nothing scheduled.</p>
        ) : null}
        {groups.map((group) => (
          <div
            key={group.project ? `project:${group.project}` : "untagged"}
            className={
              drag && group.todos.some((todo) => todo.id === drag.id)
                ? "project-group is-reordering"
                : "project-group"
            }
            role={group.project ? "group" : undefined}
            aria-labelledby={
              group.project ? headingId(group.project) : undefined
            }
          >
            {group.project ? (
              <h2
                id={headingId(group.project)}
                className="project-heading"
              >
                {group.project}
              </h2>
            ) : null}
            {shownTodos(group).map((todo, index, shown) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                today={today}
                recentProjects={recentProjects}
                canReorder={group.todos.length > 1}
                canShiftUp={index > 0}
                canShiftDown={index < shown.length - 1}
                dragging={drag?.id === todo.id}
                onDragStart={startDrag}
                onShift={shift}
                onUpdate={update}
                onMove={(id, toDate) => leaving(id, () => onMove(id, toDate))}
                onDelete={(id) => leaving(id, () => onDelete(id))}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
