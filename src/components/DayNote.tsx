import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

type DayNoteProps = {
  /** The day the note belongs to; switching days drops any unsaved draft. */
  day: string;
  note: string;
  onSave: (note: string) => Promise<void>;
  /** Bumped to ask for the note to be opened for editing. */
  editRequest: number;
};

/** General notes for the whole day, shown above its todos and saved as the day's note.md. */
export function DayNote({ day, note, onSave, editRequest }: DayNoteProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);

  useEffect(() => {
    if (!editing) setDraft(note);
  }, [note, editing]);

  const handledEditRequest = useRef(editRequest);

  useEffect(() => {
    setEditing(false);
  }, [day]);

  useEffect(() => {
    if (editRequest === handledEditRequest.current) return;
    handledEditRequest.current = editRequest;
    setEditing(true);
  }, [editRequest]);

  function commit() {
    setEditing(false);
    if (draft.trim() === note) return;
    void onSave(draft).catch(() => setDraft(note));
  }

  if (editing) {
    return (
      <textarea
        className="notes day-note-editor"
        value={draft}
        placeholder="Notes for the day"
        aria-label="Notes for the day"
        rows={4}
        autoFocus
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" ||
            (event.key === "Enter" && event.metaKey)
          ) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  if (!note.trim()) return null;

  return (
    <div
      className="notes-view day-note"
      role="button"
      tabIndex={0}
      aria-label="Edit notes for the day"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("a")) return;
        event.preventDefault();
        setEditing(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setEditing(true);
        }
      }}
    >
      <Markdown>{note}</Markdown>
    </div>
  );
}
