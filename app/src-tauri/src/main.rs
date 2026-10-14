// 桌面端入口。移动端不使用这个文件 —— Tauri 直接调用 lib.rs 里的 run()。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tts_app_lib::run()
}
