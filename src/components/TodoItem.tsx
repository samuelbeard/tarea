import { ChevronRight, Folder, GripVertical } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { addDays } from "../dates";
import { todoElements } from "../shortcuts";
import { STATUS_ORDER, STATUSES } from "../status";
import type { Priority, Status, Todo, TodoPatch } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Markdown } from "./Markdown";
import { normalizeProject, ProjectSuggestions } from "./ProjectSuggestions";

/** "status" is the status-only menu opened from the status box. */
const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

type MenuPoint = { x: number; y: number; kind: "actions" | "status" };

type TodoItemProps = {
  todo: Todo;
  today: string;
  recentProjects: string[];
  /** False when the todo is alone in its project, so there is nowhere to move it. */
  canReorder: boolean;
  dragging: boolean;
  onDragStart: (id: string, event: ReactPointerEvent<HTMLElement>) => void;
  /** Moves the todo up (-1) or down (1) within its project. */
  onShift: (id: string, delta: number) => void;
  onUpdate: (id: string, patch: TodoPatch) => Promise<void>;
  onMove: (id: string, toDate: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function TodoItem({
  todo,
  today,
  recentProjects,
  canReorder,
  dragging,
  onDragStart,
  onShift,
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
  /** Where focus goes back to when the menu closes from the keyboard. */
  const menuOpener = useRef<HTMLElement | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const projectButtonRef = useRef<HTMLButtonElement>(null);
  const projectEditorRef = useRef<HTMLDivElement>(null);
  const tomorrow = addDays(today, 1);
  const status = STATUSES[todo.status];
  const StatusIcon = status.icon;
  const canMove = moveDate > today && moveDate !== todo.day;
  const hasNotes = todo.notes.trim().length > 0;

  useEffect(() => {
    setDraftTitle(todo.title);
    setDraftProject(todo.project ?? "");
  }, [todo.title, todo.project]);

  // An autosave reloads the todo, which mustn't overwrite what is still being typed.
  useEffect(() => {
    if (!editingNotes) setDraftNotes(todo.notes);
  }, [todo.notes, editingNotes]);

  /** The notes as they were when editing began, so Escape can undo autosaves too. */
  const notesAtEdit = useRef(todo.notes);
  useEffect(() => {
    if (editingNotes) notesAtEdit.current = todo.notes;
  }, [editingNotes]);

  // Saves notes when typing pauses, so quitting mid-edit loses at most a moment of typing.
  useEffect(() => {
    if (!editingNotes || draftNotes.trim() === todo.notes) return;
    const timer = window.setTimeout(() => {
      void onUpdate(todo.id, { notes: draftNotes }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [editingNotes, draftNotes, todo.notes, todo.id]);

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
    el?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
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

  function openMenu(
    x: number,
    y: number,
    opener: HTMLElement | null,
    kind: MenuPoint["kind"] = "actions",
  ) {
    menuOpener.current = opener;
    setMoveDate("");
    setMenu({ x, y, kind });
  }

  function closeMenu(refocus: boolean) {
    setMenu(null);
    if (refocus) menuOpener.current?.focus();
  }

  /** Up and down arrows step through the menu's buttons. */
  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if ((event.target as HTMLElement).matches("input")) return;
    event.preventDefault();
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "button:not(:disabled)",
      ),
    );
    const index = buttons.indexOf(event.target as HTMLElement);
    const step = event.key === "ArrowUp" ? -1 : 1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
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
      const original = notesAtEdit.current;
      setDraftNotes(original);
      setEditingNotes(false);
      if (original !== todo.notes) {
        void onUpdate(todo.id, { notes: original }).catch(() => undefined);
      }
      return;
    }
    setEditingNotes(false);
    if (draftNotes.trim() === todo.notes) return;
    void onUpdate(todo.id, { notes: draftNotes }).catch(() =>
      setDraftNotes(todo.notes),
    );
  }

  /** Saves the project. `refocus` returns focus to the project button, for keyboard closes. */
  function commitProject(nextValue: string, refocus = false) {
    if (projectBusy.current) return;
    projectBusy.current = true;
    window.setTimeout(() => {
      projectBusy.current = false;
    }, 0);
    // After the busy flag, so the editor's blur from this doesn't commit a second time.
    if (refocus) projectButtonRef.current?.focus();
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

  /** The left-click action: each status either completes or reopens the todo. */
  function advanceStatus() {
    void onUpdate(todo.id, {
      status: STATUSES[todo.status].next,
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
      } else if (key === "ArrowUp" || key === "ArrowDown") {
        event.preventDefault();
        onShift(todo.id, key === "ArrowUp" ? -1 : 1);
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
      advanceStatus();
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
    closeMenu(true);
    try {
      await onUpdate(todo.id, { status });
    } catch {
      // The pane shows the error.
    }
  }

  async function choosePriority(priority: Priority) {
    closeMenu(true);
    try {
      await onUpdate(todo.id, { priority });
    } catch {
      // The pane shows the error.
    }
  }

  async function submitMove() {
    if (!canMove) return;
    try {
      await onMove(todo.id, moveDate);
      closeMenu(false);
    } catch {
      // The pane shows the error.
    }
  }

  const className = [
    "todo",
    todo.status === "complete" ? "is-complete" : "",
    todo.status === "cancelled" ? "is-cancelled" : "",
    todo.status === "in_progress" ? "is-in-progress" : "",
    todo.status === "blocked" ? "is-blocked" : "",
    todo.priority === "normal" ? "" : `is-priority-${todo.priority}`,
    editingProject ? "is-editing-project" : "",
    dragging ? "is-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      ref={articleRef}
      className={className}
      data-todo-id={todo.id}
      tabIndex={0}
      aria-label={[
        todo.title,
        todo.status === "incomplete" ? "" : status.label.toLowerCase(),
        todo.priority === "normal" ? "" : `${todo.priority} priority`,
      ]
        .filter(Boolean)
        .join(", ")}
      onKeyDown={onRowKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.clientX, event.clientY, articleRef.current);
      }}
    >
      {canReorder ? (
        <button
          type="button"
          className="drag-handle"
          tabIndex={-1}
          aria-hidden="true"
          title="Drag to reorder"
          onPointerDown={(event) => onDragStart(todo.id, event)}
        >
          <GripVertical
            size={14}
            aria-hidden="true"
          />
        </button>
      ) : null}
      <button
        type="button"
        className="status-box"
        data-status={todo.status}
        role="checkbox"
        aria-checked={
          todo.status === "complete"
            ? true
            : todo.status === "incomplete"
              ? false
              : "mixed"
        }
        aria-label={`${todo.title}: ${status.label}. Click to mark ${STATUSES[status.next].label.toLowerCase()}`}
        title={status.label}
        onClick={advanceStatus}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu(event.clientX, event.clientY, event.currentTarget, "status");
        }}
      >
        {StatusIcon ? (
          <StatusIcon
            size={12}
            strokeWidth={3}
            aria-hidden="true"
          />
        ) : null}
      </button>
      <div className="todo-body">
        <div className="todo-title-row">
          <button
            type="button"
            className={notesOpen ? "notes-toggle is-open" : "notes-toggle"}
            aria-expanded={notesOpen}
            aria-label={
              notesOpen
                ? `Hide notes for ${todo.title}`
                : `Show notes for ${todo.title}${hasNotes ? "" : " (none yet)"}`
            }
            onClick={toggleNotes}
          >
            <ChevronRight
              size={14}
              strokeWidth={2}
              // Filled when there are notes; the open path closes into a triangle.
              fill={hasNotes ? "currentColor" : "none"}
              aria-hidden="true"
            />
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
                aria-label={`Rename ${todo.title}`}
                onClick={() => setEditing(true)}
              >
                {todo.title}
              </button>
            )}

            {editingProject
              ? createPortal(
                  <div
                    ref={projectEditorRef}
                    className="project-editor"
                    role="dialog"
                    aria-label={`Project for ${todo.title}`}
                    onBlur={(event) => {
                      // Tabbing between the field and the suggestions keeps it open.
                      if (
                        event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      ) {
                        return;
                      }
                      commitProject(draftProject);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        skipProject.current = true;
                        setDraftProject(todo.project ?? "");
                        commitProject(todo.project ?? "", true);
                      }
                    }}
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
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitProject(event.currentTarget.value, true);
                        }
                      }}
                    />
                    <ProjectSuggestions
                      projects={recentProjects}
                      selected={draftProject}
                      onPick={(name) => {
                        setDraftProject(name);
                        commitProject(name, true);
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
                    articleRef.current?.focus();
                  }
                }}
              />
            ) : null}
            {notesOpen && !editingNotes && todo.notes.trim() ? (
              <>
                <div
                  className="notes-view"
                  onMouseDown={(event) => {
                    if ((event.target as HTMLElement).closest("a")) return;
                    event.preventDefault();
                    setEditingNotes(true);
                  }}
                >
                  <Markdown>{todo.notes}</Markdown>
                </div>
                {/* Clicking the notes edits them; this is the keyboard way in. */}
                <button
                  type="button"
                  className="text-button reveal-on-focus"
                  onClick={() => setEditingNotes(true)}
                >
                  Edit notes
                </button>
              </>
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
          ref={projectButtonRef}
          type="button"
          className={
            todo.project ? "project-button has-project" : "project-button"
          }
          aria-haspopup="dialog"
          aria-expanded={editingProject}
          aria-label={
            todo.project
              ? `Change project for ${todo.title}, currently ${todo.project}`
              : `Add project for ${todo.title}`
          }
          onClick={openProjectEditor}
        >
          <Folder
            size={16}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="more"
          aria-label={`Actions for ${todo.title}`}
          aria-haspopup="dialog"
          aria-expanded={menu !== null}
          onClick={(event) => {
            if (menu) {
              closeMenu(false);
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.left, rect.bottom + 6, event.currentTarget);
          }}
        >
          ···
        </button>
      </div>
      {menu ? (
        <div
          ref={menuRef}
          className="menu"
          style={{ left: menu.x, top: menu.y }}
          role="dialog"
          aria-label={
            menu.kind === "status"
              ? `Status for ${todo.title}`
              : `Actions for ${todo.title}`
          }
          onKeyDown={onMenuKeyDown}
          onMouseDown={(event) => {
            // WebKit doesn't focus a clicked button; it focuses the row instead, which
            // blurs the menu and closes it before the click lands.
            if ((event.target as HTMLElement).closest("button")) {
              event.preventDefault();
            }
          }}
          onBlur={(event) => {
            // Close when focus moves elsewhere in the app, but not for the date picker.
            const next = event.relatedTarget as Node | null;
            if (next && !event.currentTarget.contains(next)) setMenu(null);
          }}
        >
          {STATUS_ORDER.filter(
            (option) => menu.kind === "status" || option !== todo.status,
          ).map((option) => {
            const Icon = STATUSES[option].icon;
            return (
              <button
                key={option}
                type="button"
                className="menu-item status-item"
                aria-pressed={
                  menu.kind === "status" ? option === todo.status : undefined
                }
                onClick={() => void chooseStatus(option)}
              >
                <span
                  className="status-box"
                  data-status={option}
                >
                  {Icon ? (
                    <Icon
                      size={12}
                      strokeWidth={3}
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                {STATUSES[option].label}
              </button>
            );
          })}
          {menu.kind === "status" ? null : (
            <>
              <div
                className="menu-section"
                role="group"
                aria-labelledby={`priority-${todo.id}`}
              >
                <p
                  className="menu-label"
                  id={`priority-${todo.id}`}
                >
                  Priority
                </p>
                {PRIORITIES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className="menu-item priority-item"
                    data-priority={value}
                    aria-pressed={todo.priority === value}
                    onClick={() => void choosePriority(value)}
                  >
                    <span
                      className="priority-dot"
                      aria-hidden="true"
                    />
                    {label}
                  </button>
                ))}
              </div>
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
                  className="menu-item menu-danger"
                  onClick={() => {
                    closeMenu(true);
                    setConfirmingDelete(true);
                  }}
                >
                  Move to Trash…
                </button>
              </div>
            </>
          )}
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
