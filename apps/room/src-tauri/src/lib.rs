use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, WindowEvent};
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

// 메뉴 막대 아이콘. 숨긴 플로팅 창(프로도)은 이 아이콘으로 들어가고, 아이콘을 누르면 아래로 다시 나와요.
const TRAY: &str = "folduct";
const PET_GAP: f64 = 6.0;
const GLIDE_STEPS: u32 = 20;
const GLIDE_FRAME: Duration = Duration::from_millis(16);

// tucked: 프로도가 아이콘으로 들어가 있어 나올 때 아이콘 아래에 세워야 하는지. turn: 보이기·숨기기를 부를 때마다 늘어, 늦게 끝난 미끄러짐을 멈춰요.
struct PetTray<R: Runtime> {
  toggle: MenuItem<R>,
  tucked: AtomicBool,
  turn: AtomicU32,
}

// 창 자리를 셈하는 단위. macOS는 전역 포인트예요. 디스플레이마다 배율이 달라 물리 픽셀로는 화면들이 하나로 이어지지 않아요.
// Windows·Linux는 전역 물리 픽셀을 그대로 씁니다.
const POINTS: bool = cfg!(target_os = "macos");

// 메뉴 막대 아이콘이 놓인 창의 배율. 아이콘 자리는 이 배율을 곱한 물리 픽셀로 와요.
#[cfg(target_os = "macos")]
fn tray_scale<R: Runtime>(app: &AppHandle<R>) -> Option<f64> {
  use std::ffi::{c_char, c_void};
  #[link(name = "objc")]
  unsafe extern "C" {
    fn sel_registerName(name: *const c_char) -> *const c_void;
    fn objc_msgSend();
  }
  app.tray_by_id(TRAY)?
    .with_inner_tray_icon(|inner| {
      let item = inner.ns_status_item()?;
      unsafe {
        let send_id: extern "C" fn(*const c_void, *const c_void) -> *const c_void = std::mem::transmute(objc_msgSend as *const ());
        let send_f64: extern "C" fn(*const c_void, *const c_void) -> f64 = std::mem::transmute(objc_msgSend as *const ());
        let button = send_id((&*item as *const _) as *const c_void, sel_registerName(c"button".as_ptr()));
        let window = if button.is_null() { button } else { send_id(button, sel_registerName(c"window".as_ptr())) };
        if window.is_null() {
          return None;
        }
        let scale = send_f64(window, sel_registerName(c"backingScaleFactor".as_ptr()));
        (scale > 0.0).then_some(scale)
      }
    })
    .ok()
    .flatten()
}

#[cfg(not(target_os = "macos"))]
fn tray_scale<R: Runtime>(_: &AppHandle<R>) -> Option<f64> {
  Some(1.0)
}

// 메뉴 막대 아이콘의 화면 자리(x, y, 너비, 높이)를 셈 단위로. 아이콘이 없거나 자리를 모르는 곳(Linux)에서는 None이에요.
fn tray_rect<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64, f64, f64)> {
  let rect = app.tray_by_id(TRAY)?.rect().ok()??;
  let unit = tray_scale(app)?;
  let at = rect.position.to_physical::<f64>(unit);
  let size = rect.size.to_physical::<f64>(unit);
  let unit = if POINTS { unit } else { 1.0 };
  (size.width > 0.0).then_some((at.x / unit, at.y / unit, size.width / unit, size.height / unit))
}

// 아이콘이 있는 화면의 자리를 셈 단위로. 못 찾으면 주 화면이에요.
fn screen_by_icon<R: Runtime>(pet: &WebviewWindow<R>, icon: (f64, f64, f64, f64)) -> (f64, f64, f64, f64) {
  let (cx, cy) = (icon.0 + icon.2 / 2.0, icon.1 + icon.3 / 2.0);
  let bounds = |m: &tauri::Monitor| {
    let unit = if POINTS { m.scale_factor() } else { 1.0 };
    (m.position().x as f64 / unit, m.position().y as f64 / unit, m.size().width as f64 / unit, m.size().height as f64 / unit)
  };
  let monitors = pet.available_monitors().unwrap_or_default();
  monitors
    .iter()
    .map(bounds)
    .find(|&(x, y, w, h)| cx >= x && cx < x + w && cy >= y && cy < y + h)
    .or_else(|| pet.primary_monitor().ok().flatten().map(|m| bounds(&m)))
    .unwrap_or((0.0, 0.0, f64::MAX, f64::MAX))
}

// 플로팅 창의 자리·크기를 셈 단위로 읽고 옮깁니다.
fn pet_unit<R: Runtime>(pet: &WebviewWindow<R>) -> f64 {
  if POINTS { pet.scale_factor().unwrap_or(1.0) } else { 1.0 }
}

fn pet_at<R: Runtime>(pet: &WebviewWindow<R>) -> Option<(f64, f64)> {
  let at = pet.outer_position().ok()?;
  let unit = pet_unit(pet);
  Some((at.x as f64 / unit, at.y as f64 / unit))
}

fn put_pet<R: Runtime>(pet: &WebviewWindow<R>, (x, y): (f64, f64)) {
  let _ = if POINTS { pet.set_position(tauri::LogicalPosition::new(x, y)) } else { pet.set_position(tauri::PhysicalPosition::new(x, y)) };
}

// 아이콘 아래 가운데에 세웁니다. 아이콘이 화면 아래쪽에 있으면(Windows 작업 표시줄) 위에 세워요. 화면 밖으로는 나가지 않아요.
fn spot_by_icon(icon: (f64, f64, f64, f64), pet: (f64, f64), screen: (f64, f64, f64, f64), gap: f64) -> (f64, f64) {
  let ((ix, iy, iw, ih), (pw, ph), (sx, sy, sw, sh)) = (icon, pet, screen);
  let x = (ix + iw / 2.0 - pw / 2.0).clamp(sx, (sx + sw - pw).max(sx));
  let y = if iy + ih / 2.0 < sy + sh / 2.0 { iy + ih + gap } else { iy - ph - gap };
  (x, y.clamp(sy, (sy + sh - ph).max(sy)))
}

// 창을 조금씩 옮깁니다. 그사이 다시 보이기·숨기기를 누르면 멈추고, 숨기러 간 길이었으면 끝에서 창을 감춰요.
// 출발점은 받아서 씁니다. 방금 옮기라고 한 자리가 아직 창에 반영되지 않았을 수 있어요.
fn glide<R: Runtime>(pet: WebviewWindow<R>, from: (f64, f64), to: (f64, f64), hide_after: bool) {
  let turn = pet.state::<PetTray<R>>().turn.load(Ordering::SeqCst);
  std::thread::spawn(move || {
    let still = || pet.state::<PetTray<R>>().turn.load(Ordering::SeqCst) == turn;
    for step in 1..=GLIDE_STEPS {
      if !still() {
        return;
      }
      let t = step as f64 / GLIDE_STEPS as f64;
      let eased = if hide_after { t * t } else { 1.0 - (1.0 - t) * (1.0 - t) };
      put_pet(&pet, (from.0 + (to.0 - from.0) * eased, from.1 + (to.1 - from.1) * eased));
      std::thread::sleep(GLIDE_FRAME);
    }
    if hide_after && still() {
      let _ = pet.hide();
    }
  });
}

// 로고(design/logo/folduct-symbol.svg)를 36px로 그린 RGBA 날 픽셀이에요. 흰 판이 있어 어두운·밝은 메뉴 막대 모두에서 보여요.
// PNG를 풀려면 image 크레이트가 더 들어와서 날 픽셀로 둡니다. 로고를 바꾸면 이 파일도 다시 내보내요.
const TRAY_LOGO: &[u8] = include_bytes!("../icons/tray-logo.rgba");

// 메뉴 글자를 지금 상태에 맞춥니다.
fn mark_tray<R: Runtime>(app: &AppHandle<R>, out: bool) {
  if let Some(tray) = app.try_state::<PetTray<R>>() {
    let _ = tray.toggle.set_text(if out { "플로팅 창 숨기기" } else { "플로팅 창 보이기" });
  }
}

// 아이콘을 누르면 작은 창에 맡깁니다. 띄워 둔 플로팅 창이면 아이콘으로 들어가고, 아니면 아이콘 아래 작은 창이 열리거나 닫혀요.
// 메뉴의 "플로팅 창 보이기·숨기기"는 띄워 두기 자체를 켜고 끕니다. 설정 저장과 애니메이션은 그 창이 해요.
fn ask_pet_toggle<R: Runtime>(app: &AppHandle<R>, event: &str) {
  if let Some(pet) = app.get_webview_window("pet") {
    let _ = app.emit_to("pet", event, !pet.is_visible().unwrap_or(false));
  }
}

// 기다리는 새 파일이 있으면 아이콘 오른쪽 위에 잉크 점을 찍어요. 작은 창을 닫아 둬도 메뉴 막대만 보고 알 수 있어요.
// 작업 중이면 얼굴의 검은 구멍을 작업하는 방의 얼굴색(--face-*)으로 칠해요. 홈에서 방을 먹였을 때 얼굴색과 같아요. 흰 테와 흰 눈은 그대로예요.
fn tray_logo(dot: bool, working: Option<[u8; 3]>) -> Vec<u8> {
  let mut px = TRAY_LOGO.to_vec();
  if let Some(color) = working {
    tint_hole(&mut px, color);
  }
  if dot {
    let (cx, cy, r, ring) = (28.5_f64, 7.5_f64, 5.0_f64, 7.0_f64);
    for y in 0..36 {
      for x in 0..36 {
        let d = ((x as f64 + 0.5 - cx).powi(2) + (y as f64 + 0.5 - cy).powi(2)).sqrt();
        let at = (y * 36 + x) * 4;
        if d <= r {
          px[at..at + 4].copy_from_slice(&[23, 23, 23, 255]);
        } else if d <= ring {
          px[at..at + 4].copy_from_slice(&[255, 255, 255, 255]);
        }
      }
    }
  }
  px
}

// 검은 구멍: 구멍 위쪽 가운데 한 점(18, 12)에서 이어진 어두운 픽셀을 방 색으로 바꿔요. 가장자리의 덜 어두운 픽셀은 흰색 쪽으로 섞어 매끄럽게 둬요.
// 흰 테가 바깥 검은 선과 구멍을 갈라 놓아서 바깥 선은 칠해지지 않아요. 흰 눈도 밝아서 그대로예요.
fn tint_hole(px: &mut [u8], color: [u8; 3]) {
  let dark = |px: &[u8], at: usize| px[at * 4] < 128 && px[at * 4 + 3] >= 60;
  let seed = 12 * 36 + 18;
  if !dark(px, seed) {
    return;
  }
  let mut seen = vec![false; 36 * 36];
  let mut stack = vec![seed];
  seen[seed] = true;
  while let Some(at) = stack.pop() {
    let light = (px[at * 4].saturating_sub(23)) as u32;
    for c in 0..3 {
      px[at * 4 + c] = (color[c] as u32 + (255 - color[c] as u32) * light / 232) as u8;
    }
    let (x, y) = (at % 36, at / 36);
    let near = [(x > 0).then(|| at - 1), (x < 35).then(|| at + 1), (y > 0).then(|| at - 36), (y < 35).then(|| at + 36)];
    for next in near.into_iter().flatten() {
      if !seen[next] && dark(px, next) {
        seen[next] = true;
        stack.push(next);
      }
    }
  }
}

// 점과 작업 중 방 색은 따로 바뀌어서, 둘 다 기억해 두고 아이콘을 다시 그려요.
static TRAY_DOT: AtomicBool = AtomicBool::new(false);
static TRAY_WORKING: std::sync::Mutex<Option<[u8; 3]>> = std::sync::Mutex::new(None);

fn redraw_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
  let Some(tray) = app.tray_by_id(TRAY) else { return Ok(()) };
  let working = *TRAY_WORKING.lock().map_err(|e| e.to_string())?;
  tray.set_icon(Some(Image::new_owned(tray_logo(TRAY_DOT.load(Ordering::SeqCst), working), 36, 36))).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tray_dot<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
  TRAY_DOT.store(on, Ordering::SeqCst);
  redraw_tray(&app)
}

// color: 작업하는 방의 얼굴색 "#rrggbb". 작업하지 않으면 null이라 원래 얼굴로 돌아가요.
#[tauri::command]
fn set_tray_working<R: Runtime>(app: AppHandle<R>, color: Option<String>) -> Result<(), String> {
  *TRAY_WORKING.lock().map_err(|e| e.to_string())? = color.as_deref().and_then(hex_rgb);
  redraw_tray(&app)
}

fn hex_rgb(text: &str) -> Option<[u8; 3]> {
  let hex = text.trim().strip_prefix('#')?;
  if hex.len() != 6 {
    return None;
  }
  let byte = |at: usize| u8::from_str_radix(hex.get(at..at + 2)?, 16).ok();
  Some([byte(0)?, byte(2)?, byte(4)?])
}

// 아이콘 아래에 작은 창을 열고 닫아요. 연 창은 바로 입력을 받아, 다른 곳을 누르면 닫힐 수 있어요(blur).
// 메인 창 포커스를 되돌리지 않고, 띄워 두기 설정·메뉴 글자도 바꾸지 않아요.
#[tauri::command]
fn set_panel_visible<R: Runtime>(app: AppHandle<R>, visible: bool) -> Result<(), String> {
  let pet = app.get_webview_window("pet").ok_or("작은 창이 없어요.")?;
  if let Some(tray) = app.try_state::<PetTray<R>>() {
    tray.turn.fetch_add(1, Ordering::SeqCst);
    tray.tucked.store(false, Ordering::SeqCst);
  }
  if !visible {
    return pet.hide().map_err(|e| e.to_string());
  }
  if let Some(icon) = tray_rect(&app) {
    let size = pet.outer_size().map_err(|e| e.to_string())?;
    let unit = pet_unit(&pet);
    let gap = PET_GAP * if POINTS { 1.0 } else { pet.scale_factor().unwrap_or(1.0) };
    put_pet(&pet, spot_by_icon(icon, (size.width as f64 / unit, size.height as f64 / unit), screen_by_icon(&pet, icon), gap));
  }
  pet.show().map_err(|e| e.to_string())?;
  key_without_activate(&pet);
  Ok(())
}

// 작은 창만 입력을 받게 하고 Folduct 전체를 앞으로 데려오지는 않아요(set_focus는 앱을 활성화해 쓰던 앱의 포커스를 뺏어요).
// 창은 canBecomeKey가 YES인 비활성 패널이라(float_everywhere) 키 창이 되고, 다른 곳을 누르면 blur가 와요.
#[cfg(target_os = "macos")]
fn key_without_activate<R: Runtime>(pet: &WebviewWindow<R>) {
  let window = pet.clone();
  let _ = pet.run_on_main_thread(move || {
    use std::ffi::{c_char, c_void};
    #[link(name = "objc")]
    unsafe extern "C" {
      fn sel_registerName(name: *const c_char) -> *const c_void;
      fn objc_msgSend();
    }
    if let Ok(ns_window) = window.ns_window() {
      unsafe {
        let send: extern "C" fn(*mut c_void, *const c_void, *mut c_void) = std::mem::transmute(objc_msgSend as *const ());
        send(ns_window, sel_registerName(c"makeKeyAndOrderFront:".as_ptr()), std::ptr::null_mut());
      }
    }
  });
}

#[cfg(not(target_os = "macos"))]
fn key_without_activate<R: Runtime>(pet: &WebviewWindow<R>) {
  let _ = pet.set_focus();
}

// macOS는 새 메뉴 막대 아이콘을 맨 왼쪽에 놓아서, 막대가 가득 찬 노치 맥에서는 노치 뒤에 숨어요.
// 처음 한 번만 시계 쪽(오른쪽 끝에서 260pt)을 앱 자기 설정에 적어 둬요. 사용자가 ⌘로 끌어 옮긴 자리는 건드리지 않아요.
#[cfg(target_os = "macos")]
fn keep_tray_off_notch() {
  use std::ffi::c_void;
  type Cf = *const c_void;
  #[link(name = "CoreFoundation", kind = "framework")]
  unsafe extern "C" {
    static kCFPreferencesCurrentApplication: Cf;
    fn CFStringCreateWithCString(alloc: Cf, text: *const std::ffi::c_char, encoding: u32) -> Cf;
    fn CFNumberCreate(alloc: Cf, kind: isize, value: *const c_void) -> Cf;
    fn CFPreferencesCopyAppValue(key: Cf, app: Cf) -> Cf;
    fn CFPreferencesSetAppValue(key: Cf, value: Cf, app: Cf);
    fn CFPreferencesAppSynchronize(app: Cf) -> u8;
    fn CFRelease(object: Cf);
  }
  const UTF8: u32 = 0x0800_0100;
  const DOUBLE: isize = 13;
  unsafe {
    let key = CFStringCreateWithCString(std::ptr::null(), c"NSStatusItem Preferred Position Item-0".as_ptr(), UTF8);
    if key.is_null() {
      return;
    }
    let saved = CFPreferencesCopyAppValue(key, kCFPreferencesCurrentApplication);
    if saved.is_null() {
      let from_right: f64 = 260.0;
      let value = CFNumberCreate(std::ptr::null(), DOUBLE, &from_right as *const f64 as *const c_void);
      if !value.is_null() {
        CFPreferencesSetAppValue(key, value, kCFPreferencesCurrentApplication);
        CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication);
        CFRelease(value);
      }
    } else {
      CFRelease(saved);
    }
    CFRelease(key);
  }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let toggle = MenuItem::with_id(app, "pet", "플로팅 창 보이기", true, None::<&str>)?;
  let open = MenuItem::with_id(app, "main", "Folduct 열기", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "끝내기", true, None::<&str>)?;
  // Linux(AppIndicator)는 아이콘을 눌러도 메뉴만 열려요. 작은 창을 여는 줄을 메뉴에 둬요.
  #[cfg(target_os = "linux")]
  let menu = Menu::with_items(app, &[&MenuItem::with_id(app, "panel", "작은 창 열기", true, None::<&str>)?, &toggle, &open, &PredefinedMenuItem::separator(app)?, &quit])?;
  #[cfg(not(target_os = "linux"))]
  let menu = Menu::with_items(app, &[&toggle, &open, &PredefinedMenuItem::separator(app)?, &quit])?;
  TrayIconBuilder::with_id(TRAY)
    .icon(Image::new_owned(tray_logo(false, None), 36, 36))
    .tooltip("Folduct")
    .menu(&menu)
    // 누르면 아이콘 아래 작은 창이 열리고(띄워 둔 플로팅 창이면 아이콘으로 들어가고), 메뉴는 오른쪽 클릭으로 열어요.
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "pet" => ask_pet_toggle(app, "tray-float"),
      "panel" => ask_pet_toggle(app, "tray-pet"),
      "main" => show_main_window(app),
      "quit" => ask_quit(app),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
        ask_pet_toggle(tray.app_handle(), "tray-pet");
      }
    })
    .build(app)?;
  app.manage(PetTray { toggle, tucked: AtomicBool::new(false), turn: AtomicU32::new(0) });
  Ok(())
}

// 숨김 설정을 읽은 뒤에 띄우려고 처음에는 숨겨 둡니다. 띄워도 사용자가 쓰던 메인 창의 포커스는 뺏지 않아요.
// 메뉴 막대 아이콘이 있으면 숨길 때 그 아이콘으로 미끄러져 들어가고, 다시 띄울 때 아이콘 아래로 내려와요.
#[tauri::command]
fn set_pet_visible<R: Runtime>(app: AppHandle<R>, visible: bool, from_icon: Option<bool>) -> Result<(), String> {
  let pet = app.get_webview_window("pet").ok_or("플로팅 창이 없어요.")?;
  let tray = app.try_state::<PetTray<R>>();
  if let Some(tray) = &tray {
    tray.turn.fetch_add(1, Ordering::SeqCst);
  }
  mark_tray(&app, visible);
  let icon = tray_rect(&app);
  let size = pet.outer_size().map_err(|e| e.to_string())?;
  let unit = pet_unit(&pet);
  let (pw, ph) = (size.width as f64 / unit, size.height as f64 / unit);
  if !visible {
    if let (Some(tray), Some((ix, iy, iw, ih)), Some(from), true) = (&tray, icon, pet_at(&pet), pet.is_visible().unwrap_or(false)) {
      tray.tucked.store(true, Ordering::SeqCst);
      let _ = app.emit_to("pet", "pet-motion", "tuck");
      glide(pet, from, (ix + iw / 2.0 - pw / 2.0, iy + ih / 2.0), true);
      return Ok(());
    }
    return pet.hide().map_err(|e| e.to_string());
  }
  let main = app.get_webview_window("main").filter(|window| window.is_focused().unwrap_or(false));
  // 아이콘에서 나오는 때: 아이콘으로 들어가 있었거나, 아이콘을 눌러 불렀을 때(숨긴 채 켠 뒤 처음 부를 때도요).
  let tucked = tray.as_ref().is_some_and(|tray| tray.tucked.swap(false, Ordering::SeqCst));
  match icon.filter(|_| tucked || from_icon == Some(true)) {
    Some(icon) => {
      let to = spot_by_icon(icon, (pw, ph), screen_by_icon(&pet, icon), PET_GAP * if POINTS { 1.0 } else { pet.scale_factor().unwrap_or(1.0) });
      let from = (to.0, icon.1 + icon.3 / 2.0);
      put_pet(&pet, from);
      let _ = app.emit_to("pet", "pet-motion", "untuck");
      pet.show().map_err(|e| e.to_string())?;
      glide(pet, from, to, false);
    }
    None => pet.show().map_err(|e| e.to_string())?,
  }
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
  ask_quit(&app);
}

// 작업 중(시간을 재는 중)이면 끄기 전에 한 번 물어요(2026-11-17 요청). 끄면 시간 재기가 멈추고, 다시 켜면 멈춤 상태로 이어져요.
// 작은 창의 'Folduct 끄기', 메뉴 막대 메뉴의 '끝내기', ⌘Q 모두 여기로 와요. 멈춤이거나 작업 전이면 묻지 않고 꺼요.
// 묻는 창은 OS 알림 창이 아니라 메인 창의 Folduct 모달(QuitConfirm)이에요. 고른 답은 quit_answer로 돌아와요.
static QUIT_OK: AtomicBool = AtomicBool::new(false);

// macOS의 ⌘Q·앱 메뉴 'Quit'은 ExitRequested를 거치지 않고 바로 꺼져서 막을 수 없었어요.
// 그래서 기본 메뉴의 Quit 항목을 같은 이름·같은 단축키(⌘Q)의 우리 항목으로 바꿔 ask_quit으로 보내요.
#[cfg(target_os = "macos")]
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
  let menu = Menu::default(app)?;
  if let Some(tauri::menu::MenuItemKind::Submenu(first)) = menu.items()?.into_iter().next() {
    for item in first.items()? {
      if let tauri::menu::MenuItemKind::Predefined(predefined) = &item {
        if predefined.text().unwrap_or_default().starts_with("Quit") {
          first.remove(predefined)?;
        }
      }
    }
    first.append(&MenuItem::with_id(app, "app-quit", format!("Quit {}", app.package_info().name), true, Some("CmdOrCtrl+Q"))?)?;
  }
  Ok(menu)
}

fn ask_quit<R: Runtime>(app: &AppHandle<R>) {
  let working = TRAY_WORKING.lock().map(|color| color.is_some()).unwrap_or(false);
  if !working || QUIT_OK.load(Ordering::SeqCst) {
    QUIT_OK.store(true, Ordering::SeqCst);
    app.exit(0);
    return;
  }
  // 메인 창을 앞으로 데려와 모달을 띄워요. 이미 떠 있으면 그대로예요.
  show_main_window(app);
  let _ = app.emit_to("main", "quit-asked", ());
}

// 모달에서 고른 답. 끄기면 이번에는 묻지 않고 꺼요.
#[tauri::command]
fn quit_answer<R: Runtime>(app: AppHandle<R>, quit: bool) {
  if quit {
    QUIT_OK.store(true, Ordering::SeqCst);
    app.exit(0);
  }
}

#[tauri::command]
fn open_in_app<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<(), String> {
  in_scope(&app, &path)?;
  tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

// 사용자가 확인한 방 폴더 안 파일 하나를 OS 휴지통으로 보냅니다. 영구 삭제는 하지 않아 휴지통에서 되살릴 수 있어요.
// 폴더·바로가기·점으로 시작하는 파일은 보내지 않아요. macOS는 휴지통 안 자리를 돌려줘 앱에서 되돌릴 수 있어요(다른 OS는 None).
#[tauri::command]
fn trash_file<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<Option<String>, String> {
  in_scope(&app, &path)?;
  if !std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?.file_type().is_file() {
    return Err("파일이 아니에요.".into());
  }
  if path.file_name().and_then(|name| name.to_str()).map_or(true, |name| name.starts_with('.')) {
    return Err("숨김 파일은 보낼 수 없어요.".into());
  }
  #[cfg(target_os = "macos")]
  return trash_with_place(&path).map(|place| Some(place.to_string_lossy().into_owned()));
  #[cfg(not(target_os = "macos"))]
  trash::delete(&path).map(|_| None).map_err(|e| e.to_string())
}

// NSFileManager trashItemAtURL:resultingItemURL:error: 로 휴지통에 넣고 들어간 자리를 받아요(Finder의 '되돌려 놓기'와 같은 휴지통).
#[cfg(target_os = "macos")]
fn trash_with_place(path: &Path) -> Result<PathBuf, String> {
  use std::ffi::{CStr, CString, c_char, c_void};
  use std::os::unix::ffi::OsStrExt;
  type Id = *mut c_void;
  #[link(name = "Foundation", kind = "framework")]
  unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> *const c_void;
    fn objc_msgSend();
    fn objc_autoreleasePoolPush() -> *mut c_void;
    fn objc_autoreleasePoolPop(pool: *mut c_void);
  }
  let c_path = CString::new(path.as_os_str().as_bytes()).map_err(|_| "경로가 올바르지 않아요.".to_string())?;
  unsafe {
    let send0: unsafe extern "C" fn(Id, Id) -> Id = std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    let send1: unsafe extern "C" fn(Id, Id, *const c_void) -> Id = std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    let send_trash: unsafe extern "C" fn(Id, Id, Id, *mut Id, *mut Id) -> i8 = std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    let sel = |name: &CStr| sel_registerName(name.as_ptr()) as Id;
    let class = |name: &CStr| objc_getClass(name.as_ptr());
    let text = |object: Id| -> String {
      let utf8 = send0(object, sel(c"UTF8String")) as *const c_char;
      if utf8.is_null() { String::new() } else { CStr::from_ptr(utf8).to_string_lossy().into_owned() }
    };
    let pool = objc_autoreleasePoolPush();
    let ns_path = send1(class(c"NSString"), sel(c"stringWithUTF8String:"), c_path.as_ptr() as *const c_void);
    let url = send1(class(c"NSURL"), sel(c"fileURLWithPath:"), ns_path);
    let manager = send0(class(c"NSFileManager"), sel(c"defaultManager"));
    let (mut placed, mut error): (Id, Id) = (std::ptr::null_mut(), std::ptr::null_mut());
    let ok = send_trash(manager, sel(c"trashItemAtURL:resultingItemURL:error:"), url, &mut placed, &mut error) != 0;
    let result = if ok && !placed.is_null() {
      Ok(PathBuf::from(text(send0(placed, sel(c"path")))))
    } else if !error.is_null() {
      Err(text(send0(error, sel(c"localizedDescription"))))
    } else {
      Err("휴지통으로 보내지 못했어요.".to_string())
    };
    objc_autoreleasePoolPop(pool);
    result
  }
}

// 방금 휴지통으로 보낸 파일을 원래 자리로 되돌려요. from은 휴지통(.Trash·.Trashes) 안의 보통 파일이어야 하고, to는 방 폴더 안이어야 해요.
// 원래 자리에 같은 이름이 생겼으면 덮어쓰지 않고 거절해요.
#[tauri::command]
fn restore_trashed<R: Runtime>(app: AppHandle<R>, from: PathBuf, to: PathBuf) -> Result<(), String> {
  in_scope(&app, &to)?;
  let in_trash = from.is_absolute()
    && from.components().all(|part| !matches!(part, Component::ParentDir | Component::CurDir))
    && from.components().any(|part| matches!(part, Component::Normal(name) if name == ".Trash" || name == ".Trashes"));
  if !in_trash {
    return Err("휴지통 안 파일이 아니에요.".into());
  }
  if !std::fs::symlink_metadata(&from).map_err(|e| e.to_string())?.file_type().is_file() {
    return Err("파일이 아니에요.".into());
  }
  rename_no_replace(&from, &to).map_err(|e| e.to_string())
}

// 고른 폴더 안 파일 하나를 이름 바꾸기로 옮깁니다. 대상 자리에 무엇이 있으면 OS가 거절하므로, 확인한 뒤 다른 앱이 만든 파일도 덮어쓰지 않습니다.
#[tauri::command]
fn move_file<R: Runtime>(app: AppHandle<R>, from: PathBuf, to: PathBuf) -> Result<(), String> {
  in_scope(&app, &from)?;
  in_scope(&app, &to)?;
  if !from.is_file() {
    return Err("파일이 아니에요.".into());
  }
  rename_no_replace(&from, &to).map_err(|e| e.to_string())
}

// 스크린샷 저장 폴더(2026-11-19 요청). macOS 설정(com.apple.screencapture location)을 읽고, 없으면 데스크톱이에요. 다른 OS는 다루지 않아요.
fn screenshot_folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
  if !cfg!(target_os = "macos") {
    return None;
  }
  let set = Command::new("/usr/bin/defaults").args(["read", "com.apple.screencapture", "location"]).output().ok().filter(|out| out.status.success()).map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string()).filter(|text| !text.is_empty());
  let home = app.path().home_dir().ok();
  let path = match (set, home) {
    (Some(text), Some(home)) if text == "~" || text.starts_with("~/") => home.join(text.trim_start_matches('~').trim_start_matches('/')),
    (Some(text), _) => PathBuf::from(text),
    (None, _) => app.path().desktop_dir().ok()?,
  };
  path.is_dir().then_some(path)
}

#[tauri::command]
fn screenshot_dir<R: Runtime>(app: AppHandle<R>) -> Option<PathBuf> {
  screenshot_folder(&app)
}

fn is_day(day: &str) -> bool {
  day.len() == 10 && day.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() })
}

// 방 폴더 안 '스크린샷/day' 폴더를 만들어요(있으면 그대로). 바로가기는 따라가지 않고, 방 폴더 밖은 거절해요. 지우거나 덮어쓰지 않아요.
#[tauri::command]
fn make_shot_folder<R: Runtime>(app: AppHandle<R>, room: PathBuf, day: String) -> Result<PathBuf, String> {
  if !is_day(&day) {
    return Err("날짜 모양이 아니에요.".into());
  }
  in_scope(&app, &room)?;
  if !std::fs::symlink_metadata(&room).map(|meta| meta.is_dir()).unwrap_or(false) {
    return Err("폴더가 아니에요.".into());
  }
  let mut folder = room;
  for part in ["스크린샷", day.as_str()] {
    folder = folder.join(part);
    in_scope(&app, &folder)?;
    match std::fs::symlink_metadata(&folder) {
      Ok(meta) if meta.is_dir() => {}
      Ok(_) => return Err("같은 이름의 파일이 있어요.".into()),
      Err(_) => std::fs::create_dir(&folder).map_err(|e| e.to_string())?,
    }
  }
  Ok(folder)
}

// 방 만들기 목록에 띄울 폴더(2026-11-18 요청). 이름·경로·고친 시각만 읽고 안의 파일은 열지 않아요.
struct FoundFolder {
  path: PathBuf,
  name: String,
  modified: Option<f64>,
}

// 홈 폴더 아래 보통 폴더만 방 후보예요. 홈 자체·숨김 폴더 안·~/Library·앱 묶음(.app)·개발 도구가 만든 폴더·바로가기는 빼요.
fn room_candidate(home: &Path, path: &Path) -> bool {
  let Ok(rest) = path.strip_prefix(home) else { return false };
  let parts: Vec<&str> = rest.components().filter_map(|part| match part { Component::Normal(name) => name.to_str(), _ => None }).collect();
  if parts.is_empty() || parts.len() != rest.components().count() || parts[0] == "Library" {
    return false;
  }
  const MACHINE: [&str; 6] = ["node_modules", "target", "__pycache__", "Pods", "DerivedData", "venv"];
  if parts.iter().any(|name| name.starts_with('.') || name.ends_with(".app") || name.ends_with(".photoslibrary") || MACHINE.contains(name)) {
    return false;
  }
  std::fs::symlink_metadata(path).map(|meta| meta.is_dir()).unwrap_or(false)
}

fn found(path: PathBuf) -> FoundFolder {
  let modified = std::fs::metadata(&path).and_then(|meta| meta.modified()).ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|age| age.as_millis() as f64);
  let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
  FoundFolder { path, name, modified }
}

// 검색어가 없으면 자주 쓰는 자리(데스크톱·문서·다운로드·개발 폴더) 바로 아래 폴더를 최근에 고친 순으로,
// 있으면 Spotlight(mdfind)로 이름에 그 글자가 든 폴더를 찾아요. 이름이 검색어로 시작하는 폴더를 먼저 보여요.
#[tauri::command]
async fn find_folders<R: Runtime>(app: AppHandle<R>, query: String) -> Result<Vec<(PathBuf, String, Option<f64>)>, String> {
  let home = app.path().home_dir().map_err(|e| e.to_string())?;
  let query = query.trim().to_string();
  let mut paths: Vec<PathBuf> = Vec::new();
  if query.is_empty() {
    for root in ["Desktop", "Documents", "Downloads", "Developer", "Projects", "projects", "dev", "code", "Code", "workspace", "Workspace", "GitHub", "Sites"] {
      if let Ok(entries) = std::fs::read_dir(home.join(root)) {
        paths.extend(entries.flatten().map(|entry| entry.path()));
      }
    }
  } else {
    paths = search_folders(&home, &query);
  }
  let mut out: Vec<FoundFolder> = Vec::new();
  for path in paths {
    if out.len() >= 400 {
      break;
    }
    if room_candidate(&home, &path) && !out.iter().any(|item| item.path == path) {
      out.push(found(path));
    }
  }
  let lower = query.to_lowercase();
  out.sort_by(|a, b| {
    let starts = |item: &FoundFolder| !lower.is_empty() && item.name.to_lowercase().starts_with(&lower);
    starts(b).cmp(&starts(a)).then(b.modified.unwrap_or(0.0).total_cmp(&a.modified.unwrap_or(0.0)))
  });
  out.truncate(80);
  // [경로, 이름, 고친 시각(ms)] 배열로 넘겨요(serde를 새 의존성으로 더하지 않으려고).
  Ok(out.into_iter().map(|item| (item.path, item.name, item.modified)).collect())
}

#[cfg(target_os = "macos")]
fn search_folders(home: &Path, query: &str) -> Vec<PathBuf> {
  // Spotlight 질의 글자에서 따옴표·역슬래시·별표를 이스케이프해 질의를 깨지 않게 해요.
  let escaped: String = query.chars().flat_map(|c| if matches!(c, '\\' | '\'' | '"' | '*') { vec!['\\', c] } else { vec![c] }).collect();
  let filter = format!("kMDItemContentType == 'public.folder' && kMDItemFSName == '*{escaped}*'cd");
  Command::new("mdfind")
    .arg("-onlyin")
    .arg(home)
    .arg(filter)
    .output()
    .map(|out| String::from_utf8_lossy(&out.stdout).lines().take(2000).map(PathBuf::from).collect())
    .unwrap_or_default()
}

// shortcut: Spotlight가 없는 곳은 자주 쓰는 자리 세 층까지만 이름으로 훑어요. Windows 정식 지원 때 Windows Search로 바꿔요.
#[cfg(not(target_os = "macos"))]
fn search_folders(home: &Path, query: &str) -> Vec<PathBuf> {
  let lower = query.to_lowercase();
  let mut out = Vec::new();
  let mut stack: Vec<(PathBuf, u8)> = ["Desktop", "Documents", "Downloads", "Projects", "dev", "code"].iter().map(|root| (home.join(root), 0)).collect();
  while let Some((dir, depth)) = stack.pop() {
    let Ok(entries) = std::fs::read_dir(&dir) else { continue };
    for entry in entries.flatten() {
      let path = entry.path();
      if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
        continue;
      }
      if entry.file_name().to_string_lossy().to_lowercase().contains(&lower) {
        out.push(path.clone());
      }
      if depth < 2 {
        stack.push((path, depth + 1));
      }
    }
  }
  out
}

// 방 만들기 목록에서 사용자가 고른 폴더를 방 폴더로 열어요(하위 전체). 폴더 고르기 창을 거치지 않으니 여기서 홈 폴더 아래 보통 폴더인지 다시 확인해요.
// 여는 것은 읽기·감시 범위뿐이에요. 쓰기·지우기 권한은 더하지 않아요.
#[tauri::command]
fn allow_found_rooms<R: Runtime>(app: AppHandle<R>, folders: Vec<PathBuf>) -> Result<(), String> {
  let home = app.path().home_dir().map_err(|e| e.to_string())?;
  for folder in &folders {
    if !room_candidate(&home, folder) {
      return Err("방으로 열 수 없는 폴더예요.".into());
    }
  }
  for folder in &folders {
    app.fs_scope().allow_directory(folder, true).map_err(|e| e.to_string())?;
  }
  Ok(())
}

// 고른 방 폴더 안 보통 파일 하나를 다른 방 폴더로 복제해요(2026-11-18 요청). 원본은 그대로 두고, 대상 자리에 무엇이 있으면 거절해요(덮어쓰지 않음).
// 숨김 파일·폴더·바로가기는 받지 않아요. 복사 중에 멈추면 만든 사본을 지우지 않고 오류만 알려요.
#[tauri::command]
fn copy_file<R: Runtime>(app: AppHandle<R>, from: PathBuf, to: PathBuf) -> Result<(), String> {
  in_scope(&app, &from)?;
  in_scope(&app, &to)?;
  if !std::fs::symlink_metadata(&from).map_err(|e| e.to_string())?.file_type().is_file() {
    return Err("파일이 아니에요.".into());
  }
  if [&from, &to].iter().any(|path| path.file_name().and_then(|name| name.to_str()).map_or(true, |name| name.starts_with('.'))) {
    return Err("숨김 파일은 복제할 수 없어요.".into());
  }
  let mut source = std::fs::File::open(&from).map_err(|e| e.to_string())?;
  // create_new: 같은 이름이 있으면 OS가 거절해요. 확인과 쓰기 사이에 생긴 파일도 덮어쓰지 않아요.
  let mut target = std::fs::OpenOptions::new().write(true).create_new(true).open(&to).map_err(|e| e.to_string())?;
  std::io::copy(&mut source, &mut target).map(|_| ()).map_err(|e| format!("복제하다 멈췄어요. 만든 사본을 확인해 주세요. ({e})"))
}

// 웹에서 끌어 와 프로도에 놓은 주소를 내려받아, 방 폴더 맨 위에 새 파일로 저장해요(2026-11-19 요청).
// http·https만, 쿠키 없이, 500MB·2분까지. 같은 이름이 있으면 OS가 거절해요(덮어쓰지 않음). 받다 멈추면 반쯤 받은 새 파일만 휴지통으로 보내요.
fn download_ok(url: &str, name: &str) -> bool {
  let web = url.starts_with("https://") || url.starts_with("http://");
  web && !url.chars().any(|c| c.is_whitespace() || c.is_control()) && safe_relative(name) && !name.contains('/') && !name.starts_with('.')
}

#[tauri::command]
async fn save_download<R: Runtime>(app: AppHandle<R>, room: PathBuf, name: String, url: String) -> Result<(), String> {
  if !download_ok(&url, &name) {
    return Err("받을 수 없는 주소나 이름이에요.".into());
  }
  in_scope(&app, &room)?;
  if !std::fs::symlink_metadata(&room).map(|meta| meta.is_dir()).unwrap_or(false) {
    return Err("폴더가 아니에요.".into());
  }
  let target = room.join(&name);
  in_scope(&app, &target)?;
  let file = std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
  let fetched = tauri::async_runtime::spawn_blocking(move || {
    Command::new("/usr/bin/curl")
      .args(["-fsSL", "--proto", "=http,https", "--proto-redir", "=http,https", "--max-filesize", "524288000", "--max-time", "120", &url])
      .stdin(std::process::Stdio::null())
      .stdout(file)
      .stderr(std::process::Stdio::null())
      .status()
      .map(|status| status.success())
      .unwrap_or(false)
  })
  .await
  .unwrap_or(false);
  if fetched {
    return Ok(());
  }
  #[cfg(target_os = "macos")]
  let _ = trash_with_place(&target);
  #[cfg(not(target_os = "macos"))]
  let _ = trash::delete(&target);
  Err("내려받지 못했어요.".into())
}

// 퀵 메모(2026-11-19 요청): 메뉴 막대 작은 창의 메모를 방 폴더 맨 위에 .txt 새 파일로 저장해요. 1MB까지, 같은 이름이 있으면 OS가 거절해요(덮어쓰지 않음).
const MEMO_MAX: usize = 1_000_000;
fn memo_name_ok(name: &str) -> bool {
  safe_relative(name) && !name.contains('/') && !name.starts_with('.') && name.ends_with(".txt") && name.len() > 4
}

#[tauri::command]
fn save_memo<R: Runtime>(app: AppHandle<R>, room: PathBuf, name: String, text: String) -> Result<(), String> {
  use std::io::Write;
  if !memo_name_ok(&name) || text.len() > MEMO_MAX {
    return Err("저장할 수 없는 이름이나 길이예요.".into());
  }
  in_scope(&app, &room)?;
  if !std::fs::symlink_metadata(&room).map(|meta| meta.is_dir()).unwrap_or(false) {
    return Err("폴더가 아니에요.".into());
  }
  let target = room.join(&name);
  in_scope(&app, &target)?;
  let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
  file.write_all(text.as_bytes()).map_err(|e| format!("저장하다 멈췄어요. 만든 메모 파일을 확인해 주세요. ({e})"))
}

#[cfg(target_os = "macos")]
fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
  use std::ffi::{CString, c_char, c_int, c_uint};
  use std::os::unix::ffi::OsStrExt;
  unsafe extern "C" {
    fn renamex_np(from: *const c_char, to: *const c_char, flags: c_uint) -> c_int;
  }
  const RENAME_EXCL: c_uint = 0x4;
  const ENOTSUP: i32 = 45;
  let c_path = |path: &Path| CString::new(path.as_os_str().as_bytes()).map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput));
  let (from_c, to_c) = (c_path(from)?, c_path(to)?);
  if unsafe { renamex_np(from_c.as_ptr(), to_c.as_ptr(), RENAME_EXCL) } == 0 {
    return Ok(());
  }
  let error = std::io::Error::last_os_error();
  // exFAT 외장 디스크처럼 RENAME_EXCL을 모르는 파일 시스템만 예전 방식으로 옮깁니다.
  if error.raw_os_error() == Some(ENOTSUP) { check_then_rename(from, to) } else { Err(error) }
}

#[cfg(windows)]
fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
  use std::os::windows::ffi::OsStrExt;
  #[link(name = "kernel32")]
  unsafe extern "system" {
    fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
  }
  // 플래그 0: MOVEFILE_REPLACE_EXISTING 없이 부르면 대상이 있을 때 거절하고, 다른 드라이브로 복사하지도 않습니다.
  let wide = |path: &Path| path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();
  let (from_w, to_w) = (wide(from), wide(to));
  if unsafe { MoveFileExW(from_w.as_ptr(), to_w.as_ptr(), 0) } != 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
  check_then_rename(from, to)
}

// shortcut: 확인과 이름 바꾸기 사이에 다른 앱이 같은 이름을 만들면 덮어쓸 수 있어요. 원자적으로 거절하는 호출이 없는 곳에서만 쓰고, Linux를 지원하면 renameat2(RENAME_NOREPLACE)로 바꿉니다.
#[cfg(not(windows))]
fn check_then_rename(from: &Path, to: &Path) -> std::io::Result<()> {
  if to.symlink_metadata().is_ok() {
    return Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists));
  }
  std::fs::rename(from, to)
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

fn mdls(name: &str, paths: &[&PathBuf]) -> Option<Vec<Option<String>>> {
  let output = Command::new("/usr/bin/mdls").args(["-raw", "-name", name]).args(paths).output().ok()?;
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
  read_spotlight(paths, "kMDItemLastUsedDate")
}

fn read_spotlight(paths: &[PathBuf], name: &str) -> Vec<Option<String>> {
  let mut dates = vec![None; paths.len()];
  let (at, existing): (Vec<usize>, Vec<&PathBuf>) = paths.iter().enumerate().filter(|(_, path)| path.exists()).unzip();
  if existing.is_empty() || !Path::new("/usr/bin/mdls").exists() {
    return dates;
  }
  for (index, value) in at.into_iter().zip(ask_in_halves(&existing, &|chunk| mdls(name, chunk))) {
    dates[index] = value;
  }
  dates
}

// 방 폴더 안 파일을 macOS가 마지막으로 연 시각(Spotlight). 경로가 틀리면 거절하고, 시각을 못 읽는 건 오류가 아니라 None입니다.
#[tauri::command]
async fn last_used_dates<R: Runtime>(app: AppHandle<R>, root: PathBuf, paths: Vec<String>) -> Result<Vec<Option<String>>, String> {
  let full = room_paths(&app, &root, &paths)?;
  let count = full.len();
  Ok(tauri::async_runtime::spawn_blocking(move || read_last_used(&full)).await.unwrap_or_else(|_| vec![None; count]))
}

fn room_paths<R: Runtime>(app: &AppHandle<R>, root: &Path, paths: &[String]) -> Result<Vec<PathBuf>, String> {
  if !root.is_absolute() {
    return Err("안전하지 않은 경로예요.".into());
  }
  let mut full = Vec::with_capacity(paths.len());
  for path in paths {
    if !safe_relative(path) {
      return Err("안전하지 않은 경로예요.".into());
    }
    let joined = root.join(path);
    in_scope(app, &joined)?;
    full.push(joined);
  }
  Ok(full)
}

// 방 폴더 안 영상의 길이(초, Spotlight). 서랍장의 영상 길이 조건에 써요. 파일을 읽지 않고, 모르면 None이에요.
#[tauri::command]
async fn video_seconds<R: Runtime>(app: AppHandle<R>, root: PathBuf, paths: Vec<String>) -> Result<Vec<Option<f64>>, String> {
  let full = room_paths(&app, &root, &paths)?;
  let count = full.len();
  let seconds = tauri::async_runtime::spawn_blocking(move || {
    let spotlight = read_spotlight(&full, "kMDItemDurationSeconds");
    // Spotlight가 모르는 mp4·mov는 파일 머리의 mvhd에서 읽어요.
    full.iter().zip(spotlight).map(|(path, value)| value.and_then(|text| text.trim().parse::<f64>().ok()).or_else(|| mp4_seconds(path)).filter(|seconds| seconds.is_finite() && *seconds >= 0.0)).collect::<Vec<_>>()
  })
  .await
  .unwrap_or_else(|_| vec![None; count]);
  Ok(seconds)
}

// MP4·MOV 상자를 따라가 moov/mvhd의 길이÷시간 단위를 읽어요. 상자 머리만 읽고 큰 미디어 데이터는 건너뛰어요. 읽기만 해요.
fn mp4_seconds(path: &Path) -> Option<f64> {
  use std::io::{Read, Seek, SeekFrom};
  let mut file = std::fs::File::open(path).ok()?;
  let end = file.metadata().ok()?.len();
  let read = |file: &mut std::fs::File, n: usize| -> Option<Vec<u8>> {
    let mut buf = vec![0; n];
    file.read_exact(&mut buf).ok()?;
    Some(buf)
  };
  let u32_at = |b: &[u8], i: usize| u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as u64;
  // (찾는 상자 이름, 그 상자를 찾을 범위)를 차례로: 맨 위에서 moov, moov 안에서 mvhd.
  let (mut from, mut to) = (0u64, end);
  for want in [b"moov", b"mvhd"] {
    let mut at = from;
    let mut found = None;
    while at + 8 <= to {
      file.seek(SeekFrom::Start(at)).ok()?;
      let head = read(&mut file, 8)?;
      let mut size = u32_at(&head, 0);
      let mut body = at + 8;
      if size == 1 {
        let big = read(&mut file, 8)?;
        size = (u32_at(&big, 0) << 32) | u32_at(&big, 4);
        body += 8;
      } else if size == 0 {
        size = to - at;
      }
      if size < body - at || at + size > to {
        return None;
      }
      if &head[4..8] == want {
        found = Some((body, at + size));
        break;
      }
      at += size;
    }
    (from, to) = found?;
  }
  file.seek(SeekFrom::Start(from)).ok()?;
  let version = read(&mut file, 4)?[0];
  let (scale, length) = if version == 1 {
    let b = read(&mut file, 28)?;
    (u32_at(&b, 16), (u32_at(&b, 20) << 32) | u32_at(&b, 24))
  } else {
    let b = read(&mut file, 16)?;
    (u32_at(&b, 8), u32_at(&b, 12))
  };
  (scale > 0).then(|| length as f64 / scale as f64)
}

// 사용자가 고른 파일 하나로 썸네일 그림을 만듭니다. macOS는 Quick Look으로 PSD·AI처럼 화면이 못 읽는 형식도 그림을 뽑고,
// 다른 OS는 파일을 그대로 돌려줘 화면에서 이미지로 읽어요. 고른 파일은 읽기만 해요.
#[tauri::command]
async fn thumbnail<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<tauri::ipc::Response, String> {
  in_scope(&app, &path)?;
  if !path.is_file() {
    return Err("파일이 아니에요.".into());
  }
  let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
  let bytes = tauri::async_runtime::spawn_blocking(move || picture_of(&path, &cache)).await.map_err(|e| e.to_string())??;
  Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(target_os = "macos")]
fn picture_of(path: &Path, cache: &Path) -> Result<Vec<u8>, String> {
  static NEXT: AtomicU32 = AtomicU32::new(0);
  // 앱 캐시 안에 이번 한 번만 쓰는 폴더를 만들고, 읽은 뒤 그 폴더만 지웁니다. 사용자 폴더에는 아무것도 쓰지 않아요.
  let out = cache.join(format!("thumb-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
  std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
  let made = quick_look(path, &out);
  let _ = std::fs::remove_dir_all(&out);
  made
}

// 깨진 파일에서는 Quick Look이 끝나지 않아서 15초 뒤 멈춰요.
#[cfg(target_os = "macos")]
fn quick_look(path: &Path, out: &Path) -> Result<Vec<u8>, String> {
  use std::process::Stdio;
  use std::time::Instant;
  let mut child = Command::new("/usr/bin/qlmanage")
    .args(["-t", "-s", "384", "-o"])
    .arg(out)
    .arg(path)
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| e.to_string())?;
  let started = Instant::now();
  while child.try_wait().map_err(|e| e.to_string())?.is_none() {
    if started.elapsed() > Duration::from_secs(15) {
      let _ = child.kill();
      let _ = child.wait();
      return Err("미리보기를 만드는 데 너무 오래 걸려요. 다른 파일을 골라 주세요.".into());
    }
    std::thread::sleep(Duration::from_millis(100));
  }
  let png = std::fs::read_dir(out)
    .map_err(|e| e.to_string())?
    .flatten()
    .map(|entry| entry.path())
    .find(|made| made.extension().is_some_and(|ext| ext == "png"))
    .ok_or("이 파일은 미리보기를 만들지 못했어요.")?;
  std::fs::read(png).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
fn picture_of(path: &Path, _: &Path) -> Result<Vec<u8>, String> {
  // pictures.ts pictureSourceLimit과 같은 40MB. 읽기 전에 막아요.
  if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 40 * 1024 * 1024 {
    return Err("이미지가 너무 커요. 40MB까지 고를 수 있어요.".into());
  }
  std::fs::read(path).map_err(|e| e.to_string())
}

// 발표 파일(pptx·key 같은)을 macOS Quick Look 미리보기로 바꿔 돌려줍니다. 사용자 파일은 읽기만 하고,
// 앱 캐시 안에 이번 한 번 쓰는 폴더만 만들었다 지워요. HTML로 나오면 그림을 data URL로 넣은 HTML 한 덩어리, PDF로 나오면 PDF 바이트 그대로예요.
// HTML은 화면이 스크립트 없이 안전한 태그만 골라 다시 그려요(FileViewer SlideView).
#[tauri::command]
async fn slide_preview<R: Runtime>(app: AppHandle<R>, path: PathBuf) -> Result<tauri::ipc::Response, String> {
  in_scope(&app, &path)?;
  if !path.is_file() {
    return Err("파일이 아니에요.".into());
  }
  let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
  let bytes = tauri::async_runtime::spawn_blocking(move || slides_of(&path, &cache)).await.map_err(|e| e.to_string())??;
  Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(target_os = "macos")]
fn slides_of(path: &Path, cache: &Path) -> Result<Vec<u8>, String> {
  static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
  let out = cache.join(format!("slides-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
  std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
  let made = quick_look_preview(path, &out);
  let _ = std::fs::remove_dir_all(&out);
  made
}

#[cfg(not(target_os = "macos"))]
fn slides_of(_: &Path, _: &Path) -> Result<Vec<u8>, String> {
  Err("발표 미리보기는 macOS 앱에서만 돼요.".into())
}

// qlmanage -p -o 는 미리보기를 띄우지 않고 .qlpreview 묶음(Preview.html + 그림, 또는 Preview.pdf)으로 저장해요. 깨진 파일에서 멈추면 30초 뒤 끊어요.
#[cfg(target_os = "macos")]
fn quick_look_preview(path: &Path, out: &Path) -> Result<Vec<u8>, String> {
  use std::process::Stdio;
  use std::time::Instant;
  let mut child = Command::new("/usr/bin/qlmanage").arg("-p").arg("-o").arg(out).arg(path).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
  let started = Instant::now();
  while child.try_wait().map_err(|e| e.to_string())?.is_none() {
    if started.elapsed() > Duration::from_secs(30) {
      let _ = child.kill();
      let _ = child.wait();
      return Err("미리보기를 만드는 데 너무 오래 걸려요.".into());
    }
    std::thread::sleep(Duration::from_millis(100));
  }
  let bundle = std::fs::read_dir(out).map_err(|e| e.to_string())?.flatten().map(|entry| entry.path()).find(|made| made.extension().is_some_and(|ext| ext == "qlpreview")).ok_or("이 파일은 미리보기를 만들지 못했어요.")?;
  let pdf = bundle.join("Preview.pdf");
  if pdf.is_file() {
    return std::fs::read(pdf).map_err(|e| e.to_string());
  }
  let html = std::fs::read_to_string(bundle.join("Preview.html")).map_err(|_| "이 파일은 미리보기를 만들지 못했어요.".to_string())?;
  let mut files = Vec::new();
  let mut total = 0u64;
  for entry in std::fs::read_dir(&bundle).map_err(|e| e.to_string())?.flatten() {
    let name = entry.file_name().to_string_lossy().into_owned();
    if name.starts_with("Preview") || !entry.path().is_file() {
      continue;
    }
    total += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
    // 그림을 다 넣어도 화면이 버틸 만큼만(80MB). 넘으면 앱에서 보지 않고 기본 앱으로 열게 해요.
    if total > 80 * 1024 * 1024 {
      return Err("발표 파일이 너무 커서 미리 보지 않아요.".into());
    }
    files.push((name, std::fs::read(entry.path()).map_err(|e| e.to_string())?));
  }
  Ok(inline_attachments(&html, &files).into_bytes())
}

// Preview.html 의 "Attachment1.png" 같은 그림 이름을 data URL로 바꿔요. 따옴표·괄호까지 맞춰 바꿔서 Attachment1 과 Attachment15 가 섞이지 않아요.
fn inline_attachments(html: &str, files: &[(String, Vec<u8>)]) -> String {
  let mut html = html.to_string();
  for (name, bytes) in files {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
      "png" => "image/png",
      "jpg" | "jpeg" => "image/jpeg",
      "gif" => "image/gif",
      "tif" | "tiff" => "image/tiff",
      "bmp" => "image/bmp",
      "svg" => "image/svg+xml",
      _ => continue,
    };
    let data = format!("data:{mime};base64,{}", base64(bytes));
    for (open, close) in [("\"", "\""), ("'", "'"), ("(", ")")] {
      html = html.replace(&format!("{open}{name}{close}"), &format!("{open}{data}{close}"));
    }
  }
  html
}

fn base64(bytes: &[u8]) -> String {
  const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
  for chunk in bytes.chunks(3) {
    let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
    for at in 0..4 {
      out.push(if at <= chunk.len() { TABLE[(n >> (18 - 6 * at)) as usize & 63] as char } else { '=' });
    }
  }
  out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    // 고른 폴더 권한을 앱을 다시 열어도 유지합니다(fs 플러그인 다음에 등록해야 합니다).
    .plugin(tauri_plugin_persisted_scope::init())
    .plugin(tauri_plugin_dialog::init())
    .menu(|app| {
      #[cfg(target_os = "macos")]
      return app_menu(app);
      #[cfg(not(target_os = "macos"))]
      return Menu::default(app);
    })
    .on_menu_event(|app, event| {
      if event.id().as_ref() == "app-quit" {
        ask_quit(app);
      }
    })
    .invoke_handler(tauri::generate_handler![allow_rooms, show_main, quit_app, quit_answer, set_pet_visible, open_in_app, trash_file, restore_trashed, last_used_dates, video_seconds, move_file, copy_file, save_download, save_memo, screenshot_dir, make_shot_folder, find_folders, allow_found_rooms, thumbnail, slide_preview, set_panel_visible, set_tray_dot, set_tray_working])
    .setup(|_app| {
      // 새 파일이 들어오는 기본 현관: 다운로드 폴더 맨 위층만 읽고 옮길 수 있게 열어 둬요. 하위 폴더는 열지 않고, 쓰기·지우기 권한은 더하지 않아요.
      if let Ok(downloads) = _app.path().download_dir() {
        let _ = _app.fs_scope().allow_directory(&downloads, false);
      }
      // 작업 중 스크린샷을 방으로 모으려고 스크린샷 저장 폴더도 맨 위층만 열어 둬요. 하위 폴더는 열지 않아요.
      if let Some(shots) = screenshot_folder(_app.handle()) {
        let _ = _app.fs_scope().allow_directory(&shots, false);
      }
      #[cfg(target_os = "macos")]
      keep_tray_off_notch();
      // 아이콘을 못 만들어도(알림 영역이 없는 데스크톱 등) 앱은 그대로 씁니다. 숨긴 프로도는 환경설정에서 다시 켜요.
      if let Err(error) = build_tray(_app.handle()) {
        eprintln!("메뉴 막대 아이콘을 만들지 못했어요: {error}");
      }
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
      // ⌘Q 같은 OS 쪽 끄기도 작업 중이면 한 번 물어요. 허락한 뒤 app.exit로 다시 오면 그대로 꺼요.
      if let tauri::RunEvent::ExitRequested { api, .. } = &_event {
        if !QUIT_OK.load(Ordering::SeqCst) && TRAY_WORKING.lock().map(|color| color.is_some()).unwrap_or(false) {
          api.prevent_exit();
          ask_quit(_app);
        }
      }
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

  #[test]
  fn pet_lands_by_the_tray_icon_inside_the_screen() {
    let screen = (0.0, 0.0, 2880.0, 1800.0);
    // macOS 메뉴 막대: 아이콘 바로 아래 가운데.
    assert_eq!(spot_by_icon((2000.0, 0.0, 44.0, 48.0), (400.0, 360.0), screen, 12.0), (1822.0, 60.0));
    // 오른쪽 끝 아이콘이라도 화면 밖으로 나가지 않아요.
    assert_eq!(spot_by_icon((2860.0, 0.0, 20.0, 48.0), (400.0, 360.0), screen, 12.0).0, 2480.0);
    // Windows 작업 표시줄(아래): 아이콘 위에 세워요.
    assert_eq!(spot_by_icon((2000.0, 1760.0, 40.0, 40.0), (400.0, 360.0), screen, 12.0), (1820.0, 1388.0));
    // 창보다 좁은 화면이어도 왼쪽 위 끝에 붙고 터지지 않아요.
    assert_eq!(spot_by_icon((10.0, 0.0, 20.0, 20.0), (400.0, 360.0), (0.0, 0.0, 300.0, 200.0), 6.0), (0.0, 0.0));
  }

  #[test]
  fn tray_dot_marks_only_the_corner() {
    let plain = tray_logo(false, None);
    let dotted = tray_logo(true, None);
    assert_eq!(plain, TRAY_LOGO);
    assert_eq!(dotted.len(), 36 * 36 * 4);
    // 점 가운데는 잉크, 왼쪽 아래 구석은 로고 그대로예요.
    let at = |x: usize, y: usize| (y * 36 + x) * 4;
    assert_eq!(&dotted[at(28, 7)..at(28, 7) + 4], &[23, 23, 23, 255]);
    assert_eq!(&dotted[at(2, 33)..at(2, 33) + 4], &plain[at(2, 33)..at(2, 33) + 4]);
  }
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
      .invoke_handler(tauri::generate_handler![allow_rooms, open_in_app, trash_file, restore_trashed, last_used_dates, move_file])
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
    invoke(&webview, "move_file", json!({ "from": file, "to": boxed })).unwrap();
    assert_eq!(std::fs::read_to_string(&boxed).unwrap(), "원본");

    assert!(invoke(&webview, "plugin:fs|stat", json!({ "path": parent.join("other/a.txt") })).is_err());
    assert!(invoke(&webview, "move_file", json!({ "from": boxed, "to": outside.join("시안.psd") })).is_err());
    assert!(invoke(&webview, "plugin:fs|remove", json!({ "path": boxed })).is_err());
    assert!(invoke(&webview, "plugin:fs|write_text_file", json!({ "path": boxed })).is_err());
    assert!(invoke(&webview, "open_in_app", json!({ "path": outside })).is_err());
    assert!(invoke(&webview, "trash_file", json!({ "path": room.join("../../outside") })).is_err());
    // 휴지통은 방 폴더 안의 보통 파일만: 바깥 파일·폴더·숨김 파일은 거절해요(실제 휴지통 이동은 시험하지 않아요).
    assert!(invoke(&webview, "trash_file", json!({ "path": parent.join("other/a.txt") })).is_err());
    assert!(invoke(&webview, "trash_file", json!({ "path": room.join("참고") })).is_err());
    std::fs::write(room.join(".hidden"), "h").unwrap();
    assert!(invoke(&webview, "trash_file", json!({ "path": room.join(".hidden") })).is_err());
    assert!(room.join(".hidden").exists());
    // 되돌리기는 휴지통 안 파일만, 방 폴더 안으로만: 방 밖·휴지통 밖에서 가져오기는 거절해요.
    assert!(invoke(&webview, "restore_trashed", json!({ "from": parent.join("other/a.txt"), "to": room.join("a.txt") })).is_err());
    assert!(invoke(&webview, "restore_trashed", json!({ "from": base.join(".Trash/../parent/other/a.txt"), "to": room.join("a.txt") })).is_err());
    assert!(invoke(&webview, "last_used_dates", json!({ "root": outside, "paths": ["a.txt"] })).is_err());
    assert!(invoke(&webview, "last_used_dates", json!({ "root": room, "paths": ["../other/a.txt"] })).is_err());
    assert!(invoke(&webview, "last_used_dates", json!({ "root": room, "paths": ["/etc/hosts"] })).is_err());
    assert!(invoke(&webview, "last_used_dates", json!({ "root": room, "paths": [""] })).is_err());
    // 없는 파일이 끼어도 거절하지 않습니다.
    invoke(&webview, "last_used_dates", json!({ "root": room, "paths": ["없음.txt", "_Folduct 정리상자/시안.psd"] })).unwrap();
    assert!(boxed.exists());
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 퀵 메모: 고른 방 폴더 맨 위 .txt 새 파일로만, 있는 파일은 그대로예요.
  #[test]
  fn memo_saves_only_new_txt_inside_room() {
    let base = std::env::temp_dir().join(format!("folduct-memo-{}", std::process::id()));
    let (room, outside) = (base.join("room"), base.join("outside"));
    for dir in [&room, &outside] {
      std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(room.join("있음.txt"), "있던 것").unwrap();
    let app = tauri::test::mock_builder()
      .plugin(tauri_plugin_fs::init())
      .invoke_handler(tauri::generate_handler![save_memo])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "pet", Default::default()).build().unwrap();
    app.fs_scope().allow_directory(&room, true).unwrap();

    invoke(&webview, "save_memo", json!({ "room": room, "name": "2026-11-19 졸업 memo.txt", "text": "할 일" })).unwrap();
    assert_eq!(std::fs::read_to_string(room.join("2026-11-19 졸업 memo.txt")).unwrap(), "할 일");
    assert!(invoke(&webview, "save_memo", json!({ "room": room, "name": "있음.txt", "text": "새것" })).is_err());
    assert_eq!(std::fs::read_to_string(room.join("있음.txt")).unwrap(), "있던 것");
    assert!(invoke(&webview, "save_memo", json!({ "room": outside, "name": "a.txt", "text": "x" })).is_err());
    for name in ["../a.txt", "a.sh", ".txt", "sub/a.txt"] {
      assert!(invoke(&webview, "save_memo", json!({ "room": room, "name": name, "text": "x" })).is_err());
    }
    assert!(invoke(&webview, "save_memo", json!({ "room": room, "name": "큰.txt", "text": "a".repeat(MEMO_MAX + 1) })).is_err());
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 내려받기: http·https 주소와 폴더 맨 위 보통 이름만 받아요.
  #[test]
  fn download_takes_only_web_urls_and_plain_names() {
    assert!(download_ok("https://example.com/a.png", "a.png"));
    assert!(!download_ok("file:///etc/hosts", "hosts"));
    assert!(!download_ok("https://example.com/a b.png", "a.png"));
    assert!(!download_ok("https://example.com/a.png", "../a.png"));
    assert!(!download_ok("https://example.com/a.png", "sub/a.png"));
    assert!(!download_ok("https://example.com/a.png", ".zshrc"));
  }

  // 내려받기: 고른 방 폴더 밖과 이미 있는 이름은 거절해요. 있던 파일은 그대로예요.
  #[test]
  fn download_never_overwrites_or_leaves_room() {
    let base = std::env::temp_dir().join(format!("folduct-get-{}", std::process::id()));
    let (room, outside) = (base.join("room"), base.join("outside"));
    for dir in [&room, &outside] {
      std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(room.join("있음.png"), "있던 것").unwrap();
    let app = tauri::test::mock_builder()
      .plugin(tauri_plugin_fs::init())
      .invoke_handler(tauri::generate_handler![save_download])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "pet", Default::default()).build().unwrap();
    app.fs_scope().allow_directory(&room, true).unwrap();
    let url = "https://example.invalid/a.png";

    assert!(invoke(&webview, "save_download", json!({ "room": outside, "name": "a.png", "url": url })).is_err());
    assert!(!outside.join("a.png").exists());
    assert!(invoke(&webview, "save_download", json!({ "room": room, "name": "있음.png", "url": url })).is_err());
    assert_eq!(std::fs::read_to_string(room.join("있음.png")).unwrap(), "있던 것");
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 스크린샷 날짜 폴더: 고른 방 폴더 안에만, 날짜 모양 이름으로만 만들어요. 있는 폴더는 그대로 써요.
  #[test]
  fn shot_folder_stays_inside_room() {
    let base = std::env::temp_dir().join(format!("folduct-shot-{}", std::process::id()));
    let (room, outside) = (base.join("room"), base.join("outside"));
    for dir in [&room, &outside] {
      std::fs::create_dir_all(dir).unwrap();
    }
    let app = tauri::test::mock_builder()
      .plugin(tauri_plugin_fs::init())
      .invoke_handler(tauri::generate_handler![make_shot_folder])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "pet", Default::default()).build().unwrap();
    app.fs_scope().allow_directory(&room, true).unwrap();

    assert!(invoke(&webview, "make_shot_folder", json!({ "room": outside, "day": "2026-11-19" })).is_err());
    assert!(invoke(&webview, "make_shot_folder", json!({ "room": room, "day": "../../x" })).is_err());
    invoke(&webview, "make_shot_folder", json!({ "room": room, "day": "2026-11-19" })).unwrap();
    invoke(&webview, "make_shot_folder", json!({ "room": room, "day": "2026-11-19" })).unwrap();
    assert!(room.join("스크린샷/2026-11-19").is_dir());
    assert!(!outside.join("스크린샷").exists());
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
      .invoke_handler(tauri::generate_handler![allow_rooms, open_in_app, trash_file, last_used_dates, move_file])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    // 대화상자에서 recursive: true로 두 폴더를 고른 상태와 같습니다.
    app.fs_scope().allow_directory(&door, true).unwrap();
    app.fs_scope().allow_directory(&room, true).unwrap();
    let (from, to) = (door.join("보고서.pdf"), room.join("보고서.pdf"));

    assert!(invoke(&webview, "move_file", json!({ "from": from, "to": outside.join("보고서.pdf") })).is_err());
    invoke(&webview, "move_file", json!({ "from": from, "to": to })).unwrap();
    assert_eq!(std::fs::read_to_string(&to).unwrap(), "원본");
    invoke(&webview, "move_file", json!({ "from": to, "to": from })).unwrap();
    assert_eq!(std::fs::read_to_string(&from).unwrap(), "원본");
    assert!(invoke(&webview, "plugin:fs|remove", json!({ "path": from })).is_err());
    assert!(invoke(&webview, "plugin:fs|write_text_file", json!({ "path": from })).is_err());
    assert!(from.exists());
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 방 만들기 목록은 홈 아래 보통 폴더만 방 후보로 받아요.
  #[test]
  fn room_candidates_are_plain_folders_under_home() {
    let home = std::env::temp_dir().join(format!("folduct-home-{}", std::process::id()));
    for dir in ["작업/포스터", ".숨김/안", "Library/Caches", "앱.app", "작업/node_modules", "밖"] {
      std::fs::create_dir_all(home.join(dir)).unwrap();
    }
    std::fs::write(home.join("파일.txt"), "x").unwrap();
    assert!(room_candidate(&home, &home.join("작업")));
    assert!(room_candidate(&home, &home.join("작업/포스터")));
    for bad in [home.clone(), home.join(".숨김/안"), home.join("Library/Caches"), home.join("앱.app"), home.join("작업/node_modules"), home.join("파일.txt"), home.join("없음"), home.join("작업/../밖"), std::env::temp_dir()] {
      assert!(!room_candidate(&home, &bad), "{bad:?}");
    }
    std::fs::remove_dir_all(&home).unwrap();
  }

  // 복제는 고른 방 폴더 사이에서만, 원본은 그대로 두고 같은 이름은 덮어쓰지 않습니다.
  #[test]
  fn copies_between_rooms_without_overwriting() {
    let base = std::env::temp_dir().join(format!("folduct-copy-{}", std::process::id()));
    let (one, two, outside) = (base.join("one"), base.join("two"), base.join("outside"));
    for dir in [&one, &two, &outside] {
      std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(one.join("시안.psd"), "원본").unwrap();
    std::fs::write(two.join("있음.psd"), "다른 파일").unwrap();
    std::fs::write(one.join(".숨김"), "x").unwrap();
    let app = tauri::test::mock_builder()
      .plugin(tauri_plugin_fs::init())
      .invoke_handler(tauri::generate_handler![copy_file])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    app.fs_scope().allow_directory(&one, true).unwrap();
    app.fs_scope().allow_directory(&two, true).unwrap();
    let from = one.join("시안.psd");

    invoke(&webview, "copy_file", json!({ "from": from, "to": two.join("시안.psd") })).unwrap();
    assert_eq!(std::fs::read_to_string(two.join("시안.psd")).unwrap(), "원본");
    assert_eq!(std::fs::read_to_string(&from).unwrap(), "원본");
    assert!(invoke(&webview, "copy_file", json!({ "from": from, "to": two.join("있음.psd") })).is_err());
    assert_eq!(std::fs::read_to_string(two.join("있음.psd")).unwrap(), "다른 파일");
    assert!(invoke(&webview, "copy_file", json!({ "from": from, "to": outside.join("시안.psd") })).is_err());
    assert!(!outside.join("시안.psd").exists());
    assert!(invoke(&webview, "copy_file", json!({ "from": one.join(".숨김"), "to": two.join("숨김") })).is_err());
    assert!(invoke(&webview, "copy_file", json!({ "from": &one, "to": two.join("폴더") })).is_err());
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
      .invoke_handler(tauri::generate_handler![move_file])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "pet", Default::default()).build().unwrap();
    app.fs_scope().allow_directory(&door, true).unwrap();
    app.fs_scope().allow_directory(&room, true).unwrap();
    let (from, to) = (door.join("보고서.pdf"), room.join("보고서.pdf"));

    assert!(invoke(&webview, "move_file", json!({ "from": from, "to": outside.join("보고서.pdf") })).is_err());
    invoke(&webview, "move_file", json!({ "from": from, "to": to })).unwrap();
    assert_eq!(std::fs::read_to_string(&to).unwrap(), "원본");
    assert!(invoke(&webview, "plugin:fs|remove", json!({ "path": to })).is_err());
    assert!(invoke(&webview, "plugin:fs|write_text_file", json!({ "path": to })).is_err());
    assert!(to.exists());
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 확인을 건너뛰고 바로 불러도 대상 자리에 있는 파일을 덮어쓰지 않습니다. 덮어쓰는 plugin-fs rename은 권한에서 뺐어요.
  #[test]
  fn move_never_replaces_existing_file() {
    let base = std::env::temp_dir().join(format!("folduct-excl-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let (from, to) = (base.join("새.psd"), base.join("있던.psd"));
    std::fs::write(&from, "새것").unwrap();
    std::fs::write(&to, "있던 것").unwrap();
    let app = tauri::test::mock_builder()
      .plugin(tauri_plugin_fs::init())
      .invoke_handler(tauri::generate_handler![move_file])
      .build(tauri::generate_context!(test = true))
      .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    app.fs_scope().allow_directory(&base, true).unwrap();

    assert!(invoke(&webview, "move_file", json!({ "from": from, "to": to })).is_err());
    assert!(invoke(&webview, "plugin:fs|rename", json!({ "oldPath": from, "newPath": to })).is_err());
    assert!(invoke(&webview, "move_file", json!({ "from": base, "to": base.join("../폴더") })).is_err());
    assert!(rename_no_replace(&from, &to).is_err());
    assert_eq!(std::fs::read_to_string(&from).unwrap(), "새것");
    assert_eq!(std::fs::read_to_string(&to).unwrap(), "있던 것");
    invoke(&webview, "move_file", json!({ "from": from, "to": base.join("빈자리.psd") })).unwrap();
    assert_eq!(std::fs::read_to_string(base.join("빈자리.psd")).unwrap(), "새것");
    std::fs::remove_dir_all(&base).unwrap();
  }

  // mvhd 길이: 앞에 다른 상자(ftyp)가 있어도 moov 안 mvhd를 찾아 초로 돌려줘요. 상자가 깨졌으면 None이에요.
  #[test]
  fn mp4_seconds_reads_mvhd() {
    let base = std::env::temp_dir().join(format!("folduct-mp4-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let mut mvhd = vec![0u8; 8 + 100];
    mvhd[..4].copy_from_slice(&108u32.to_be_bytes());
    mvhd[4..8].copy_from_slice(b"mvhd");
    mvhd[20..24].copy_from_slice(&600u32.to_be_bytes());
    mvhd[24..28].copy_from_slice(&(600u32 * 95).to_be_bytes());
    let mut file = Vec::new();
    file.extend_from_slice(&16u32.to_be_bytes());
    file.extend_from_slice(b"ftypisom\0\0\0\0");
    file.extend_from_slice(&(8 + mvhd.len() as u32).to_be_bytes());
    file.extend_from_slice(b"moov");
    file.extend_from_slice(&mvhd);
    let good = base.join("a.mp4");
    std::fs::write(&good, &file).unwrap();
    assert_eq!(mp4_seconds(&good), Some(95.0));
    let broken = base.join("b.mp4");
    std::fs::write(&broken, &file[..30]).unwrap();
    assert_eq!(mp4_seconds(&broken), None);
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 진짜 휴지통으로 보냈다가 받은 자리에서 되돌려 원래 내용 그대로인지 봐요(macOS만, 휴지통에는 아무것도 남기지 않아요).
  #[cfg(target_os = "macos")]
  #[test]
  fn slide_attachments_become_data_urls() {
    assert_eq!(base64(b""), "");
    assert_eq!(base64(b"f"), "Zg==");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(base64(b"foo"), "Zm9v");
    assert_eq!(base64(b"foob"), "Zm9vYg==");
    let html = r#"<img src="Attachment1.png"><img src="Attachment15.png"><div style="background:url(Attachment1.png)"></div><a href="Attachment1.png.txt">"#;
    let files = vec![("Attachment1.png".to_string(), b"a".to_vec()), ("Attachment15.png".to_string(), b"bc".to_vec()), ("note.txt".to_string(), b"x".to_vec())];
    let out = inline_attachments(html, &files);
    assert_eq!(out, r#"<img src="data:image/png;base64,YQ=="><img src="data:image/png;base64,YmM="><div style="background:url(data:image/png;base64,YQ==)"></div><a href="Attachment1.png.txt">"#);
  }

  #[test]
  fn working_tray_paints_hole_with_room_color() {
    let plain = tray_logo(false, None);
    let on = tray_logo(false, Some([122, 90, 31]));
    let at = |x: usize, y: usize| (y * 36 + x) * 4;
    // 구멍(18, 12)은 검정 → 방 색, 테(5, 12)와 왼쪽 눈(11, 18)은 흰색 그대로, 바깥 검은 선(1, 18)도 그대로예요.
    assert_eq!(plain[at(18, 12)], 23);
    assert_eq!(&on[at(18, 12)..at(18, 12) + 3], &[122, 90, 31]);
    assert_eq!(on[at(5, 12)], plain[at(5, 12)]);
    assert_eq!(on[at(11, 18)], plain[at(11, 18)]);
    assert_eq!(&on[at(1, 18)..at(1, 18) + 4], &plain[at(1, 18)..at(1, 18) + 4]);
    assert_eq!(hex_rgb("#7a5a1f"), Some([122, 90, 31]));
    assert_eq!(hex_rgb("var(--face-5)"), None);
  }


  #[test]
  fn trash_then_restore_round_trip() {
    let base = std::env::temp_dir().join(format!("folduct-trash-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let file = base.join("되돌릴 파일.txt");
    std::fs::write(&file, "원본").unwrap();
    let placed = trash_with_place(&file).unwrap();
    assert!(!file.exists());
    assert!(placed.components().any(|part| matches!(part, Component::Normal(name) if name == ".Trash" || name == ".Trashes")));
    rename_no_replace(&placed, &file).unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "원본");
    std::fs::remove_dir_all(&base).unwrap();
  }

  // 영상 길이도 같은 길로 읽어요. 영상이 아닌 파일과 없는 파일은 None이에요.
  #[test]
  fn spotlight_duration_is_none_for_non_video() {
    let base = std::env::temp_dir().join(format!("folduct-len-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let a = base.join("a.txt");
    std::fs::write(&a, "a").unwrap();
    assert_eq!(read_spotlight(&[a, base.join("없음.mp4")], "kMDItemDurationSeconds"), vec![None, None]);
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
