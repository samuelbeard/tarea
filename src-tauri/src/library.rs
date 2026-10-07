use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const LIBRARY_DIR: &str = "Tarea";
const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Serialize, Deserialize, Default)]
struct Settings {
    library: Option<String>,
}

fn settings_file(config_dir: &Path) -> PathBuf {
    config_dir.join(SETTINGS_FILE)
}

pub fn read_library(config_dir: &Path) -> Result<Option<PathBuf>, String> {
    let path = settings_file(config_dir);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|err| format!("Could not read settings: {err}"))?;
    let settings: Settings =
        serde_json::from_str(&raw).map_err(|err| format!("Could not read settings: {err}"))?;
    let Some(library) = settings.library else {
        return Ok(None);
    };
    let library = PathBuf::from(library);
    if library.is_dir() {
        Ok(Some(library))
    } else {
        Ok(None)
    }
}

/// Uses the `Tarea` folder inside `parent`, creating it if needed. Picking a `Tarea` folder
/// itself uses it as-is, so choosing an existing library never nests a second one inside it.
pub fn create_library(parent: &Path) -> Result<PathBuf, String> {
    if !parent.is_dir() {
        return Err("Choose a folder that exists.".into());
    }
    let library = if parent.file_name().is_some_and(|name| name == LIBRARY_DIR) {
        parent.to_path_buf()
    } else {
        parent.join(LIBRARY_DIR)
    };
    fs::create_dir_all(&library)
        .map_err(|err| format!("Could not create the Tarea folder: {err}"))?;
    library
        .canonicalize()
        .map_err(|err| format!("Could not open the Tarea folder: {err}"))
}

pub fn save_library(config_dir: &Path, library: &Path) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|err| format!("Could not save settings: {err}"))?;
    let settings = Settings {
        library: Some(library.to_string_lossy().into_owned()),
    };
    let raw = serde_json::to_string_pretty(&settings)
        .map_err(|err| format!("Could not save settings: {err}"))?;
    fs::write(settings_file(config_dir), raw)
        .map_err(|err| format!("Could not save settings: {err}"))
}

pub fn require_library(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not find app settings: {err}"))?;
    read_library(&config_dir)?.ok_or_else(|| "Choose a folder for your todos first.".into())
}

#[tauri::command]
pub fn get_library(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not find app settings: {err}"))?;
    Ok(read_library(&config_dir)?.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn set_library(app: tauri::AppHandle, parent_path: String) -> Result<String, String> {
    let library = create_library(Path::new(&parent_path))?;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not find app settings: {err}"))?;
    save_library(&config_dir, &library)?;
    Ok(library.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("tarea-{label}-{nanos}"));
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

    #[test]
    fn creates_tarea_folder_and_remembers_it_until_it_disappears() {
        let parent = TempDir::new("parent");
        let config = TempDir::new("config");
        let library = create_library(parent.path()).unwrap();
        assert_eq!(library.file_name().unwrap(), "Tarea");
        assert!(library.is_dir());

        save_library(config.path(), &library).unwrap();
        let stored = read_library(config.path()).unwrap().unwrap();
        assert_eq!(stored, library);

        fs::remove_dir_all(&library).unwrap();
        assert!(read_library(config.path()).unwrap().is_none());
    }

    #[test]
    fn picking_an_existing_tarea_folder_uses_it_directly() {
        let parent = TempDir::new("reuse");
        let first = create_library(parent.path()).unwrap();
        let again = create_library(&first).unwrap();
        assert_eq!(again, first);
        assert!(!first.join("Tarea").exists());
    }

    #[test]
    fn missing_settings_mean_no_library() {
        let config = TempDir::new("empty-config");
        assert!(read_library(config.path()).unwrap().is_none());
    }
}
