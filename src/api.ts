import { invoke } from "@tauri-apps/api/core";
import type { DayTodos, PrepareToday, Todo, TodoPatch } from "./types";

export function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Something went wrong.";
}

export function getLibrary(): Promise<string | null> {
  return invoke("get_library");
}

export function setLibrary(parentPath: string): Promise<string> {
  return invoke("set_library", { parentPath });
}

export function prepareToday(): Promise<PrepareToday> {
  return invoke("prepare_today");
}

export function listDays(): Promise<string[]> {
  return invoke("list_days");
}

export function loadDay(date: string): Promise<DayTodos> {
  return invoke("load_day", { date });
}

export function createTodo(
  date: string,
  title: string,
  project?: string,
): Promise<Todo> {
  const name = project?.trim();
  return invoke("create_todo", { date, title, project: name ? name : null });
}

export function recentProjects(): Promise<string[]> {
  return invoke("recent_projects");
}

export function updateTodo(date: string, id: string, patch: TodoPatch): Promise<Todo> {
  return invoke("update_todo", { date, id, ...patch });
}

export function saveNote(date: string, note: string): Promise<string> {
  return invoke("save_note", { date, note });
}

export function deleteTodo(date: string, id: string): Promise<void> {
  return invoke("delete_todo", { date, id });
}

export function moveTodo(id: string, fromDate: string, toDate: string): Promise<Todo> {
  return invoke("move_todo", { id, fromDate, toDate });
}
