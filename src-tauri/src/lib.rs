mod library;
mod todo;

/// Replaces the default macOS menu so the app menu can hold Settings… and Help can list shortcuts.
/// Setting a menu drops the defaults, so the standard Edit and Window menus are rebuilt too;
/// without Edit, copy and paste stop working in text fields.
#[cfg(target_os = "macos")]
fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    use tauri::Emitter;

    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Tarea")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let shortcuts = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .fullscreen()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help").item(&shortcuts).build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu, &help_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let name = match event.id().as_ref() {
            "settings" => "open-settings",
            "shortcuts" => "open-shortcuts",
            _ => return,
        };
        let _ = app.emit(name, ());
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            install_menu(_app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::get_library,
            library::set_library,
            todo::prepare_today,
            todo::list_days,
            todo::load_day,
            todo::create_todo,
            todo::update_todo,
            todo::move_todo,
            todo::delete_todo,
            todo::save_note,
            todo::recent_projects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
