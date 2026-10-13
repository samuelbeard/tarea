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
  const editButtonRef = useRef<HTMLButtonElement>(null);
  /** Set when the editor is closed from the keyboard, so focus lands on the edit button. */
  const refocus = useRef(false);

  useEffect(() => {
    setEditing(false);
    refocus.current = false;
  }, [day]);

  useEffect(() => {
    if (editRequest === handledEditRequest.current) return;
    handledEditRequest.current = editRequest;
    startEditing();
  }, [editRequest]);

  // The button can appear only once the save lands, so this checks after every render.
  useEffect(() => {
    if (editing || !refocus.current || !editButtonRef.current) return;
    refocus.current = false;
    editButtonRef.current.focus();
  });

  function startEditing() {
    refocus.current = false;
    setEditing(true);
  }

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
            refocus.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  if (!note.trim()) return null;

  return (
    <>
      <div
        className="notes-view day-note"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest("a")) return;
          event.preventDefault();
          startEditing();
        }}
      >
        <Markdown>{note}</Markdown>
      </div>
      {/* Clicking the note edits it; this is the keyboard way in. */}
      <button
        ref={editButtonRef}
        type="button"
        className="text-button reveal-on-focus"
        onClick={startEditing}
      >
        Edit notes for the day
      </button>
    </>
  );
}
