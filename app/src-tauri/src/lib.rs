mod tts;
mod wav;

use std::path::PathBuf;
use tauri::Manager;

/// 模型文件清单,由 build.rs 扫描 models/ 生成。
/// 只在 Android 分支使用(桌面直接读文件系统),故允许 dead_code。
mod model_files {
    #![allow(dead_code)]
    include!(concat!(env!("OUT_DIR"), "/model_files.rs"));
}

const MODEL_DIR_NAME: &str = "models/kitten-nano-en-v0_2-fp16";

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

/// 定位一个 sherpa-onnx **能用真实文件路径打开**的模型目录。
///
/// 桌面:资源在安装包内的 Resources 目录(开发模式下回退到 src-tauri/models)。
/// Android:资源是 APK 里的 assets(`asset://localhost/...`),sherpa-onnx 底层的
/// C++ `std::ifstream` 打不开这种路径,所以首次启动时先把它们复制到应用私有目录。
fn locate_model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        android::ensure_model_on_disk(app)
    }

    #[cfg(not(target_os = "android"))]
    {
        if let Ok(p) = app.path().resolve(MODEL_DIR_NAME, tauri::path::BaseDirectory::Resource) {
            if p.join("model.fp16.onnx").exists() {
                return Ok(p);
            }
        }
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(MODEL_DIR_NAME))
    }
}

#[cfg(target_os = "android")]
mod android {
    use super::{model_files::MODEL_FILES, MODEL_DIR_NAME};
    use std::path::PathBuf;
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;

    /// 把模型从 APK assets 搬到应用私有目录,返回真实路径。
    /// 已搬过就直接返回(用 `.complete` 标记文件判断,避免半途中断后误判为完成)。
    pub fn ensure_model_on_disk(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dest = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("无法定位应用数据目录: {e}"))?
            .join(MODEL_DIR_NAME);
        let marker = dest.join(".complete");
        if marker.exists() {
            return Ok(dest);
        }

        let src_dir = app
            .path()
            .resolve(MODEL_DIR_NAME, tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("无法定位资源目录: {e}"))?;
        let fs = app.fs();

        for rel in MODEL_FILES {
            let out = dest.join(rel);
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("建目录失败: {e}"))?;
            }
            let bytes = fs
                .read(src_dir.join(rel))
                .map_err(|e| format!("读取 assets/{rel} 失败: {e}"))?;
            std::fs::write(&out, bytes).map_err(|e| format!("写入 {rel} 失败: {e}"))?;
        }

        std::fs::write(&marker, b"ok").map_err(|e| format!("写标记文件失败: {e}"))?;
        Ok(dest)
    }
}

/// 应用入口。
///
/// 桌面端由 `main.rs` 调用;移动端(iOS/Android)由 Tauri 通过平台桥接调用,
/// `mobile_entry_point` 会生成对应的导出符号(JNI 的 `Java_..._run` 等)。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let model_dir = locate_model_dir(app.handle())?;
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
