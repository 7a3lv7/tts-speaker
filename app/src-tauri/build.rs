use std::path::Path;

fn main() {
    tauri_build::build();
    generate_model_manifest();
}

/// 扫描 models/ 生成文件清单,供 Android 首次启动时从 APK assets 逐个复制。
///
/// 为什么不运行时枚举目录:Android 的 assets 不是真实文件系统,fs 插件虽然能读
/// 文件内容,但目录遍历在各版本上行为不一致(Tauri issue #11823 / #3321)。
/// 编译期生成清单最可靠 —— 文件在打包时就确定了。
fn generate_model_manifest() {
    let model_dir = Path::new("models/kitten-nano-en-v0_2-fp16");
    println!("cargo:rerun-if-changed=models");

    let mut files = Vec::new();
    collect_files(model_dir, model_dir, &mut files);
    files.sort();

    let mut code = String::from("/// 模型目录下的相对路径列表(由 build.rs 生成)\n");
    code.push_str("pub const MODEL_FILES: &[&str] = &[\n");
    for f in &files {
        code.push_str("    ");
        code.push_str(&format!("{f:?}"));
        code.push_str(",\n");
    }
    code.push_str("];\n");

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR 未设置");
    std::fs::write(Path::new(&out_dir).join("model_files.rs"), code)
        .expect("写入模型清单失败");

    println!("cargo:warning=模型清单已生成:{} 个文件", files.len());
}

fn collect_files(base: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(base, &path, out);
        } else if let Ok(rel) = path.strip_prefix(base) {
            // 统一用正斜杠,APK 内的路径就是这个形式
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}
