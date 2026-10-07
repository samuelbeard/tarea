import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { addDays, formatShort } from "../dates";
import { todoElements } from "../shortcuts";
import type { Status, Todo, TodoPatch } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { normalizeProject, ProjectSuggestions } from "./ProjectSuggestions";

type MenuPoint = { x: number; y: number };

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProjectIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type TodoItemProps = {
  todo: Todo;
  today: string;
  recentProjects: string[];
  onUpdate: (id: string, patch: TodoPatch) => Promise<void>;
  onMove: (id: string, toDate: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function TodoItem({
  todo,
  today,
  recentProjects,
  onUpdate,
  onMove,
  onDelete,
}: TodoItemProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(todo.title);
  const [notesOpen, setNotesOpen] = useState(todo.notes.length > 0);
  const [editingNotes, setEditingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState(todo.notes);
  const [editingProject, setEditingProject] = useState(false);
  const [draftProject, setDraftProject] = useState(todo.project ?? "");
  const skipNotes = useRef(false);
  const skipProject = useRef(false);
  const projectBusy = useRef(false);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const skipTitle = useRef(false);
  const selectTitleOnEdit = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const projectButtonRef = useRef<HTMLButtonElement>(null);
  const projectEditorRef = useRef<HTMLDivElement>(null);
  const tomorrow = addDays(today, 1);
  const canMove = moveDate > today && moveDate !== todo.day;

  useEffect(() => {
    setDraftTitle(todo.title);
    setDraftNotes(todo.notes);
    setDraftProject(todo.project ?? "");
  }, [todo.title, todo.notes, todo.project]);

  useEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        el.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
      }
      if (rect.bottom > window.innerHeight - 8) {
        el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  useLayoutEffect(() => {
    if (!editingProject) return;
    const place = () => {
      const anchor = projectButtonRef.current;
      const el = projectEditorRef.current;
      if (!anchor || !el) return;
      const anchorRect = anchor.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      let left = anchorRect.left;
      let top = anchorRect.bottom + gap;
      if (left + width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - width - margin);
      }
      if (top + height > window.innerHeight - margin) {
        const above = anchorRect.top - height - gap;
        top =
          above >= margin
            ? above
            : Math.max(margin, window.innerHeight - height - margin);
      }
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [editingProject]);

  function openMenu(x: number, y: number) {
    setMoveDate("");
    setMenu({ x, y });
  }

  function commitTitle(nextValue: string) {
    const next = nextValue.trim();
    setEditing(false);
    if (!next || next === todo.title) {
      setDraftTitle(todo.title);
      return;
    }
    setDraftTitle(next);
    void onUpdate(todo.id, { title: next }).catch(() =>
      setDraftTitle(todo.title),
    );
  }

  function commitNotes() {
    if (skipNotes.current) {
      skipNotes.current = false;
      setDraftNotes(todo.notes);
      setEditingNotes(false);
      return;
    }
    setEditingNotes(false);
    if (draftNotes.trim() === todo.notes) return;
    void onUpdate(todo.id, { notes: draftNotes }).catch(() =>
      setDraftNotes(todo.notes),
    );
  }

  function commitProject(nextValue: string) {
    if (projectBusy.current) return;
    projectBusy.current = true;
    window.setTimeout(() => {
      projectBusy.current = false;
    }, 0);
    if (skipProject.current) {
      skipProject.current = false;
      setDraftProject(todo.project ?? "");
      setEditingProject(false);
      return;
    }
    const next = normalizeProject(nextValue);
    const current = todo.project ?? "";
    setEditingProject(false);
    if (next === current) {
      setDraftProject(current);
      return;
    }
    setDraftProject(next);
    void onUpdate(todo.id, { project: next }).catch(() =>
      setDraftProject(current),
    );
  }

  function openProjectEditor() {
    if (projectBusy.current) return;
    setDraftProject(todo.project ?? "");
    setEditingProject(true);
  }

  function toggleNotes() {
    setNotesOpen((open) => {
      if (open) {
        setEditingNotes(false);
        return false;
      }
      if (!todo.notes.trim()) setEditingNotes(true);
      return true;
    });
  }

  function toggleComplete() {
    void onUpdate(todo.id, {
      status: todo.status === "complete" ? "incomplete" : "complete",
    }).catch(() => undefined);
  }

  /** Keys for the row itself; keys aimed at its buttons and fields are left alone. */
  function onRowKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey) return;
    const { key, metaKey, shiftKey } = event;
    if (metaKey) {
      if (key === "Backspace" || key === "Delete") {
        event.preventDefault();
        setConfirmingDelete(true);
      }
      return;
    }
    if (shiftKey) return;
    if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      const items = todoElements();
      const index = items.indexOf(event.currentTarget);
      const next = items[index + (key === "ArrowUp" ? -1 : 1)];
      if (next) {
        next.focus();
      } else if (key === "ArrowUp") {
        document.querySelector<HTMLInputElement>(".add-form input")?.focus();
      }
    } else if (key === " ") {
      event.preventDefault();
      toggleComplete();
    } else if (key === "Enter") {
      event.preventDefault();
      // Like renaming in Finder: select the title so typing replaces it.
      selectTitleOnEdit.current = true;
      setEditing(true);
    } else if (key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  async function chooseStatus(status: Status) {
    setMenu(null);
    try {
      await onUpdate(todo.id, { status });
    } catch {
      // The pane shows the error.
    }
  }

  async function submitMove() {
    if (!canMove) return;
    try {
      await onMove(todo.id, moveDate);
      setMenu(null);
    } catch {
      // The pane shows the error.
    }
  }

  const className = [
    "todo",
    todo.status === "complete" ? "is-complete" : "",
    todo.status === "cancelled" ? "is-cancelled" : "",
    editingProject ? "is-editing-project" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      ref={articleRef}
      className={className}
      tabIndex={0}
      aria-label={todo.title}
      onKeyDown={onRowKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}
    >
      <input
        type="checkbox"
        checked={todo.status === "complete"}
        aria-label={
          todo.status === "complete"
            ? `Mark ${todo.title} incomplete`
            : `Mark ${todo.title} complete`
        }
        onChange={toggleComplete}
      />
      <div className="todo-body">
        <div className="todo-title-row">
          <button
            type="button"
            className={notesOpen ? "notes-toggle is-open" : "notes-toggle"}
            aria-expanded={notesOpen}
            aria-label={
              notesOpen
                ? `Hide notes for ${todo.title}`
                : `Show notes for ${todo.title}`
            }
            onClick={toggleNotes}
          >
            <ChevronIcon />
          </button>
          <div className="todo-main">
            {editing ? (
              <input
                className="title-input"
                type="text"
                value={draftTitle}
                aria-label="Todo title"
                autoFocus
                onFocus={(event) => {
                  if (!selectTitleOnEdit.current) return;
                  selectTitleOnEdit.current = false;
                  event.currentTarget.select();
                }}
                onChange={(event) => setDraftTitle(event.currentTarget.value)}
                onBlur={(event) => {
                  if (skipTitle.current) {
                    skipTitle.current = false;
                    setEditing(false);
                    return;
                  }
                  commitTitle(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  // Stay on the row after a keyboard rename so arrows keep working.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                    articleRef.current?.focus();
                  }
                  if (event.key === "Escape") {
                    skipTitle.current = true;
                    setDraftTitle(todo.title);
                    event.currentTarget.blur();
                    articleRef.current?.focus();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="title-button"
                onClick={() => setEditing(true)}
              >
                {todo.title}
              </button>
            )}
            {todo.created !== todo.day ? (
              <p className="meta">Created {formatShort(todo.created)}</p>
            ) : null}
            {editingProject
              ? createPortal(
                  <div
                    ref={projectEditorRef}
                    className="project-editor"
                  >
                    <input
                      className="title-input"
                      type="text"
                      value={draftProject}
                      placeholder="Project"
                      aria-label={`Project for ${todo.title}`}
                      autoFocus
                      onChange={(event) =>
                        setDraftProject(event.currentTarget.value)
                      }
                      onBlur={(event) =>
                        commitProject(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          skipProject.current = true;
                          setDraftProject(todo.project ?? "");
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <ProjectSuggestions
                      projects={recentProjects}
                      selected={draftProject}
                      onPick={(name) => {
                        setDraftProject(name);
                        commitProject(name);
                      }}
                    />
                  </div>,
                  document.body,
                )
              : null}
            {notesOpen && editingNotes ? (
              <textarea
                className="notes"
                value={draftNotes}
                placeholder="Notes"
                aria-label={`Notes for ${todo.title}`}
                rows={4}
                autoFocus
                onChange={(event) => setDraftNotes(event.currentTarget.value)}
                onBlur={commitNotes}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    skipNotes.current = true;
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : null}
            {notesOpen && !editingNotes && todo.notes.trim() ? (
              <div
                className="notes-view"
                role="button"
                tabIndex={0}
                aria-label={`Edit notes for ${todo.title}`}
                onMouseDown={(event) => {
                  if ((event.target as HTMLElement).closest("a")) return;
                  event.preventDefault();
                  setEditingNotes(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEditingNotes(true);
                  }
                }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!href) return;
                          void openUrl(href).catch(() => {
                            window.open(href, "_blank", "noopener");
                          });
                        }}
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {todo.notes}
                </ReactMarkdown>
              </div>
            ) : null}
            {notesOpen && !editingNotes && !todo.notes.trim() ? (
              <button
                type="button"
                className="text-button"
                onClick={() => setEditingNotes(true)}
              >
                Write notes
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="todo-actions">
        <button
          type="button"
          className="more"
          aria-label={`Actions for ${todo.title}`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.left, rect.bottom + 6);
          }}
        >
          ···
        </button>
        <button
          ref={projectButtonRef}
          type="button"
          className={
            todo.project ? "project-button has-project" : "project-button"
          }
          aria-expanded={editingProject}
          aria-label={todo.project ? "Change project" : "Add project"}
          onClick={openProjectEditor}
        >
          <ProjectIcon />
        </button>
      </div>
      {menu ? (
        <div
          ref={menuRef}
          className="menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {todo.status !== "complete" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void chooseStatus("complete")}
            >
              Mark complete
            </button>
          ) : null}
          {todo.status !== "incomplete" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void chooseStatus("incomplete")}
            >
              Reopen
            </button>
          ) : null}
          {todo.status !== "cancelled" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void chooseStatus("cancelled")}
            >
              Cancel
            </button>
          ) : null}
          <form
            className="move-row"
            onSubmit={(event) => {
              event.preventDefault();
              void submitMove();
            }}
          >
            <label>
              Move to
              <input
                type="date"
                min={tomorrow}
                value={moveDate}
                onChange={(event) => setMoveDate(event.currentTarget.value)}
              />
            </label>
            <button
              type="submit"
              disabled={!canMove}
            >
              Move
            </button>
          </form>
          <div className="menu-section">
            <button
              type="button"
              role="menuitem"
              className="menu-danger"
              onClick={() => {
                setMenu(null);
                setConfirmingDelete(true);
              }}
            >
              Move to Trash…
            </button>
          </div>
        </div>
      ) : null}
      {confirmingDelete ? (
        <ConfirmDialog
          title="Move this todo to the Trash?"
          confirmLabel="Move to Trash"
          danger
          onConfirm={() => onDelete(todo.id)}
          onClose={() => setConfirmingDelete(false)}
        >
          <p>
            <strong>{todo.title}</strong> and its notes will be moved to the
            Trash. You can restore the file from there.
          </p>
        </ConfirmDialog>
      ) : null}
    </article>
  );
}
