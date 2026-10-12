import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRef, useState, type KeyboardEvent } from "react";
import { errorMessage } from "../api";
import { SHORTCUT_GROUPS, type Shortcut } from "../shortcuts";
import { getTheme, setTheme, THEMES, type Theme } from "../theme";
import { Modal } from "./Modal";

export type SettingsTab = "general" | "shortcuts";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
];

type SettingsDialogProps = {
  initialTab: SettingsTab;
  library: string | null;
  onChangeFolder: () => Promise<void>;
  onClose: () => void;
};

export function SettingsDialog({
  initialTab,
  library,
  onChangeFolder,
  onClose,
}: SettingsDialogProps) {
  const doneRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setThemeState] = useState(getTheme);

  function changeTheme(next: Theme) {
    setThemeState(next);
    setTheme(next);
  }

  async function changeFolder() {
    setBusy(true);
    setError(null);
    try {
      await onChangeFolder();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    if (!library) return;
    setError(null);
    try {
      await revealItemInDir(library);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.id === tab);
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const next = TABS[(index + step + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  }

  return (
    <Modal
      title="Settings"
      className="settings-dialog"
      initialFocus={doneRef}
      locked={busy}
      onClose={onClose}
    >
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`settings-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`settings-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? "is-active" : undefined}
            onClick={() => setTab(item.id)}
            onKeyDown={onTabKeyDown}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id={`settings-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="settings-panel"
      >
        {tab === "general" ? (
          <>
            <section className="settings-section">
              <h3>Todos folder</h3>
              <p className="settings-path">
                {library ? <code>{library}</code> : "No folder chosen yet."}
              </p>
              <p className="settings-help">
                Tarea uses the <code>Tarea</code> folder inside the folder you
                choose, and creates one if it's missing. Todos already saved stay
                where they are.
              </p>
              {error ? (
                <p
                  className="error"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <div className="settings-row">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void changeFolder()}
                >
                  {library ? "Change folder…" : "Choose folder…"}
                </button>
                {library ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void reveal()}
                  >
                    Show in Finder
                  </button>
                ) : null}
              </div>
            </section>
            <section className="settings-section">
              <h3 id="settings-appearance">Appearance</h3>
              <div
                className="segmented"
                role="radiogroup"
                aria-labelledby="settings-appearance"
              >
                {THEMES.map((item) => (
                  <label key={item.id}>
                    <input
                      type="radio"
                      name="theme"
                      value={item.id}
                      checked={theme === item.id}
                      onChange={() => changeTheme(item.id)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </section>
          </>
        ) : (
          SHORTCUT_GROUPS.map((group) => (
            <section
              key={group.title}
              className="settings-section"
            >
              <h3>{group.title}</h3>
              <dl className="shortcut-list">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="shortcut-row"
                  >
                    <dt>{shortcut.label}</dt>
                    <dd>
                      <ShortcutKeys shortcut={shortcut} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))
        )}
      </div>

      <div className="modal-actions">
        <button
          ref={doneRef}
          type="button"
          className="primary"
          disabled={busy}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </Modal>
  );
}

function ShortcutKeys({ shortcut }: { shortcut: Shortcut }) {
  return (
    <>
      {shortcut.combos.map((combo, index) => (
        <span
          key={combo.join("+")}
          className="shortcut-combo"
        >
          {index > 0 ? (
            <span className="shortcut-joiner">{shortcut.joiner ?? "or"}</span>
          ) : null}
          {combo.map((key) => (
            <kbd key={key}>{key}</kbd>
          ))}
        </span>
      ))}
    </>
  );
}
