type ProjectSuggestionsProps = {
  projects: string[];
  selected: string;
  onPick: (project: string) => void;
};

export function normalizeProject(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join(" ");
}

export function ProjectSuggestions({
  projects,
  selected,
  onPick,
}: ProjectSuggestionsProps) {
  if (projects.length === 0) return null;
  const current = normalizeProject(selected);
  return (
    <div
      className="project-suggestions"
      role="group"
      aria-label="Recent projects"
    >
      {projects.map((project) => (
        <button
          key={project}
          type="button"
          className={current === project ? "is-selected" : undefined}
          aria-pressed={current === project}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(project)}
        >
          {project}
        </button>
      ))}
    </div>
  );
}
