import { Check, Pause, Play, X, type LucideIcon } from "lucide-react";
import type { Status } from "./types";

type StatusInfo = {
  label: string;
  /** Drawn inside the status box; incomplete leaves it empty. */
  icon: LucideIcon | null;
  /** What a left click on the box, or Space on the row, changes it to. */
  next: Status;
};

export const STATUSES: Record<Status, StatusInfo> = {
  incomplete: { label: "Incomplete", icon: null, next: "complete" },
  in_progress: { label: "In progress", icon: Play, next: "complete" },
  blocked: { label: "Blocked", icon: Pause, next: "incomplete" },
  complete: { label: "Complete", icon: Check, next: "incomplete" },
  cancelled: { label: "Cancelled", icon: X, next: "incomplete" },
};

/** Menu order. */
export const STATUS_ORDER: Status[] = [
  "incomplete",
  "in_progress",
  "blocked",
  "complete",
  "cancelled",
];
