type SetupScreenProps = {
  error: string | null;
  onChoose: () => void;
};

export function SetupScreen({ error, onChoose }: SetupScreenProps) {
  return (
    <main className="setup">
      <section className="setup-card">
        <p className="kicker">Tarea</p>
        <h1>Where should your todos live?</h1>
        <p className="setup-copy">
          Pick a folder. This app will create a <code>Tarea</code> folder there and save each todo
          as a markdown file, grouped by day.
        </p>
        {error ? <p className="error">{error}</p> : null}
        <button type="button" className="primary" onClick={onChoose}>
          Choose a folder
        </button>
      </section>
    </main>
  );
}
