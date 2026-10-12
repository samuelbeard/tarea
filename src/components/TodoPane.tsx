import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatLong, formatRelative } from "../dates";
import { focusFirstTodo } from "../shortcuts";
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
  onDelete: (id: string) => Promise<void>;
  onSaveNote: (note: string) => Promise<void>;
  /** Bumped to ask for the add field to be focused once it can be. */
  focusAddRequest: number;
};

function groupByProject(
  todos: Todo[],
): { project: string | null; todos: Todo[] }[] {
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
  const groups: { project: string | null; todos: Todo[] }[] = [];
  if (untagged.length > 0) groups.push({ project: null, todos: untagged });
  for (const project of order) {
    const items = grouped.get(project);
    if (items) groups.push({ project, todos: items });
  }
  return groups;
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
  const groups = groupByProject(todos);

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
          <section
            key={group.project ? `project:${group.project}` : "untagged"}
            className="project-group"
          >
            {group.project ? (
              <h2 className="project-heading">{group.project}</h2>
            ) : null}
            {group.todos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                today={today}
                recentProjects={recentProjects}
                onUpdate={onUpdate}
                onMove={onMove}
                onDelete={onDelete}
              />
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
