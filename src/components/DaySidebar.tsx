import { useMemo } from "react";
import {
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

  return (
    <aside className="sidebar">
      <div className="day-nav">
        <button
          type="button"
          className="nav-button"
          aria-label="Previous day"
          onClick={() => onShiftDay(-1)}
        >
          ‹
        </button>
        <p className="day-nav-label">{formatWeekday(selected)}</p>
        <button
          type="button"
          className="nav-button"
          aria-label="Next day"
          onClick={() => onShiftDay(1)}
        >
          ›
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
            ‹
          </button>
          <p className="month-label">
            {formatMonth(cursor.year, cursor.month)}
          </p>
          <button
            type="button"
            className="nav-button"
            aria-label="Next month"
            onClick={() => onShiftMonth(1)}
          >
            ›
          </button>
        </div>
        <div
          className="calendar"
          role="grid"
          aria-label={formatMonth(cursor.year, cursor.month)}
        >
          {labels.map((label) => (
            <span
              key={label}
              className="weekday"
              title={label}
            >
              {label.slice(0, 1)}
            </span>
          ))}
          {cells.map((cell) => {
            const className = [
              "day-cell",
              cell.inMonth ? "" : "is-outside",
              cell.iso === selected ? "is-selected" : "",
              cell.iso === today ? "is-today" : "",
              marked.has(cell.iso) ? "has-todos" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={cell.iso}
                type="button"
                className={className}
                aria-label={formatLong(cell.iso)}
                aria-pressed={cell.iso === selected}
                aria-current={cell.iso === today ? "date" : undefined}
                onClick={() => onSelect(cell.iso)}
              >
                {Number(cell.iso.slice(-2))}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
