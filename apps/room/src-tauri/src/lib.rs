use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager, Runtime, WindowEvent};
use tauri_plugin_fs::FsExt;

// 사용자가 고른 폴더(런타임 fs 스코프) 안의 경로만 받습니다. 스코프는 심볼릭 링크와 '..'를 풀어서 비교합니다.
fn in_scope<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
  if app.fs_scope().is_allowed(path) {
    Ok(())
  } else {
    Err("고른 폴더 밖의 경로예요.".into())
  }
}

// 상위 폴더는 바로 아래 항목만 보이게 골라 두고, 사용자가 방으로 고른 하위 폴더만 하위 전체를 엽니다.
#[tauri::command]
fn allow_rooms<R: Runtime>(app: AppHandle<R>, folders: Vec<PathBuf>) -> Result<(), String> {
  for folder in &folders {
    in_scope(&app, folder)?;
    if !folder.is_dir() {
      return Err("폴더가 아니에요.".into());
    }
    app.fs_scope().allow_directory(folder, true).map_err(|e| e.to_string())?;
  }
  Ok(())
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

// 숨김 설정을 읽은 뒤에 띄우려고 처음에는 숨겨 둡니다. 띄워도 사용자가 쓰던 메인 창의 포커스는 뺏지 않아요.
#[tauri::command]
fn set_pet_visible<R: Runtime>(app: AppHandle<R>, visible: bool) -> Result<(), String> {
  let pet = app.get_webview_window("pet").ok_or("플로팅 창이 없어요.")?;
  if !visible {
    return pet.hide().map_err(|e| e.to_string());
  }
  let main = app.get_webview_window("main").filter(|window| window.is_focused().unwrap_or(false));
  pet.show().map_err(|e| e.to_string())?;
  if let Some(main) = main {
    let _ = main.set_focus();
  }
  Ok(())
}

// 켤 때는 화면 우상단에 둡니다. 가운데에 뜨면 메인 창의 인트로와 겹쳐요. 메뉴 막대 아래로 내려 둡니다.
fn place_pet_top_right<R: Runtime>(pet: &tauri::WebviewWindow<R>) {
  const WIDTH: f64 = 216.0;
  const RIGHT_GAP: f64 = 16.0;
  const TOP_GAP: f64 = 44.0;
  let Ok(Some(monitor)) = pet.primary_monitor() else { return };
  let scale = monitor.scale_factor();
  let x = monitor.position().x as f64 + monitor.size().width as f64 - (WIDTH + RIGHT_GAP) * scale;
  let y = monitor.position().y as f64 + TOP_GAP * scale;
  let _ = pet.set_position(tauri::PhysicalPosition::new(x, y));
  // 메인 창이 플로팅 창 자리까지 오면 건너뛰기와 머리 버튼이 가려져요. 왼쪽으로 비켜 둡니다.
  if let Some(main) = pet.app_handle().get_webview_window("main") {
    if let (Ok(at), Ok(size)) = (main.outer_position(), main.outer_size()) {
      let overlap = at.x as f64 + size.width as f64 - x;
      if overlap > 0.0 {
        let _ = main.set_position(tauri::PhysicalPosition::new((at.x as f64 - overlap).max(monitor.position().x as f64), at.y as f64));
      }
    }
  }
}

// 다른 앱으로 옮겨도, 다른 데스크톱이나 전체 화면 앱으로 가도 플로팅 창이 따라옵니다.
// 일반 창은 다른 앱의 전체 화면 위에 뜨지 못해 패널로 바꿉니다. 눌러도 앱이 앞으로 나오지 않아 쓰던 전체 화면을 떠나지 않아요.
#[cfg(target_os = "macos")]
fn float_everywhere<R: Runtime>(window: &tauri::WebviewWindow<R>) {
  use std::ffi::{c_char, c_void};
  type Id = *mut c_void;
  type Sel = *const c_void;
  #[link(name = "objc")]
  unsafe extern "C" {
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_getClass(name: *const c_char) -> Id;
    fn objc_allocateClassPair(superclass: Id, name: *const c_char, extra: usize) -> Id;
    fn objc_registerClassPair(class: Id);
    fn class_addMethod(class: Id, name: Sel, imp: *const c_void, types: *const c_char) -> i8;
    fn object_setClass(object: Id, class: Id) -> Id;
    fn objc_msgSend();
  }
  // 테두리 없는 패널은 기본으로 포커스를 받지 못해, 메뉴를 닫는 신호(blur)가 오지 않습니다.
  extern "C" fn yes(_: Id, _: Sel) -> i8 {
    1
  }
  const NONACTIVATING_PANEL: usize = 1 << 7;
  const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
  const STATIONARY: usize = 1 << 4;
  const IGNORES_CYCLE: usize = 1 << 6;
  const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
  const STATUS_WINDOW_LEVEL: isize = 25;
  let Ok(ns_window) = window.ns_window() else { return };
  unsafe {
    let get_usize: extern "C" fn(Id, Sel) -> usize = std::mem::transmute(objc_msgSend as *const ());
    let set_usize: extern "C" fn(Id, Sel, usize) = std::mem::transmute(objc_msgSend as *const ());
    let set_isize: extern "C" fn(Id, Sel, isize) = std::mem::transmute(objc_msgSend as *const ());
    let set_bool: extern "C" fn(Id, Sel, i8) = std::mem::transmute(objc_msgSend as *const ());
    let panel = objc_allocateClassPair(objc_getClass(c"NSPanel".as_ptr()), c"FolductPetPanel".as_ptr(), 0);
    if panel.is_null() {
      return;
    }
    class_addMethod(panel, sel_registerName(c"canBecomeKeyWindow".as_ptr()), yes as *const c_void, c"c@:".as_ptr());
    objc_registerClassPair(panel);
    object_setClass(ns_window, panel);
    let mask = get_usize(ns_window, sel_registerName(c"styleMask".as_ptr()));
    set_usize(ns_window, sel_registerName(c"setStyleMask:".as_ptr()), mask | NONACTIVATING_PANEL);
    set_bool(ns_window, sel_registerName(c"setHidesOnDeactivate:".as_ptr()), 0);
    set_usize(ns_window, sel_registerName(c"setCollectionBehavior:".as_ptr()), CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY);
    set_isize(ns_window, sel_registerName(c"setLevel:".as_ptr()), STATUS_WINDOW_LEVEL);
  }
}

// 플로팅 창의 메뉴에서 부릅니다.
#[tauri::command]
fn show_main<R: Runtime>(app: AppHandle<R>) {
  show_main_window(&app);
}

#[tauri::command]
fn quit_app<R: Runtime>(app: AppHandle<R>) {
  app.exit(0);
}

#[tauri::command]
fn open_in_app<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
  in_scope(&app, &path)?;
  tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_finder<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
  in_scope(&app, &path)?;
  tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

fn safe_relative(path: &str) -> bool {
  !path.is_empty() && Path::new(path).components().all(|part| matches!(part, Component::Normal(_)))
}

// mdls -raw는 값을 NUL로 나눠 찍습니다. 개수가 어긋나면 날짜를 다른 파일에 붙이느니 버립니다.
fn spotlight_values(stdout: &[u8], count: usize) -> Option<Vec<Option<String>>> {
  let text = String::from_utf8_lossy(stdout);
  let values: Vec<&str> = text.split('\0').collect();
  (values.len() == count).then(|| values.iter().map(|value| (*value != "(null)").then(|| value.to_string())).collect())
}

fn mdls(paths: &[&PathBuf]) -> Option<Vec<Option<String>>> {
  let output = Command::new("/usr/bin/mdls").args(["-raw", "-name", "kMDItemLastUsedDate"]).args(paths).output().ok()?;
  if !output.status.success() {
    return None;
  }
  spotlight_values(&output.stdout, paths.len())
}

// 못 읽는 파일(권한 없음·소켓)이 하나만 끼어도 mdls는 묶음 전체를 실패시킵니다. 반씩 나눠 다시 물어 그 파일만 None으로 둡니다.
fn ask_in_halves(paths: &[&PathBuf], ask: &dyn Fn(&[&PathBuf]) -> Option<Vec<Option<String>>>) -> Vec<Option<String>> {
  if let Some(values) = ask(paths) {
    return values;
  }
  if paths.len() < 2 {
    return vec![None; paths.len()];
  }
  let (left, right) = paths.split_at(paths.len() / 2);
  [ask_in_halves(left, ask), ask_in_halves(right, ask)].concat()
}

// 없는 경로가 있으면 mdls가 거기서 멈춰 뒤 결과를 버리므로, 있는 파일만 넘기고 자리를 되찾습니다.
// macOS가 아니면 mdls가 없어 전부 None이 됩니다.
fn read_last_used(paths: &[PathBuf]) -> Vec<Option<String>> {
  let mut dates = vec![None; paths.len()];
  let (at, existing): (Vec<usize>, Vec<&PathBuf>) = paths.iter().enumerate().filter(|(_, path)| path.exists()).unzip();
  if existing.is_empty() || !Path::new("/usr/bin/mdls").exists() {
    return dates;
  }
  for (index, value) in at.into_iter().zip(ask_in_halves(&existing, &mdls)) {
    dates[index] = value;
  }
  dates
}

// 방 폴더 안 파일을 macOS가 마지막으로 연 시각(Spotlight). 경로가 틀리면 거절하고, 시각을 못 읽는 건 오류가 아니라 None입니다.
#[tauri::command]
async fn last_used_dates<R: Runtime>(app: AppHandle<R>, root: PathBuf, paths: Vec<String>) -> Result<Vec<Option<String>>, String> {
  if !root.is_absolute() {
    return Err("안전하지 않은 경로예요.".into());
  }
  let mut full = Vec::with_capacity(paths.len());
  for path in &paths {
    if !safe_relative(path) {
      return Err("안전하지 않은 경로예요.".into());
    }
    let joined = root.join(path);
    in_scope(&app, &joined)?;
    full.push(joined);
  }
  let count = full.len();
  Ok(tauri::async_runtime::spawn_blocking(move || read_last_used(&full)).await.unwrap_or_else(|_| vec![None; count]))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    // 고른 폴더 권한을 앱을 다시 열어도 유지합니다(fs 플러그인 다음에 등록해야 합니다).
    .plugin(tauri_plugin_persisted_scope::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![allow_rooms, show_main, quit_app, set_pet_visible, open_in_app, reveal_in_finder, last_used_dates])
    .setup(|_app| {
      if let Some(pet) = _app.get_webview_window("pet") {
        place_pet_top_right(&pet);
        #[cfg(target_os = "macos")]
        float_everywhere(&pet);
      }
      Ok(())
    })
    // 메인 창을 닫아도 플로팅 창은 남습니다. 완전히 끄는 건 ⌘Q나 플로팅 창 메뉴예요.
    .on_window_event(|window, event| {
      if let (WindowEvent::CloseRequested { api, .. }, "main") = (event, window.label()) {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|_app, _event| {
      // Dock 아이콘을 누르면 숨긴 메인 창을 다시 엽니다.
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { .. } = _event {
        show_main_window(_app);
      }
    });
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::{Value, json};
  use tauri::test::MockRuntime;

  fn invoke(webview: &tauri::WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<(), Value> {
    tauri::test::get_ipc_response(
      webview,
      tauri::webview::InvokeRequest {
        cmd: cmd.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_string(),
      },
    )
    .map(|_| ())
  }

  // 실제 capabilities·fs 플러그인으로: 고른 방 폴더 안에서만 읽고 옮기며, 지우기는 권한 자체가 없습니다.
  #[test]
  fn files_move_only_inside_chosen_rooms() {
    let base = std::env::temp_dir().join(format!("folduct-scope-{}", std::process::id()));
    let (parent, outside) = (base.join("parent"), base.join("outside"));
    let room = parent.join("room");
    std::fs::create_dir_all(room.join("참고")).unwrap();
    std::fs::create_dir_all(parent.join("other")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(room.join("참고/시안.psd"), "원본").unwrap();
    std::fs::write(parent.join("other/a.txt"), "a").unwrap();
    let app = tauri::test::mock_builder()
      .plugin(tauri_plugin_fs::init())
      .invoke_handler(tauri::generate_handler![allow_rooms, open_in_app, reveal_in_finder, last_used_dates])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    // 대화상자에서 recursive: false로 상위 폴더를 고른 상태와 같습니다.
    app.fs_scope().allow_directory(&parent, false).unwrap();
    let file = room.join("참고/시안.psd");
    let boxed = room.join("_Folduct 정리상자/시안.psd");

    assert!(invoke(&webview, "plugin:fs|stat", json!({ "path": file })).is_err());
    assert!(invoke(&webview, "allow_rooms", json!({ "folders": [outside] })).is_err());
    assert!(invoke(&webview, "allow_rooms", json!({ "folders": [room.join("../../outside")] })).is_err());
    invoke(&webview, "allow_rooms", json!({ "folders": [room] })).unwrap();
    invoke(&webview, "plugin:fs|stat", json!({ "path": file })).unwrap();
    invoke(&webview, "plugin:fs|mkdir", json!({ "path": room.join("_Folduct 정리상자") })).unwrap();
    invoke(&webview, "plugin:fs|rename", json!({ "oldPath": file, "newPath": boxed })).unwrap();
    assert_eq!(std::fs::read_to_string(&boxed).unwrap(), "원본");

    assert!(invoke(&webview, "plugin:fs|stat", json!({ "path": parent.join("other/a.txt") })).is_err());
    assert!(invoke(&webview, "plugin:fs|rename", json!({ "oldPath": boxed, "newPath": outside.join("시안.psd") })).is_err());
    assert!(invoke(&webview, "plugin:fs|remove", json!({ "path": boxed })).is_err());
    assert!(invoke(&webview, "plugin:fs|write_text_file", json!({ "path": boxed })).is_err());
    assert!(invoke(&webview, "open_in_app", json!({ "path": outside })).is_err());
    assert!(invoke(&webview, "reveal_in_finder", json!({ "path": room.join("../../outside") })).is_err());
    assert!(invoke(&webview, "last_used_dates", json!({ "root": outside, "paths": ["a.txt"] })).is_err());
    assert!(invoke(&webview, "last_used_dates", json!({ "root": room, "paths": ["../other/a.txt"] })).is_err());
    assert!(invoke(&webview, "last_used_dates", json!({ "root": room, "paths": ["/etc/hosts"] })).is_err());
    assert!(invoke(&webview, "last_used_dates", json!({ "root": room, "paths": [""] })).is_err());
    // 없는 파일이 끼어도 거절하지 않습니다.
    invoke(&webview, "last_used_dates", json!({ "root": room, "paths": ["없음.txt", "_Folduct 정리상자/시안.psd"] })).unwrap();
    assert!(boxed.exists());
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 현관: 고른 두 폴더 사이의 이름 바꾸기만 됩니다. 고르지 않은 곳으로는 옮길 수 없고, 쓰기·지우기 권한도 없어요.
  #[test]
  fn doorstep_moves_only_between_chosen_folders() {
    let base = std::env::temp_dir().join(format!("folduct-door-{}", std::process::id()));
    let (door, room, outside) = (base.join("다운로드"), base.join("room"), base.join("outside"));
    for dir in [&door, &room, &outside] {
      std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(door.join("보고서.pdf"), "원본").unwrap();
    let app = tauri::test::mock_builder()
      .plugin(tauri_plugin_fs::init())
      .invoke_handler(tauri::generate_handler![allow_rooms, open_in_app, reveal_in_finder, last_used_dates])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    // 대화상자에서 recursive: true로 두 폴더를 고른 상태와 같습니다.
    app.fs_scope().allow_directory(&door, true).unwrap();
    app.fs_scope().allow_directory(&room, true).unwrap();
    let (from, to) = (door.join("보고서.pdf"), room.join("보고서.pdf"));

    assert!(invoke(&webview, "plugin:fs|rename", json!({ "oldPath": from, "newPath": outside.join("보고서.pdf") })).is_err());
    invoke(&webview, "plugin:fs|rename", json!({ "oldPath": from, "newPath": to })).unwrap();
    assert_eq!(std::fs::read_to_string(&to).unwrap(), "원본");
    invoke(&webview, "plugin:fs|rename", json!({ "oldPath": to, "newPath": from })).unwrap();
    assert_eq!(std::fs::read_to_string(&from).unwrap(), "원본");
    assert!(invoke(&webview, "plugin:fs|remove", json!({ "path": from })).is_err());
    assert!(invoke(&webview, "plugin:fs|write_text_file", json!({ "path": from })).is_err());
    assert!(from.exists());
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 플로팅 창도 고른 폴더 안에서만 옮기고, 지우거나 고쳐 쓰지 못합니다.
  #[test]
  fn pet_moves_but_never_deletes() {
    let base = std::env::temp_dir().join(format!("folduct-pet-{}", std::process::id()));
    let (door, room, outside) = (base.join("door"), base.join("room"), base.join("outside"));
    for folder in [&door, &room, &outside] {
      std::fs::create_dir_all(folder).unwrap();
    }
    std::fs::write(door.join("보고서.pdf"), "원본").unwrap();
    let app = tauri::test::mock_builder()
      .plugin(tauri_plugin_fs::init())
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "pet", Default::default()).build().unwrap();
    app.fs_scope().allow_directory(&door, true).unwrap();
    app.fs_scope().allow_directory(&room, true).unwrap();
    let (from, to) = (door.join("보고서.pdf"), room.join("보고서.pdf"));

    assert!(invoke(&webview, "plugin:fs|rename", json!({ "oldPath": from, "newPath": outside.join("보고서.pdf") })).is_err());
    invoke(&webview, "plugin:fs|rename", json!({ "oldPath": from, "newPath": to })).unwrap();
    assert_eq!(std::fs::read_to_string(&to).unwrap(), "원본");
    assert!(invoke(&webview, "plugin:fs|remove", json!({ "path": to })).is_err());
    assert!(invoke(&webview, "plugin:fs|write_text_file", json!({ "path": to })).is_err());
    assert!(to.exists());
    std::fs::remove_dir_all(&base).unwrap();
  }

  #[test]
  fn last_used_keeps_each_date_with_its_file() {
    let base = std::env::temp_dir().join(format!("folduct-used-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let (a, gone, b) = (base.join("a.txt"), base.join("없음.txt"), base.join("b.txt"));
    std::fs::write(&a, "a").unwrap();
    std::fs::write(&b, "b").unwrap();
    let dates = read_last_used(&[a.clone(), gone, b.clone()]);
    assert_eq!(dates.len(), 3);
    assert_eq!(dates[1], None);
    std::fs::remove_dir_all(&base).unwrap();

    assert_eq!(spotlight_values(b"2026-11-01 15:40:41 +0000\0(null)", 2), Some(vec![Some("2026-11-01 15:40:41 +0000".into()), None]));
    assert_eq!(spotlight_values(b"2026-11-01 15:40:41 +0000", 2), None);
  }

  #[test]
  fn one_unreadable_file_loses_only_its_own_date() {
    let paths: Vec<PathBuf> = (0..5).map(|i| PathBuf::from(format!("{i}"))).collect();
    let refs: Vec<&PathBuf> = paths.iter().collect();
    // 진짜 mdls처럼 '2'가 끼면 묶음 전체가 실패합니다.
    let fake = |chunk: &[&PathBuf]| -> Option<Vec<Option<String>>> {
      (!chunk.iter().any(|path| path.as_path() == Path::new("2"))).then(|| chunk.iter().map(|path| Some(path.display().to_string())).collect())
    };
    assert_eq!(ask_in_halves(&refs, &fake), vec![Some("0".to_string()), Some("1".to_string()), None, Some("3".to_string()), Some("4".to_string())]);
  }

  // 진짜 mdls로: 읽기 권한 없는 파일이 끼어도 자리가 어긋나지 않습니다. mdls가 없는 OS에서는 전부 None입니다.
  #[cfg(unix)]
  #[test]
  fn unreadable_file_keeps_other_dates_in_place() {
    let base = std::env::temp_dir().join(format!("folduct-noperm-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let (a, locked, b) = (base.join("a.txt"), base.join("locked.txt"), base.join("b.txt"));
    for file in [&a, &locked, &b] {
      std::fs::write(file, "x").unwrap();
    }
    std::fs::set_permissions(&locked, std::os::unix::fs::PermissionsExt::from_mode(0o000)).unwrap();
    let dates = read_last_used(&[a, locked, b]);
    assert_eq!(dates.len(), 3);
    assert_eq!(dates[1], None);
    std::fs::remove_dir_all(&base).unwrap();
  }
}
