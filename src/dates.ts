export type MonthCursor = {
  year: number;
  month: number;
};

export type CalendarCell = {
  iso: string;
  inMonth: boolean;
};

export function formatISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayISO(now = new Date()): string {
  return formatISO(now);
}

export function parseISO(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function addDays(iso: string, days: number): string {
  const date = parseISO(iso);
  date.setDate(date.getDate() + days);
  return formatISO(date);
}

export function addMonths(
  year: number,
  month: number,
  delta: number,
): MonthCursor {
  const date = new Date(year, month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function cursorFromISO(iso: string): MonthCursor {
  const [year, month] = iso.split("-").map(Number);
  return { year, month };
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = parseISO(fromISO);
  const to = parseISO(toISO);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function formatRelative(iso: string, today: string): string {
  const days = daysBetween(today, iso);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (days === 0) return "Today";

  const target = parseISO(iso);
  const base = parseISO(today);
  const yearDelta = target.getFullYear() - base.getFullYear();
  if (
    yearDelta !== 0 &&
    target.getMonth() === base.getMonth() &&
    target.getDate() === base.getDate()
  ) {
    return rtf.format(yearDelta, "year");
  }

  const monthDelta = yearDelta * 12 + (target.getMonth() - base.getMonth());
  if (monthDelta !== 0 && target.getDate() === base.getDate()) {
    return rtf.format(monthDelta, "month");
  }

  if (days % 7 === 0 && Math.abs(days / 7) < 12) {
    return rtf.format(days / 7, "week");
  }

  return rtf.format(days, "day");
}

export function formatLong(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShort(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatWeekday(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatMonth(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function weekdayLabels(): string[] {
  return WEEKDAYS;
}

export function monthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - lead);
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    cells.push({
      iso: formatISO(date),
      inMonth: date.getMonth() === month - 1,
    });
  }
  return cells;
}
