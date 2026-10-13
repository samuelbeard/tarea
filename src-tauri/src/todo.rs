use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Incomplete,
    Complete,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub status: Status,
    pub created: String,
    pub project: Option<String>,
    pub notes: String,
    pub filename: String,
    pub day: String,
    /// Position within the day, set once the day has been reordered. Unordered todos follow,
    /// oldest first.
    #[serde(skip)]
    pub order: Option<u32>,
    /// Frontmatter keys this app doesn't know about, kept so saving doesn't drop them.
    #[serde(skip)]
    pub extra: Mapping,
}

const KNOWN_KEYS: [&str; 6] = ["id", "title", "status", "created", "project", "order"];

/// The day's own notes, kept beside its todos. It is plain markdown with no frontmatter.
const NOTE_FILE: &str = "note.md";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Frontmatter {
    id: String,
    title: String,
    status: Status,
    created: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    project: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_order"
    )]
    order: Option<u32>,
}

/// Reads `order` without failing the whole file when it has been hand-edited into nonsense.
fn lenient_order<'de, D: serde::Deserializer<'de>>(de: D) -> Result<Option<u32>, D::Error> {
    Ok(Value::deserialize(de)?
        .as_u64()
        .and_then(|n| u32::try_from(n).ok()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareToday {
    pub today: String,
    pub moved: usize,
    pub problems: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTodos {
    pub todos: Vec<Todo>,
    pub problems: Vec<String>,
    pub note: String,
}

pub struct TodoPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub status: Option<Status>,
    pub project: Option<String>,
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{millis:013}-{n:06}")
}

fn parse_day(day: &str) -> Result<NaiveDate, String> {
    if day.len() != 10 || day.contains(['/', '\\', '.']) {
        return Err(format!("Invalid date: {day}"));
    }
    NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| format!("Invalid date: {day}"))
}

fn day_dir(library: &Path, day: &str) -> Result<PathBuf, String> {
    parse_day(day)?;
    Ok(library.join(day))
}

fn clean_title(title: &str) -> Result<String, String> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        Err("A todo needs a title.".into())
    } else {
        Ok(title)
    }
}

fn clean_project(project: &str) -> Option<String> {
    let project = project.split_whitespace().collect::<Vec<_>>().join(" ");
    if project.is_empty() {
        None
    } else {
        Some(project)
    }
}

fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut hyphen = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            hyphen = false;
        } else if !hyphen && !slug.is_empty() {
            slug.push('-');
            hyphen = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "todo".to_string()
    } else {
        slug.to_string()
    }
}

fn name_available(dir: &Path, name: &str, current: Option<&str>) -> bool {
    if name == NOTE_FILE {
        return false;
    }
    if current == Some(name) {
        return true;
    }
    !dir.join(name).exists()
}

fn filename_for(dir: &Path, title: &str, id: &str, current: Option<&str>) -> String {
    let base = slugify(title);
    let primary = format!("{base}.md");
    if name_available(dir, &primary, current) {
        return primary;
    }
    let short: String = id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    let mut n = 2u32;
    loop {
        let name = if n == 2 {
            format!("{base}-{short}.md")
        } else {
            format!("{base}-{short}-{n}.md")
        };
        if name_available(dir, &name, current) {
            return name;
        }
        n += 1;
        if n > 1000 {
            return format!("{base}-{id}.md");
        }
    }
}

fn yaml_body(meta: &Frontmatter, extra: &Mapping) -> Result<String, String> {
    let mut fields = match serde_yaml::to_value(meta) {
        Ok(Value::Mapping(fields)) => fields,
        Ok(_) => return Err("Could not write todo.".into()),
        Err(err) => return Err(format!("Could not write todo: {err}")),
    };
    for (key, value) in extra {
        if !fields.contains_key(key) {
            fields.insert(key.clone(), value.clone());
        }
    }
    let yaml =
        serde_yaml::to_string(&fields).map_err(|err| format!("Could not write todo: {err}"))?;
    let yaml = yaml
        .trim()
        .strip_prefix("---")
        .unwrap_or(yaml.trim())
        .trim();
    Ok(yaml.to_string())
}

fn render(meta: &Frontmatter, extra: &Mapping, notes: &str) -> Result<String, String> {
    let yaml = yaml_body(meta, extra)?;
    if notes.is_empty() {
        Ok(format!("---\n{yaml}\n---\n"))
    } else {
        Ok(format!("---\n{yaml}\n---\n\n{notes}\n"))
    }
}

fn parse_document(raw: &str) -> Result<(Frontmatter, Mapping, String), String> {
    let raw = raw.replace("\r\n", "\n");
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    let rest = raw
        .strip_prefix("---\n")
        .ok_or("This todo file has no frontmatter.")?;
    let (yaml, after) = rest
        .split_once("\n---")
        .ok_or("This todo file has unfinished frontmatter.")?;
    let notes = match after {
        "" => String::new(),
        body if body.starts_with('\n') => body[1..].trim().to_string(),
        body => body.trim().to_string(),
    };
    let meta: Frontmatter =
        serde_yaml::from_str(yaml).map_err(|err| format!("Could not read frontmatter: {err}"))?;
    let mut extra: Mapping =
        serde_yaml::from_str(yaml).map_err(|err| format!("Could not read frontmatter: {err}"))?;
    for key in KNOWN_KEYS {
        extra.remove(key);
    }
    if meta.id.trim().is_empty() {
        return Err("This todo is missing an id.".into());
    }
    if meta.title.trim().is_empty() {
        return Err("This todo is missing a title.".into());
    }
    parse_day(&meta.created)?;
    Ok((meta, extra, notes))
}

/// Lists a day's todo files, leaving out the day's note.
fn markdown_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in
        fs::read_dir(dir).map_err(|err| format!("Could not read {}: {err}", dir.display()))?
    {
        let entry = entry.map_err(|err| format!("Could not read {}: {err}", dir.display()))?;
        let path = entry.path();
        let is_md = path.extension().and_then(|ext| ext.to_str()) == Some("md");
        let is_note = path.file_name().is_some_and(|name| name == NOTE_FILE);
        if is_md && !is_note && path.is_file() {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn read_todo(path: &Path, day: &str) -> Result<Todo, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
    let (meta, extra, notes) =
        parse_document(&raw).map_err(|err| format!("{}: {err}", path.display()))?;
    Ok(Todo {
        id: meta.id,
        title: meta.title,
        status: meta.status,
        created: meta.created,
        project: meta.project.and_then(|project| clean_project(&project)),
        order: meta.order,
        notes,
        filename: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        day: day.to_string(),
        extra,
    })
}

fn write_todo(path: &Path, todo: &Todo) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create {}: {err}", parent.display()))?;
    }
    let meta = Frontmatter {
        id: todo.id.clone(),
        title: todo.title.clone(),
        status: todo.status,
        created: todo.created.clone(),
        project: todo.project.clone(),
        order: todo.order,
    };
    let raw = render(&meta, &todo.extra, &todo.notes)?;
    write_atomic(path, &raw)
}

/// Writes through a temp file so an interrupted save never leaves a half-written file.
fn write_atomic(path: &Path, raw: &str) -> Result<(), String> {
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, raw).map_err(|err| format!("Could not write {}: {err}", path.display()))?;
    fs::rename(&tmp, path).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        format!("Could not write {}: {err}", path.display())
    })
}

fn find_todo(library: &Path, day: &str, id: &str) -> Result<Todo, String> {
    scan_day(library, day)?
        .todos
        .into_iter()
        .find(|todo| todo.id == id)
        .ok_or_else(|| "That todo is no longer on this day.".into())
}

fn move_file(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create {}: {err}", parent.display()))?;
    }
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(src, dest).map_err(|err| format!("Could not move todo: {err}"))?;
            fs::remove_file(src).map_err(|err| format!("Could not move todo: {err}"))?;
            Ok(())
        }
    }
}

fn remove_dir_if_empty(dir: &Path) -> Result<(), String> {
    if !dir.exists() || !markdown_files(dir)?.is_empty() || dir.join(NOTE_FILE).exists() {
        return Ok(());
    }
    let mut entries =
        fs::read_dir(dir).map_err(|err| format!("Could not read {}: {err}", dir.display()))?;
    if entries.next().is_none() {
        fs::remove_dir(dir).map_err(|err| format!("Could not remove {}: {err}", dir.display()))?;
    }
    Ok(())
}

fn relocate(library: &Path, todo: &Todo, to_day: &str) -> Result<Todo, String> {
    let from_dir = day_dir(library, &todo.day)?;
    let to_dir = day_dir(library, to_day)?;
    fs::create_dir_all(&to_dir)
        .map_err(|err| format!("Could not create {}: {err}", to_dir.display()))?;
    let filename = filename_for(&to_dir, &todo.title, &todo.id, None);
    let dest = to_dir.join(&filename);
    move_file(&from_dir.join(&todo.filename), &dest)?;
    remove_dir_if_empty(&from_dir)?;
    let moved = Todo {
        filename,
        day: to_day.to_string(),
        order: None,
        ..todo.clone()
    };
    // Its place on the old day means nothing on the new one, so it joins the end there.
    if todo.order.is_some() {
        write_todo(&dest, &moved)?;
    }
    Ok(moved)
}

fn list_day_names(library: &Path) -> Result<Vec<String>, String> {
    if !library.is_dir() {
        return Err("The todo folder is missing. Choose it again.".into());
    }
    let mut days = Vec::new();
    for entry in fs::read_dir(library)
        .map_err(|err| format!("Could not read {}: {err}", library.display()))?
    {
        let entry = entry.map_err(|err| format!("Could not read {}: {err}", library.display()))?;
        let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if parse_day(&name).is_err() {
            continue;
        }
        if markdown_files(&entry.path())?.is_empty() && !entry.path().join(NOTE_FILE).is_file() {
            let _ = remove_dir_if_empty(&entry.path());
            continue;
        }
        days.push(name);
    }
    days.sort();
    Ok(days)
}

/// Removes `.md.tmp` files left behind by a write that never finished.
fn clear_stale_temp_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().ends_with(".md.tmp") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Reads every todo on a day. Files that can't be read are reported instead of failing the day,
/// and a todo whose id repeats (usually a sync-conflict copy) gets a fresh id so both stay usable.
fn scan_day(library: &Path, day: &str) -> Result<DayTodos, String> {
    let dir = day_dir(library, day)?;
    clear_stale_temp_files(&dir);
    let mut todos = Vec::new();
    let mut problems = Vec::new();
    let mut seen = HashSet::new();
    for path in markdown_files(&dir)? {
        let mut todo = match read_todo(&path, day) {
            Ok(todo) => todo,
            Err(err) => {
                problems.push(format!("Skipped a file that couldn't be read. {err}"));
                continue;
            }
        };
        if !seen.insert(todo.id.clone()) {
            todo.id = new_id();
            if let Err(err) = write_todo(&path, &todo) {
                problems.push(format!(
                    "Skipped {} because it repeats another todo's id: {err}",
                    path.display()
                ));
                continue;
            }
            seen.insert(todo.id.clone());
        }
        todos.push(todo);
    }
    todos.sort_by(|a, b| {
        (a.order.is_none(), a.order, &a.id).cmp(&(b.order.is_none(), b.order, &b.id))
    });
    let note = match read_note(&dir) {
        Ok(note) => note,
        Err(err) => {
            problems.push(err);
            String::new()
        }
    };
    Ok(DayTodos {
        todos,
        problems,
        note,
    })
}

fn read_note(dir: &Path) -> Result<String, String> {
    let path = dir.join(NOTE_FILE);
    if !path.is_file() {
        return Ok(String::new());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|err| format!("Could not read {}: {err}", path.display()))?;
    let raw = raw.replace("\r\n", "\n");
    Ok(raw
        .strip_prefix('\u{feff}')
        .unwrap_or(&raw)
        .trim()
        .to_string())
}

/// Saves the day's note, or removes it when the note is blank so empty days don't linger.
fn write_note(library: &Path, day: &str, note: &str) -> Result<String, String> {
    let dir = day_dir(library, day)?;
    let note = note.trim().to_string();
    let path = dir.join(NOTE_FILE);
    if note.is_empty() {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|err| format!("Could not remove {}: {err}", path.display()))?;
        }
        remove_dir_if_empty(&dir)?;
        return Ok(note);
    }
    fs::create_dir_all(&dir).map_err(|err| format!("Could not create {}: {err}", dir.display()))?;
    write_atomic(&path, &format!("{note}\n"))?;
    Ok(note)
}

fn read_day(library: &Path, day: &str) -> Result<Vec<Todo>, String> {
    Ok(scan_day(library, day)?.todos)
}

fn add_todo(
    library: &Path,
    day: &str,
    title: &str,
    project: Option<&str>,
    today: NaiveDate,
) -> Result<Todo, String> {
    let date = parse_day(day)?;
    if date < today {
        return Err("New todos can only be added to today or a future day.".into());
    }
    let title = clean_title(title)?;
    let dir = day_dir(library, day)?;
    fs::create_dir_all(&dir).map_err(|err| format!("Could not create {}: {err}", dir.display()))?;
    let id = new_id();
    let filename = filename_for(&dir, &title, &id, None);
    let todo = Todo {
        id,
        title,
        status: Status::Incomplete,
        created: today.format("%Y-%m-%d").to_string(),
        project: project.and_then(clean_project),
        notes: String::new(),
        filename,
        day: day.to_string(),
        order: None,
        extra: Mapping::new(),
    };
    write_todo(&dir.join(&todo.filename), &todo)?;
    Ok(todo)
}

fn edit_todo(library: &Path, day: &str, id: &str, patch: TodoPatch) -> Result<Todo, String> {
    let dir = day_dir(library, day)?;
    let mut todo = find_todo(library, day, id)?;
    if let Some(title) = patch.title {
        todo.title = clean_title(&title)?;
    }
    if let Some(notes) = patch.notes {
        todo.notes = notes.trim().to_string();
    }
    if let Some(status) = patch.status {
        todo.status = status;
    }
    if let Some(project) = patch.project {
        todo.project = clean_project(&project);
    }
    // Save under the current name first, then rename, so an interruption never leaves two copies.
    let old_path = dir.join(&todo.filename);
    write_todo(&old_path, &todo)?;
    let filename = filename_for(&dir, &todo.title, &todo.id, Some(&todo.filename));
    if filename != todo.filename && fs::rename(&old_path, dir.join(&filename)).is_ok() {
        todo.filename = filename;
    }
    Ok(todo)
}

fn shift_todo(
    library: &Path,
    id: &str,
    from_day: &str,
    to_day: &str,
    today: NaiveDate,
) -> Result<Todo, String> {
    let to_date = parse_day(to_day)?;
    if from_day == to_day {
        return Err("That todo is already on that day.".into());
    }
    if to_date <= today {
        return Err("Todos can only be moved to a future day.".into());
    }
    let todo = find_todo(library, from_day, id)?;
    relocate(library, &todo, to_day)
}

/// Puts a day's todos in the order of `ids`. Todos missing from `ids`, such as ones added by
/// another app since the list was shown, keep their place after the listed ones. Only files whose
/// position changed are rewritten.
fn reorder_day(library: &Path, day: &str, ids: &[String]) -> Result<Vec<Todo>, String> {
    let dir = day_dir(library, day)?;
    let mut todos = read_day(library, day)?;
    todos.sort_by_key(|todo| {
        ids.iter()
            .position(|id| id == &todo.id)
            .unwrap_or(usize::MAX)
    });
    for (index, todo) in todos.iter_mut().enumerate() {
        let order = Some(index as u32 + 1);
        if todo.order != order {
            todo.order = order;
            write_todo(&dir.join(&todo.filename), todo)?;
        }
    }
    Ok(todos)
}

/// Sends a todo's file to the system Trash so a mistaken delete can be recovered.
fn move_to_trash(path: &Path) -> Result<(), String> {
    let mut trash = trash::TrashContext::default();
    // Finder's method needs Automation permission and plays a sound; this one needs neither.
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        trash.set_delete_method(DeleteMethod::NsFileManager);
    }
    trash
        .delete(path)
        .map_err(|err| format!("Could not move todo to the Trash: {err}"))
}

/// Removes a todo with `discard`, which is `move_to_trash` outside tests.
fn remove_todo(
    library: &Path,
    day: &str,
    id: &str,
    discard: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let dir = day_dir(library, day)?;
    let todo = find_todo(library, day, id)?;
    discard(&dir.join(&todo.filename))?;
    remove_dir_if_empty(&dir)
}

/// Carries unfinished todos from past days to today. A todo that can't be moved is reported
/// and left where it is, so one bad file never blocks the rest.
fn roll_forward(library: &Path, today: NaiveDate) -> Result<(usize, Vec<String>), String> {
    let today_str = today.format("%Y-%m-%d").to_string();
    let mut moved = 0usize;
    let mut problems = Vec::new();
    for day in list_day_names(library)? {
        let date = parse_day(&day)?;
        if date >= today {
            continue;
        }
        let scanned = match scan_day(library, &day) {
            Ok(scanned) => scanned,
            Err(err) => {
                problems.push(err);
                continue;
            }
        };
        problems.extend(scanned.problems);
        for todo in scanned.todos {
            if todo.status != Status::Incomplete {
                continue;
            }
            match relocate(library, &todo, &today_str) {
                Ok(_) => moved += 1,
                Err(err) => {
                    problems.push(format!("Could not carry \"{}\" forward: {err}", todo.title))
                }
            }
        }
    }
    Ok((moved, problems))
}

fn recent_project_names(library: &Path, today: NaiveDate) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for offset in 0..7 {
        let Some(date) = today.checked_sub_signed(chrono::Duration::days(offset)) else {
            continue;
        };
        let day = date.format("%Y-%m-%d").to_string();
        if !day_dir(library, &day)?.exists() {
            continue;
        }
        let mut todos = read_day(library, &day)?;
        todos.reverse();
        for todo in todos {
            let Some(project) = todo.project else {
                continue;
            };
            if !names.iter().any(|name| name == &project) {
                names.push(project);
            }
        }
    }
    Ok(names)
}

fn parse_status(status: &str) -> Result<Status, String> {
    match status {
        "incomplete" => Ok(Status::Incomplete),
        "complete" => Ok(Status::Complete),
        "cancelled" => Ok(Status::Cancelled),
        _ => Err(format!("Unknown status: {status}")),
    }
}

#[tauri::command]
pub fn prepare_today(app: tauri::AppHandle) -> Result<PrepareToday, String> {
    let library = crate::library::require_library(&app)?;
    let today = Local::now().date_naive();
    let (moved, problems) = roll_forward(&library, today)?;
    Ok(PrepareToday {
        today: today.format("%Y-%m-%d").to_string(),
        moved,
        problems,
    })
}

#[tauri::command]
pub fn list_days(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let library = crate::library::require_library(&app)?;
    list_day_names(&library)
}

#[tauri::command]
pub fn load_day(app: tauri::AppHandle, date: String) -> Result<DayTodos, String> {
    let library = crate::library::require_library(&app)?;
    scan_day(&library, &date)
}

#[tauri::command]
pub fn create_todo(
    app: tauri::AppHandle,
    date: String,
    title: String,
    project: Option<String>,
) -> Result<Todo, String> {
    let library = crate::library::require_library(&app)?;
    add_todo(
        &library,
        &date,
        &title,
        project.as_deref(),
        Local::now().date_naive(),
    )
}

#[tauri::command]
pub fn recent_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let library = crate::library::require_library(&app)?;
    recent_project_names(&library, Local::now().date_naive())
}

#[tauri::command]
pub fn update_todo(
    app: tauri::AppHandle,
    date: String,
    id: String,
    title: Option<String>,
    notes: Option<String>,
    status: Option<String>,
    project: Option<String>,
) -> Result<Todo, String> {
    let library = crate::library::require_library(&app)?;
    let status = status.map(|value| parse_status(&value)).transpose()?;
    edit_todo(
        &library,
        &date,
        &id,
        TodoPatch {
            title,
            notes,
            status,
            project,
        },
    )
}

#[tauri::command]
pub fn reorder_todos(
    app: tauri::AppHandle,
    date: String,
    ids: Vec<String>,
) -> Result<Vec<Todo>, String> {
    let library = crate::library::require_library(&app)?;
    reorder_day(&library, &date, &ids)
}

#[tauri::command]
pub fn save_note(app: tauri::AppHandle, date: String, note: String) -> Result<String, String> {
    let library = crate::library::require_library(&app)?;
    write_note(&library, &date, &note)
}

#[tauri::command]
pub fn delete_todo(app: tauri::AppHandle, date: String, id: String) -> Result<(), String> {
    let library = crate::library::require_library(&app)?;
    remove_todo(&library, &date, &id, move_to_trash)
}

#[tauri::command]
pub fn move_todo(
    app: tauri::AppHandle,
    id: String,
    from_date: String,
    to_date: String,
) -> Result<Todo, String> {
    let library = crate::library::require_library(&app)?;
    shift_todo(
        &library,
        &id,
        &from_date,
        &to_date,
        Local::now().date_naive(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("tarea-todos-{label}-{nanos}"));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn iso(date: NaiveDate) -> String {
        date.format("%Y-%m-%d").to_string()
    }

    #[test]
    fn round_trips_frontmatter_notes_and_special_titles() {
        let library = TempDir::new("roundtrip");
        let today = day(2026, 10, 6);
        let created = add_todo(library.path(), &iso(today), "Buy: milk", None, today).unwrap();
        let updated = edit_todo(
            library.path(),
            &iso(today),
            &created.id,
            TodoPatch {
                title: None,
                notes: Some("Oat milk\n---\nstill milk".into()),
                status: Some(Status::Complete),
                project: None,
            },
        )
        .unwrap();

        let raw =
            fs::read_to_string(library.path().join(&iso(today)).join(&updated.filename)).unwrap();
        assert!(raw.starts_with("---\n"));
        assert!(raw.contains("title:"));
        assert!(raw.contains("status: complete"));
        assert!(
            raw.contains("created: '2026-10-06'")
                || raw.contains("created: \"2026-10-06\"")
                || raw.contains("created: 2026-10-06")
        );

        let loaded = read_day(library.path(), &iso(today)).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "Buy: milk");
        assert_eq!(loaded[0].notes, "Oat milk\n---\nstill milk");
        assert_eq!(loaded[0].status, Status::Complete);
        assert_eq!(loaded[0].created, "2026-10-06");
        assert_eq!(loaded[0].id, created.id);
        assert_eq!(loaded[0].project, None);
        assert!(!raw.contains("project:"));
    }

    #[test]
    fn identical_titles_get_distinct_slugs() {
        let library = TempDir::new("slugs");
        let today = day(2026, 10, 6);
        let first = add_todo(library.path(), "2026-10-06", "Buy milk!", None, today).unwrap();
        let second = add_todo(library.path(), "2026-10-06", "Buy milk!", None, today).unwrap();
        assert_eq!(first.filename, "buy-milk.md");
        assert_ne!(first.filename, second.filename);
        assert!(second.filename.starts_with("buy-milk-"));
        assert!(second.filename.ends_with(".md"));

        let blank = add_todo(library.path(), "2026-10-06", "!!!", None, today).unwrap();
        assert_eq!(blank.filename, "todo.md");

        let loaded = read_day(library.path(), "2026-10-06").unwrap();
        assert_eq!(loaded.len(), 3);
        assert!(loaded[0].id < loaded[1].id);
    }

    #[test]
    fn renaming_keeps_id_and_created_date() {
        let library = TempDir::new("rename");
        let today = day(2026, 10, 6);
        let todo = add_todo(library.path(), "2026-10-08", "Draft", None, today).unwrap();
        assert_eq!(todo.created, "2026-10-06");
        let renamed = edit_todo(
            library.path(),
            "2026-10-08",
            &todo.id,
            TodoPatch {
                title: Some("Final draft".into()),
                notes: None,
                status: None,
                project: None,
            },
        )
        .unwrap();
        assert_eq!(renamed.id, todo.id);
        assert_eq!(renamed.created, todo.created);
        assert_eq!(renamed.filename, "final-draft.md");
        assert!(!library.path().join("2026-10-08").join("draft.md").exists());
    }

    #[test]
    fn move_is_future_only_and_keeps_created_date() {
        let library = TempDir::new("move");
        let today = day(2026, 10, 6);
        let todo = add_todo(library.path(), "2026-10-06", "Dentist", None, today).unwrap();
        let raw_before =
            fs::read_to_string(library.path().join("2026-10-06").join(&todo.filename)).unwrap();

        let err =
            shift_todo(library.path(), &todo.id, "2026-10-06", "2026-10-06", today).unwrap_err();
        assert!(err.contains("already"));
        let err =
            shift_todo(library.path(), &todo.id, "2026-10-06", "2026-10-05", today).unwrap_err();
        assert!(err.contains("future"));
        let err = shift_todo(
            library.path(),
            &todo.id,
            "2026-10-06",
            "2026-10-06",
            day(2026, 10, 1),
        )
        .unwrap_err();
        assert!(err.contains("already"));

        add_todo(library.path(), "2026-10-09", "Dentist", None, today).unwrap();
        let moved =
            shift_todo(library.path(), &todo.id, "2026-10-06", "2026-10-09", today).unwrap();
        assert_eq!(moved.day, "2026-10-09");
        assert_eq!(moved.created, "2026-10-06");
        assert!(moved.filename.starts_with("dentist-"));
        assert_ne!(moved.filename, "dentist.md");
        assert!(!library.path().join("2026-10-06").exists());
        let raw_after =
            fs::read_to_string(library.path().join("2026-10-09").join(&moved.filename)).unwrap();
        assert_eq!(
            parse_document(&raw_before).unwrap().0.created,
            parse_document(&raw_after).unwrap().0.created
        );

        let err =
            shift_todo(library.path(), &moved.id, "2026-10-09", "2026-10-06", today).unwrap_err();
        assert!(err.contains("future"));
    }

    #[test]
    fn cannot_add_a_todo_on_a_past_day() {
        let library = TempDir::new("past-add");
        let err =
            add_todo(library.path(), "2026-10-01", "Late", None, day(2026, 10, 6)).unwrap_err();
        assert!(err.contains("today or a future"));
        assert!(list_day_names(library.path()).unwrap().is_empty());
    }

    #[test]
    fn rollover_moves_only_past_incomplete_todos() {
        let library = TempDir::new("rollover");
        let oct4 = day(2026, 10, 4);
        let oct5 = day(2026, 10, 5);
        let oct6 = day(2026, 10, 6);
        let oct8 = day(2026, 10, 8);

        let carried = add_todo(library.path(), &iso(oct4), "Carry me", None, oct4).unwrap();
        let done = add_todo(library.path(), &iso(oct5), "Done already", None, oct5).unwrap();
        edit_todo(
            library.path(),
            &iso(oct5),
            &done.id,
            TodoPatch {
                title: None,
                notes: None,
                status: Some(Status::Complete),
                project: None,
            },
        )
        .unwrap();
        let cancelled = add_todo(library.path(), &iso(oct5), "Skip", None, oct5).unwrap();
        edit_todo(
            library.path(),
            &iso(oct5),
            &cancelled.id,
            TodoPatch {
                title: None,
                notes: None,
                status: Some(Status::Cancelled),
                project: None,
            },
        )
        .unwrap();
        let future = add_todo(library.path(), &iso(oct8), "Later", None, oct6).unwrap();

        let (moved, problems) = roll_forward(library.path(), oct6).unwrap();
        assert_eq!(moved, 1);
        assert!(problems.is_empty());
        assert!(!library.path().join("2026-10-04").exists());

        let today_items = read_day(library.path(), "2026-10-06").unwrap();
        assert_eq!(today_items.len(), 1);
        assert_eq!(today_items[0].id, carried.id);
        assert_eq!(today_items[0].created, "2026-10-04");
        assert_eq!(today_items[0].status, Status::Incomplete);

        let finished = read_day(library.path(), "2026-10-05").unwrap();
        assert_eq!(finished.len(), 2);
        assert!(finished
            .iter()
            .any(|todo| todo.id == done.id && todo.status == Status::Complete));
        assert!(finished
            .iter()
            .any(|todo| todo.id == cancelled.id && todo.status == Status::Cancelled));

        let later = read_day(library.path(), "2026-10-08").unwrap();
        assert_eq!(later.len(), 1);
        assert_eq!(later[0].id, future.id);

        let days = list_day_names(library.path()).unwrap();
        assert_eq!(days, vec!["2026-10-05", "2026-10-06", "2026-10-08"]);
    }

    #[test]
    fn rollover_does_not_create_today_when_nothing_moves() {
        let library = TempDir::new("quiet-rollover");
        let (moved, _) = roll_forward(library.path(), day(2026, 10, 6)).unwrap();
        assert_eq!(moved, 0);
        assert!(!library.path().join("2026-10-06").exists());

        let future = add_todo(
            library.path(),
            "2026-10-10",
            "Stay put",
            None,
            day(2026, 10, 6),
        )
        .unwrap();
        let (moved, _) = roll_forward(library.path(), day(2026, 10, 6)).unwrap();
        assert_eq!(moved, 0);
        assert!(!library.path().join("2026-10-06").exists());
        assert!(library
            .path()
            .join("2026-10-10")
            .join(&future.filename)
            .is_file());
    }

    #[test]
    fn project_round_trips_clears_and_survives_a_move() {
        let library = TempDir::new("project");
        let today = day(2026, 10, 6);
        let created = add_todo(
            library.path(),
            "2026-10-06",
            "Revise homepage",
            Some("  Website   redesign "),
            today,
        )
        .unwrap();
        assert_eq!(created.project.as_deref(), Some("Website redesign"));
        assert_eq!(created.filename, "revise-homepage.md");

        let raw =
            fs::read_to_string(library.path().join("2026-10-06").join(&created.filename)).unwrap();
        assert!(raw.contains("project:"));

        let legacy_dir = library.path().join("2026-10-06");
        fs::write(
            legacy_dir.join("old-todo.md"),
            "---\nid: legacy-1\ntitle: Old todo\nstatus: incomplete\ncreated: 2026-10-06\n---\n",
        )
        .unwrap();
        let loaded = read_day(library.path(), "2026-10-06").unwrap();
        let legacy = loaded.iter().find(|todo| todo.id == "legacy-1").unwrap();
        assert_eq!(legacy.project, None);

        let cleared = edit_todo(
            library.path(),
            "2026-10-06",
            &created.id,
            TodoPatch {
                title: None,
                notes: None,
                status: None,
                project: Some("   ".into()),
            },
        )
        .unwrap();
        assert_eq!(cleared.project, None);
        assert_eq!(cleared.filename, created.filename);
        let cleared_raw =
            fs::read_to_string(library.path().join("2026-10-06").join(&cleared.filename)).unwrap();
        assert!(!cleared_raw.contains("project:"));

        let restored = edit_todo(
            library.path(),
            "2026-10-06",
            &created.id,
            TodoPatch {
                title: None,
                notes: None,
                status: None,
                project: Some("Website redesign".into()),
            },
        )
        .unwrap();
        let moved = shift_todo(
            library.path(),
            &restored.id,
            "2026-10-06",
            "2026-10-08",
            today,
        )
        .unwrap();
        assert_eq!(moved.project.as_deref(), Some("Website redesign"));
        assert_eq!(moved.filename, "revise-homepage.md");
    }

    #[test]
    fn recent_projects_cover_the_last_seven_days() {
        let library = TempDir::new("recent-projects");
        let today = day(2026, 10, 6);
        add_todo(
            library.path(),
            "2026-09-29",
            "Ancient",
            Some("Too old"),
            day(2026, 9, 29),
        )
        .unwrap();
        add_todo(
            library.path(),
            "2026-09-30",
            "Keep",
            Some("Oldest kept"),
            day(2026, 9, 30),
        )
        .unwrap();
        add_todo(
            library.path(),
            "2026-10-05",
            "Groceries",
            Some("Errands"),
            day(2026, 10, 5),
        )
        .unwrap();
        add_todo(
            library.path(),
            "2026-10-06",
            "Homepage",
            Some("Website"),
            today,
        )
        .unwrap();
        add_todo(library.path(), "2026-10-06", "Blank", Some("   "), today).unwrap();
        add_todo(library.path(), "2026-10-06", "Return", Some("Taxes"), today).unwrap();
        add_todo(library.path(), "2026-10-08", "Later", Some("Future"), today).unwrap();

        let names = recent_project_names(library.path(), today).unwrap();
        assert_eq!(
            names,
            vec![
                "Taxes".to_string(),
                "Website".to_string(),
                "Errands".to_string(),
                "Oldest kept".to_string(),
            ]
        );
    }

    #[test]
    fn a_broken_file_is_reported_without_hiding_the_rest_of_the_day() {
        let library = TempDir::new("broken");
        let today = day(2026, 10, 6);
        let good = add_todo(library.path(), "2026-10-04", "Still here", None, day(2026, 10, 4))
            .unwrap();
        let dir = library.path().join("2026-10-04");
        fs::write(dir.join("broken.md"), "no frontmatter at all").unwrap();

        let scanned = scan_day(library.path(), "2026-10-04").unwrap();
        assert_eq!(scanned.todos.len(), 1);
        assert_eq!(scanned.problems.len(), 1);
        assert!(scanned.problems[0].contains("broken.md"));

        let (moved, problems) = roll_forward(library.path(), today).unwrap();
        assert_eq!(moved, 1);
        assert_eq!(problems.len(), 1);
        assert_eq!(read_day(library.path(), "2026-10-06").unwrap()[0].id, good.id);
        assert!(dir.join("broken.md").is_file());
    }

    #[test]
    fn sync_conflict_copies_get_their_own_id() {
        let library = TempDir::new("conflict");
        let today = day(2026, 10, 6);
        let original = add_todo(library.path(), "2026-10-06", "Buy milk", None, today).unwrap();
        let dir = library.path().join("2026-10-06");
        fs::copy(dir.join("buy-milk.md"), dir.join("buy-milk 2.md")).unwrap();

        let todos = read_day(library.path(), "2026-10-06").unwrap();
        assert_eq!(todos.len(), 2);
        assert_ne!(todos[0].id, todos[1].id);
        assert!(todos.iter().any(|todo| todo.id == original.id));

        let updated = edit_todo(
            library.path(),
            "2026-10-06",
            &original.id,
            TodoPatch {
                title: None,
                notes: None,
                status: Some(Status::Complete),
                project: None,
            },
        )
        .unwrap();
        assert_eq!(updated.status, Status::Complete);
        let again = read_day(library.path(), "2026-10-06").unwrap();
        assert_eq!(again.len(), 2);
        assert_ne!(again[0].id, again[1].id);
    }

    #[test]
    fn unknown_frontmatter_survives_an_edit() {
        let library = TempDir::new("extra");
        let dir = library.path().join("2026-10-06");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("hand-made.md"),
            "---\nid: hand-1\ntitle: Hand made\nstatus: incomplete\ncreated: 2026-10-06\ntags:\n- home\npriority: 2\n---\n\nBody\n",
        )
        .unwrap();

        let edited = edit_todo(
            library.path(),
            "2026-10-06",
            "hand-1",
            TodoPatch {
                title: Some("Renamed".into()),
                notes: None,
                status: None,
                project: None,
            },
        )
        .unwrap();
        assert_eq!(edited.filename, "renamed.md");
        assert!(!dir.join("hand-made.md").exists());
        let raw = fs::read_to_string(dir.join("renamed.md")).unwrap();
        assert!(raw.contains("tags:"));
        assert!(raw.contains("- home"));
        assert!(raw.contains("priority: 2"));
        assert!(raw.contains("title: Renamed"));
        assert!(raw.ends_with("Body\n"));
    }

    #[test]
    fn reordering_persists_and_a_move_rejoins_at_the_end() {
        let library = TempDir::new("reorder");
        let today = day(2026, 10, 6);
        let a = add_todo(library.path(), "2026-10-07", "A", None, today).unwrap();
        let b = add_todo(library.path(), "2026-10-07", "B", None, today).unwrap();
        let c = add_todo(library.path(), "2026-10-07", "C", None, today).unwrap();
        let ids = |todos: Vec<Todo>| todos.into_iter().map(|todo| todo.id).collect::<Vec<_>>();

        reorder_day(library.path(), "2026-10-07", &[c.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(
            ids(read_day(library.path(), "2026-10-07").unwrap()),
            [c.id.clone(), a.id.clone(), b.id.clone()]
        );
        let raw = fs::read_to_string(library.path().join("2026-10-07").join(&c.filename)).unwrap();
        assert!(raw.contains("order: 1"));

        // A new todo lands after the ordered ones.
        let d = add_todo(library.path(), "2026-10-07", "D", None, today).unwrap();
        let moved = shift_todo(library.path(), &c.id, "2026-10-07", "2026-10-08", today).unwrap();
        assert_eq!(moved.order, None);
        let e = add_todo(library.path(), "2026-10-08", "E", None, today).unwrap();
        reorder_day(library.path(), "2026-10-08", &[e.id.clone()]).unwrap();
        assert_eq!(
            ids(read_day(library.path(), "2026-10-07").unwrap()),
            [a.id.clone(), b.id.clone(), d.id.clone()]
        );
        assert_eq!(
            ids(read_day(library.path(), "2026-10-08").unwrap()),
            [e.id.clone(), c.id.clone()]
        );
    }

    #[test]
    fn a_nonsense_order_is_ignored_rather_than_breaking_the_file() {
        let library = TempDir::new("bad-order");
        let dir = library.path().join("2026-10-06");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("odd.md"),
            "---\nid: odd-1\ntitle: Odd\nstatus: incomplete\ncreated: 2026-10-06\norder: soon\n---\n",
        )
        .unwrap();
        let todos = read_day(library.path(), "2026-10-06").unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].order, None);
    }

    #[test]
    fn leftover_temp_files_are_cleared() {
        let library = TempDir::new("temp");
        let today = day(2026, 10, 6);
        add_todo(library.path(), "2026-10-06", "Real", None, today).unwrap();
        let dir = library.path().join("2026-10-06");
        fs::write(dir.join("real.md.tmp"), "half written").unwrap();

        assert_eq!(read_day(library.path(), "2026-10-06").unwrap().len(), 1);
        assert!(!dir.join("real.md.tmp").exists());
    }

    #[test]
    fn deleting_removes_only_that_todo_and_tidies_the_day() {
        let library = TempDir::new("delete");
        let today = day(2026, 10, 6);
        let keep = add_todo(library.path(), "2026-10-06", "Keep", None, today).unwrap();
        let drop = add_todo(library.path(), "2026-10-06", "Drop", None, today).unwrap();
        let alone = add_todo(library.path(), "2026-10-07", "Alone", None, today).unwrap();

        // Tests discard directly so they never fill the real Trash.
        let discard = |path: &Path| fs::remove_file(path).map_err(|err| err.to_string());
        remove_todo(library.path(), "2026-10-06", &drop.id, discard).unwrap();
        let left = read_day(library.path(), "2026-10-06").unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, keep.id);

        let err = remove_todo(library.path(), "2026-10-06", &drop.id, discard).unwrap_err();
        assert!(err.contains("no longer"));

        remove_todo(library.path(), "2026-10-07", &alone.id, discard).unwrap();
        assert!(!library.path().join("2026-10-07").exists());
    }

    #[test]
    fn day_notes_live_beside_todos_without_becoming_todos() {
        let library = TempDir::new("note");
        let today = day(2026, 10, 6);
        let dir = library.path().join("2026-10-05");

        let saved = write_note(library.path(), "2026-10-05", "  # Plan\n\n- call Sam  \n").unwrap();
        assert_eq!(saved, "# Plan\n\n- call Sam");
        assert_eq!(
            fs::read_to_string(dir.join("note.md")).unwrap(),
            "# Plan\n\n- call Sam\n"
        );
        let scanned = scan_day(library.path(), "2026-10-05").unwrap();
        assert!(scanned.todos.is_empty());
        assert!(scanned.problems.is_empty());
        assert_eq!(scanned.note, "# Plan\n\n- call Sam");
        assert_eq!(list_day_names(library.path()).unwrap(), vec!["2026-10-05"]);

        let todo = add_todo(library.path(), "2026-10-06", "Note", None, today).unwrap();
        assert_ne!(todo.filename, "note.md");

        // A day keeps its note when its last todo rolls forward.
        let carried = add_todo(
            library.path(),
            "2026-10-05",
            "Carry",
            None,
            day(2026, 10, 5),
        )
        .unwrap();
        let (moved, problems) = roll_forward(library.path(), today).unwrap();
        assert_eq!(moved, 1);
        assert!(problems.is_empty());
        assert!(!dir.join(&carried.filename).exists());
        assert!(dir.join("note.md").is_file());
        assert_eq!(scan_day(library.path(), "2026-10-06").unwrap().note, "");

        write_note(library.path(), "2026-10-05", "   ").unwrap();
        assert!(!dir.exists());
        assert_eq!(list_day_names(library.path()).unwrap(), vec!["2026-10-06"]);
    }

    #[test]
    fn rejects_dates_that_escape_the_library() {
        let library = TempDir::new("escape");
        assert!(parse_day("../secret").is_err());
        assert!(parse_day("2026-10-6").is_err());
        assert!(read_day(library.path(), "../secret").is_err());
    }
}
