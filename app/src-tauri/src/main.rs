#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tts;
mod wav;

use std::path::PathBuf;
use tauri::Manager;

struct AppState {
    engine: tts::Engine,
    cache_dir: PathBuf,
}

#[tauri::command]
async fn synth(
    state: tauri::State<'_, AppState>,
    text: String,
    sid: i32,
    speed: f32,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("文本为空".into());
    }
    let result = state.engine.synth(&text, sid, speed)?;
    let bytes = wav::encode_wav(&result.samples, result.sample_rate);

    let path = state.cache_dir.join(format!("tts-{}.wav", now_millis()));
    std::fs::write(&path, &bytes).map_err(|e| format!("写文件失败: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn save_wav(
    state: tauri::State<'_, AppState>,
    text: String,
    sid: i32,
    speed: f32,
    dest: String,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("文本为空".into());
    }
    let result = state.engine.synth(&text, sid, speed)?;
    let bytes = wav::encode_wav(&result.samples, result.sample_rate);
    std::fs::write(&dest, &bytes).map_err(|e| format!("保存失败: {e}"))?;
    Ok(())
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 打包后模型在 .app/Contents/Resources/models/ 下;开发模式在 src-tauri/models/。
/// 用「文件是否存在」判定而不是靠 resolve() 的成败,两种模式都能命中。
fn locate_model_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(p) = app
        .path()
        .resolve("models/kitten-nano-en-v0_2-fp16", tauri::path::BaseDirectory::Resource)
    {
        if p.join("model.fp16.onnx").exists() {
            return p;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/kitten-nano-en-v0_2-fp16")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let model_dir = locate_model_dir(app.handle());
            println!("模型目录: {}", model_dir.display());
            let cache_dir = app.path().app_cache_dir().expect("无法定位缓存目录");
            std::fs::create_dir_all(&cache_dir).ok();
            app.manage(AppState {
                engine: tts::Engine::new(model_dir),
                cache_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![synth, save_wav])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
