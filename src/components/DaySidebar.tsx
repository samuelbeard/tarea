import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  formatLong,
  formatMonth,
  formatWeekday,
  monthGrid,
  weekdayLabels,
  type MonthCursor,
} from "../dates";

type DaySidebarProps = {
  selected: string;
  today: string;
  cursor: MonthCursor;
  days: string[];
  onShiftDay: (delta: number) => void;
  onShiftMonth: (delta: number) => void;
  onSelect: (iso: string) => void;
};

export function DaySidebar({
  selected,
  today,
  cursor,
  days,
  onShiftDay,
  onShiftMonth,
  onSelect,
}: DaySidebarProps) {
  const marked = useMemo(() => new Set(days), [days]);
  const cells = monthGrid(cursor.year, cursor.month);
  const labels = weekdayLabels();
  const weeks = Array.from({ length: cells.length / 7 }, (_, row) =>
    cells.slice(row * 7, row * 7 + 7),
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const focusDay = useRef<string | null>(null);
  const shown = new Set(cells.map((cell) => cell.iso));
  // One Tab stop for the whole month: the selected day, else today, else the 1st.
  const tabStop = shown.has(selected)
    ? selected
    : shown.has(today)
      ? today
      : cells.find((cell) => cell.inMonth)?.iso;

  // Arrow keys select a new day; once it renders, focus follows it.
  useEffect(() => {
    const iso = focusDay.current;
    if (!iso) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(
      `[data-iso="${iso}"]`,
    );
    if (!cell) return;
    focusDay.current = null;
    cell.focus();
  });

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const from = (event.target as HTMLElement).dataset.iso;
    if (!from || event.metaKey || event.ctrlKey || event.altKey) return;
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = addDays(from, event.shiftKey ? step * 7 : step);
    focusDay.current = next;
    onSelect(next);
  }

  return (
    <aside
      className="sidebar"
      aria-label="Calendar"
    >
      <div className="day-nav">
        <button
          type="button"
          className="nav-button"
          aria-label="Previous day"
          onClick={() => onShiftDay(-1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <p className="day-nav-label">{formatWeekday(selected)}</p>
        <button
          type="button"
          className="nav-button"
          aria-label="Next day"
          onClick={() => onShiftDay(1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>

      <hr className="sidebar-rule" />

      <div className="month-block">
        <div className="month-nav">
          <button
            type="button"
            className="nav-button"
            aria-label="Previous month"
            onClick={() => onShiftMonth(-1)}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <p
            className="month-label"
            aria-live="polite"
          >
            {formatMonth(cursor.year, cursor.month)}
          </p>
          <button
            type="button"
            className="nav-button"
            aria-label="Next month"
            onClick={() => onShiftMonth(1)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
        <div
          ref={gridRef}
          className="calendar"
          role="grid"
          aria-label={formatMonth(cursor.year, cursor.month)}
          onKeyDown={onGridKeyDown}
        >
          <div
            className="calendar-row"
            role="row"
          >
            {labels.map((label) => (
              <span
                key={label}
                className="weekday"
                role="columnheader"
                aria-label={label}
                title={label}
              >
                <span aria-hidden="true">{label.slice(0, 1)}</span>
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div
              key={week[0].iso}
              className="calendar-row"
              role="row"
            >
              {week.map((cell) => {
                const hasTodos = marked.has(cell.iso);
                const className = [
                  "day-cell",
                  cell.inMonth ? "" : "is-outside",
                  cell.iso === selected ? "is-selected" : "",
                  cell.iso === today ? "is-today" : "",
                  hasTodos ? "has-todos" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <span
                    key={cell.iso}
                    role="gridcell"
                    aria-selected={cell.iso === selected}
                  >
                    <button
                      type="button"
                      className={className}
                      data-iso={cell.iso}
                      tabIndex={cell.iso === tabStop ? 0 : -1}
                      aria-label={
                        hasTodos
                          ? `${formatLong(cell.iso)}, has todos`
                          : formatLong(cell.iso)
                      }
                      aria-current={cell.iso === today ? "date" : undefined}
                      onClick={() => onSelect(cell.iso)}
                    >
                      {Number(cell.iso.slice(-2))}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
