export type Status =
  | "incomplete"
  | "in_progress"
  | "blocked"
  | "complete"
  | "cancelled";

export type Priority = "high" | "normal" | "low";

export type Todo = {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  created: string;
  project: string | null;
  notes: string;
  filename: string;
  day: string;
};

export type TodoPatch = {
  title?: string;
  notes?: string;
  status?: Status;
  priority?: Priority;
  project?: string;
};

export type PrepareToday = {
  today: string;
  moved: number;
  problems: string[];
};

export type DayTodos = {
  todos: Todo[];
  problems: string[];
  /** The day's own markdown note, empty when it has none. */
  note: string;
};
