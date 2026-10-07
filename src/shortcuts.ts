/** Key caps for one way to trigger a shortcut, e.g. ["⌘", "N"]. */
export type KeyCombo = string[];

export type Shortcut = {
  label: string;
  /** Alternative combos that do the same thing. */
  combos: KeyCombo[];
  /** How alternatives read: "or" for synonyms, "/" for a pair like previous / next. */
  joiner?: "or" | "/";
};

export type ShortcutGroup = {
  title: string;
  shortcuts: Shortcut[];
};

/** What the Keyboard Shortcuts tab lists. Keep in step with the handlers in App and TodoItem. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    shortcuts: [
      { label: "New todo", combos: [["N"], ["⌘", "N"]], joiner: "or" },
      { label: "Go to today", combos: [["T"]] },
      { label: "Previous / next day", combos: [["←"], ["→"]], joiner: "/" },
      {
        label: "Previous / next week",
        combos: [
          ["⇧", "←"],
          ["⇧", "→"],
        ],
        joiner: "/",
      },
      { label: "Select the first todo", combos: [["↓"]] },
      { label: "Settings", combos: [["⌘", ","]] },
      { label: "Keyboard shortcuts", combos: [["?"], ["⌘", "/"]], joiner: "or" },
    ],
  },
  {
    title: "Selected todo",
    shortcuts: [
      { label: "Previous / next todo", combos: [["↑"], ["↓"]], joiner: "/" },
      { label: "Complete or reopen", combos: [["Space"]] },
      { label: "Rename", combos: [["Return"]] },
      { label: "Move to Trash…", combos: [["⌘", "⌫"]] },
      { label: "Deselect", combos: [["Esc"]] },
    ],
  },
  {
    title: "Adding a todo",
    shortcuts: [
      { label: "Add", combos: [["Return"]] },
      { label: "Select the first todo", combos: [["↓"]] },
      { label: "Stop typing", combos: [["Esc"]] },
    ],
  },
];

/** True when keys should go to a text field rather than trigger shortcuts. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset"].includes(
      target.type,
    );
  }
  return false;
}

export function todoElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".todo-scroll .todo"),
  );
}

export function focusFirstTodo(): boolean {
  const first = todoElements()[0];
  first?.focus();
  return Boolean(first);
}
