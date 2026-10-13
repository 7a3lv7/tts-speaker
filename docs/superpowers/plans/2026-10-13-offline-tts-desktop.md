# 离线 TTS 桌面应用(macOS 先行)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个 macOS 桌面应用(Kitten nano 模型内嵌),文字进、语音出,可调语速、可选音色、可导出 WAV,完全离线。

**Architecture:** Tauri 2.x 应用。前端是**纯静态** HTML/CSS/JS(无打包器),由 Tauri 直接服务;Rust 后端通过官方 `sherpa-onnx` crate 静态链接推理,把 f32 PCM 编码成 WAV 写入 app cache,返回路径给前端用 asset protocol 播放。

**Tech Stack:** Tauri 2.12 · `sherpa-onnx` crate v1.13.8(static)· KittenTTS nano v0.2 · 原生 ES module 前端

**测试策略:** 用户明确要求不做自动化测试套件。因此:纯函数模块(WAV 编码)用 `cargo test` 覆盖(零额外依赖,`cargo test` 是 Rust 工具链自带);其余一律用**手动验证**,每步给出明确的预期现象。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `app/package.json` | 只有 `@tauri-apps/cli` 和 `@tauri-apps/api`,无打包器 |
| `app/src/index.html` | 界面骨架(移植自浏览器版) |
| `app/src/styles.css` | 设计系统(移植自浏览器版的 CSS 变量) |
| `app/src/main.js` | UI 绑定 + chunker + 播放队列 + `invoke` 调用 |
| `app/src-tauri/Cargo.toml` | Rust 依赖 |
| `app/src-tauri/tauri.conf.json` | 窗口、asset protocol、resources 配置 |
| `app/src-tauri/src/main.rs` | Tauri 入口 + 命令注册 |
| `app/src-tauri/src/tts.rs` | sherpa-onnx 引擎封装(加载 + 合成) |
| `app/src-tauri/src/wav.rs` | f32 PCM → WAV 字节(纯函数,带测试) |
| `app/src-tauri/models/` | 模型文件(git 忽略,由脚本生成) |
| `app/scripts/prepare-model.sh` | 从 `.models/` 复制并裁剪模型 |
| `app/icons/` | 应用图标 |

**不引入**:npm 打包器、前端框架、UI 组件库。

---

## Task 1: 项目脚手架与图标

**Files:**
- Create: `app/package.json`, `app/src/index.html`, `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/build.rs`, `app/src-tauri/src/main.rs`, `app/icons/icon.png`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p app/src app/src-tauri/src app/src-tauri/capabilities app/icons app/scripts
```

- [ ] **Step 2: 生成应用图标**

Tauri 打包必须有图标。用 Python 内置 zlib 手写一张 1024×1024 的 PNG(不依赖 PIL):

```bash
python3 - <<'PY'
import zlib, struct
W = H = 1024
BG = (28, 28, 32)      # 深色底
FG = (109, 141, 255)   # 与界面主色一致
def px(x, y):
    # 居中的圆角方块 + 中间一个模拟声波的竖条
    cx, cy, r = W//2, H//2, 340
    if (x-cx)**2 + (y-cy)**2 <= r*r:
        if abs(x-cx) <= 40 and abs(y-cy) <= 200:
            return BG
        if abs(abs(x-cx) - 150) <= 30 and abs(y-cy) <= 130:
            return BG
        return FG
    return BG
raw = b''
for y in range(H):
    raw += b'\x00' + b''.join(bytes(px(x, y)) for x in range(W))
def chunk(t, d):
    c = struct.pack('>I', len(d)) + t + d
    return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9))
       + chunk(b'IEND', b''))
open('app/icons/icon.png', 'wb').write(png)
print('图标已生成:', len(png), 'bytes')
PY
```

- [ ] **Step 3: 写 package.json**

`app/package.json`:

```json
{
  "name": "tts-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  }
}
```

- [ ] **Step 4: 写 Cargo.toml**

`app/src-tauri/Cargo.toml`:

```toml
[package]
name = "tts-app"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sherpa-onnx = "1.13.8"

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

**`protocol-asset` feature 是必需的** —— 没有它 `convertFileSrc()` 生成的字不会被 WebView 加载。

- [ ] **Step 5: 写 build.rs**

`app/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 6: 写 tauri.conf.json**

`app/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "TTS",
  "version": "0.1.0",
  "identifier": "com.jaelynwong.ttsapp",
  "build": {
    "frontendDist": "../src"
  },
  "app": {
    "windows": [
      {
        "title": "文字转语音",
        "width": 720,
        "height": 700,
        "minWidth": 420,
        "minHeight": 480
      }
    ],
    "security": {
      "csp": "default-src 'self'; media-src 'self' asset: http://asset.localhost blob:; style-src 'self' 'unsafe-inline'",
      "assetProtocol": {
        "enable": true,
        "scope": ["$APPCACHE/**"]
      }
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg"],
    "icon": ["icons/icon.png"],
    "resources": ["models/kitten-nano-en-v0_2-fp16/"]
  }
}
```

**注意 `"frontendDist": "../src"` 没有配 `devUrl`** —— 这样 Tauri 直接服务静态目录,不需要任何前端构建步骤。

- [ ] **Step 7: 写最小 main.rs**

`app/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 8: 写占位 index.html**

`app/src/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>文字转语音</title>
</head>
<body>
<h1>脚手架就绪</h1>
</body>
</html>
```

- [ ] **Step 9: 创建空的模型目录**

`tauri.conf.json` 的 `resources` 指向一个还不存在的目录会导致构建失败,先建好占位:

```bash
mkdir -p app/src-tauri/models/kitten-nano-en-v0_2-fp16
touch app/src-tauri/models/kitten-nano-en-v0_2-fp16/.gitkeep
```

- [ ] **Step 10: 安装依赖**

```bash
cd app && npm install
```

- [ ] **Step 11: 验证窗口能起来**

Run: `cd app && npm run dev`

Expected: 弹出一个 720×700 的窗口,标题「文字转语音」,内容显示「脚手架就绪」。首次编译 Rust 依赖需要几分钟。

按 `Cmd+Q` 或关掉窗口结束。**如果卡在编译错误,先解决再继续**。

- [ ] **Step 12: 提交**

```bash
git add app/package.json app/package-lock.json app/src app/src-tauri app/icons
git commit -m "feat(app): Tauri 项目脚手架"
```

---

## Task 2: 模型准备脚本

**Files:**
- Create: `app/scripts/prepare-model.sh`
- Create: `app/src-tauri/models/kitten-nano-en-v0_2-fp16/`(由脚本生成)
- Create: `.gitignore`

- [ ] **Step 1: 写 .gitignore**

仓库根目录 `.gitignore`:

```
# 模型文件不进版本库(24.5MB 二进制,由 scripts/prepare-model.sh 生成)
app/src-tauri/models/**/*.onnx
app/src-tauri/models/**/*.bin
app/src-tauri/models/**/*.txt
app/src-tauri/models/**/espeak-ng-data/

# 下载缓存
.models/

# node
node_modules/
```

- [ ] **Step 2: 写模型准备脚本**

`app/scripts/prepare-model.sh`:

```bash
#!/bin/bash
# 从仓库根的 .models/ 复制 Kitten 模型并裁剪 espeak-ng-data。
# 裁剪依据:官方 espeak-ng-data 含 113 个语言词典共 17MB,英文模型只需要其中英语相关部分。
# 白名单经实测:数字/货币/日期、缩写、邮箱电话等文本均正常合成。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/.models/kitten-nano-en-v0_2-fp16"
DST="$ROOT/app/src-tauri/models/kitten-nano-en-v0_2-fp16"

if [ ! -d "$SRC" ]; then
  echo "错误:找不到源模型目录 $SRC" >&2
  echo "请先下载 kitten-nano-en-v0_2-fp16(HuggingFace: csukuangfj/kitten-nano-en-v0_2-fp16)" >&2
  exit 1
fi

echo "源: $SRC"
echo "目标: $DST"
rm -rf "$DST"
mkdir -p "$DST/espeak-ng-data"

# 1) 模型本体
cp "$SRC/model.fp16.onnx" "$DST/"
cp "$SRC/voices.bin" "$DST/"
cp "$SRC/tokens.txt" "$DST/"

# 2) 裁剪 espeak-ng-data:只保留英文需要的
cd "$SRC/espeak-ng-data"
for f in phondata phontab phonindex intonations en_dict; do
  [ -f "$f" ] && cp "$f" "$DST/espeak-ng-data/"
done
cp -R lang voices "$DST/espeak-ng-data/"
cd "$ROOT"

# 3) 清掉 macOS 的 .DS_Store(会让 app 签名变慢)
find "$DST" -name '.DS_Store' -delete

echo
echo "=== 结果 ==="
echo "文件数: $(find "$DST" -type f | wc -l | tr -d ' ')"
echo "体积:   $(du -sh "$DST" | cut -f1)"
echo "预期:   约 24.5MB / 约 240 个文件"
```

- [ ] **Step 3: 运行脚本**

```bash
chmod +x app/scripts/prepare-model.sh && app/scripts/prepare-model.sh
```

Expected:
```
文件数: 约 240
体积:   约 24.5M
```

- [ ] **Step 4: 验证裁剪结果能真正合成**

用已在 `/tmp/kokoro-test` 装好的 Node 运行时验证裁剪后的模型可用(这一步是为了确认白名单没漏文件):

```bash
cd /tmp/kokoro-test && node gen2.js kitten "I have two pencils, three pens and an eraser in it." "1" "slimcheck" 2>&1 | grep -v "Unknown token"
```

把 `gen2.js` 里的 kitten 模型目录临时指向新位置,或直接跑一段临时脚本:

```bash
cd /tmp/kokoro-test && node -e "
const sherpa = require('sherpa-onnx-node');
const path = require('path');
const D = '/Users/jaelynwong/Code/tts/app/src-tauri/models/kitten-nano-en-v0_2-fp16';
const tts = new sherpa.OfflineTts({ model: { kitten: {
  model: path.join(D,'model.fp16.onnx'), voices: path.join(D,'voices.bin'),
  tokens: path.join(D,'tokens.txt'), dataDir: path.join(D,'espeak-ng-data'),
}, numThreads: 2, provider: 'cpu' } });
for (const t of ['Hello, this is a test.', 'The price is \$25.50 on January 3rd, 2026.']) {
  const a = tts.generate({ text: t, sid: 1, speed: 1.2 });
  console.log('  OK', (a.samples.length/a.sampleRate).toFixed(2)+'s', '|', t);
}
" 2>&1 | grep -viE "unknown token|skip unknown"
```

Expected: 两行 `OK`,无报错。

- [ ] **Step 5: 提交**

```bash
git add .gitignore app/scripts/prepare-model.sh
git commit -m "feat(app): 模型准备脚本(含 espeak 裁剪)"
```

---

## Task 3: WAV 编码模块(带单元测试)

**Files:**
- Create: `app/src-tauri/src/wav.rs`
- Modify: `app/src-tauri/src/main.rs`(加 `mod wav;`)

- [ ] **Step 1: 写失败的测试**

创建 `app/src-tauri/src/wav.rs`:

```rust
//! f32 PCM 采样 → 16-bit 单声道 WAV 字节。

pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_is_correct() {
        let wav = encode_wav(&[0.0; 4], 24000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");
        // RIFF 块大小 = 36 + 数据长度
        let riff_size = u32::from_le_bytes(wav[4..8].try_into().unwrap());
        assert_eq!(riff_size, 36 + 8);
        // 数据长度字段
        let data_size = u32::from_le_bytes(wav[40..44].try_into().unwrap());
        assert_eq!(data_size, 8);
    }

    #[test]
    fn format_fields_match_16bit_mono() {
        let wav = encode_wav(&[0.0], 24000);
        assert_eq!(u16::from_le_bytes(wav[20..22].try_into().unwrap()), 1);      // PCM
        assert_eq!(u16::from_le_bytes(wav[22..24].try_into().unwrap()), 1);      // 单声道
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 24000);  // 采样率
        assert_eq!(u32::from_le_bytes(wav[28..32].try_into().unwrap()), 48000);  // 字节率
        assert_eq!(u16::from_le_bytes(wav[32..34].try_into().unwrap()), 2);      // 块对齐
        assert_eq!(u16::from_le_bytes(wav[34..36].try_into().unwrap()), 16);     // 位深
    }

    #[test]
    fn total_length_is_44_plus_2_per_sample() {
        let wav = encode_wav(&[0.0; 1000], 24000);
        assert_eq!(wav.len(), 44 + 2000);
    }

    #[test]
    fn samples_are_scaled_and_clamped() {
        let wav = encode_wav(&[0.0, 1.0, -1.0, 2.0, -2.0], 24000);
        let s = |i: usize| i16::from_le_bytes(wav[44 + i * 2..46 + i * 2].try_into().unwrap());
        assert_eq!(s(0), 0);
        assert_eq!(s(1), 32767);
        assert_eq!(s(2), -32767);
        assert_eq!(s(3), 32767, "超过 1.0 应削波而非回绕");
        assert_eq!(s(4), -32767);
    }

    #[test]
    fn empty_input_produces_header_only() {
        let wav = encode_wav(&[], 24000);
        assert_eq!(wav.len(), 44);
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd app/src-tauri && cargo test
```

Expected: 编译通过但 5 个测试全部 panic(`not implemented`)。

- [ ] **Step 3: 实现**

替换 `wav.rs` 顶部的函数体(保留测试):

```rust
pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    const HEADER: usize = 44;
    let data_len = (samples.len() * 2) as u32;
    let mut buf = Vec::with_capacity(HEADER + data_len as usize);

    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());          // fmt 块大小
    buf.extend_from_slice(&1u16.to_le_bytes());           // PCM
    buf.extend_from_slice(&1u16.to_le_bytes());           // 单声道
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // 字节率 = 采样率 × 块对齐
    buf.extend_from_slice(&2u16.to_le_bytes());           // 块对齐 = 声道 × 位深/8
    buf.extend_from_slice(&16u16.to_le_bytes());          // 位深
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());

    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        buf.extend_from_slice(&v.to_le_bytes());
    }
    buf
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd app/src-tauri && cargo test
```

Expected: `test result: ok. 5 passed`

- [ ] **Step 5: 在 main.rs 中注册模块**

`app/src-tauri/src/main.rs` 顶部加:

```rust
mod wav;
```

- [ ] **Step 6: 提交**

```bash
git add app/src-tauri/src/wav.rs app/src-tauri/src/main.rs
git commit -m "feat(app): WAV 编码模块"
```

---

## Task 4: TTS 引擎封装

**Files:**
- Create: `app/src-tauri/src/tts.rs`
- Modify: `app/src-tauri/src/main.rs`

**为什么单独一步:** `sherpa_onnx::OfflineTts` 是否满足 `Send + Sync`(能否放进 Tauri 的共享状态)需要实测确认。这个任务先用一个最小的二进制验证,再决定状态管理方式。

- [ ] **Step 1: 写引擎封装**

`app/src-tauri/src/tts.rs`:

```rust
//! sherpa-onnx Kitten 引擎封装。

use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKittenModelConfig,
    OfflineTtsModelConfig,
};
use std::path::Path;
use std::sync::Mutex;

pub struct Engine {
    model_dir: std::path::PathBuf,
    /// sherpa-onnx 的 OfflineTts 不保证 Sync,用 Mutex 串行化访问。
    inner: Mutex<Option<OfflineTts>>,
}

pub struct SynthResult {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

impl Engine {
    pub fn new(model_dir: impl AsRef<Path>) -> Self {
        Self { model_dir: model_dir.as_ref().to_path_buf(), inner: Mutex::new(None) }
    }

    /// 首次调用时加载模型(约 1.5s),之后复用。
    fn ensure_loaded(&self, guard: &mut Option<OfflineTts>) -> Result<(), String> {
        if guard.is_some() {
            return Ok(());
        }
        let d = &self.model_dir;
        let config = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                kitten: OfflineTtsKittenModelConfig {
                    model: Some(d.join("model.fp16.onnx").to_string_lossy().into_owned()),
                    voices: Some(d.join("voices.bin").to_string_lossy().into_owned()),
                    tokens: Some(d.join("tokens.txt").to_string_lossy().into_owned()),
                    data_dir: Some(d.join("espeak-ng-data").to_string_lossy().into_owned()),
                    ..Default::default()
                },
                num_threads: 2,
                provider: Some("cpu".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        *guard = Some(OfflineTts::create(&config).ok_or("创建 TTS 引擎失败")?);
        Ok(())
    }

    pub fn synth(&self, text: &str, sid: i32, speed: f32) -> Result<SynthResult, String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        self.ensure_loaded(&mut guard)?;
        let tts = guard.as_ref().ok_or("引擎未初始化")?;

        let gen_cfg = GenerationConfig { sid, speed, ..Default::default() };
        let audio = tts
            .generate_with_config(text, &gen_cfg, None)
            .ok_or("合成失败")?;

        Ok(SynthResult {
            samples: audio.samples,
            sample_rate: audio.sample_rate as u32,
        })
    }
}

/// 编译期断言:Engine 必须能跨线程共享(Tauri 的状态要求)。
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Engine>();
};
```

**如果编译时 `assert_send_sync::<Engine>()` 报错**,说明 `OfflineTts` 不是 `Send`。改用「专用线程 + mpsc 通道」模式:在 `Engine::new` 里起一个线程持有 `OfflineTts`,命令通过 channel 发请求、收结果。届时把这一步的实现和验证结果记录下来,再继续。

- [ ] **Step 2: 编译验证**

```bash
cd app/src-tauri && cargo build 2>&1 | tail -20
```

Expected: 编译通过。若 `assert_send_sync` 报错,按 Step 1 的说明改用线程 + 通道方案。

- [ ] **Step 3: 写一个临时集成测试验证真实合成**

在 `app/src-tauri/src/main.rs` 里临时加一个可由环境变量触发的自检(做完即删):

```rust
mod tts;
mod wav;

fn main() {
    // 临时自检:SHERPA_SELFTEST=1 cargo run 会合成一段音频后退出
    if std::env::var("SHERPA_SELFTEST").is_ok() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("models/kitten-nano-en-v0_2-fp16");
        let engine = tts::Engine::new(&dir);
        let r = engine.synth("Hello, this is a self test.", 1, 1.2)
            .expect("合成失败");
        let wav = wav::encode_wav(&r.samples, r.sample_rate);
        std::fs::write("/tmp/selftest.wav", &wav).unwrap();
        println!("OK: {} samples @ {}Hz → /tmp/selftest.wav ({} bytes)",
                 r.samples.len(), r.sample_rate, wav.len());
        return;
    }

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Run:
```bash
cd app/src-tauri && SHERPA_SELFTEST=1 cargo run 2>&1 | tail -3
```

Expected: `OK: <约 60000> samples @ 24000Hz → /tmp/selftest.wav`

- [ ] **Step 4: 听一下自检产物**

```bash
afplay /tmp/selftest.wav
```

Expected: 听到一句英文 "Hello, this is a self test."(Jasper 男声)。

- [ ] **Step 5: 提交**

```bash
git add app/src-tauri/src/tts.rs app/src-tauri/src/main.rs
git commit -m "feat(app): sherpa-onnx 引擎封装"
```

---

## Task 5: Tauri 命令与状态

**Files:**
- Modify: `app/src-tauri/src/main.rs`

- [ ] **Step 1: 实现 synth 命令**

`main.rs` 替换为(移除上一任务的临时自检):

```rust
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

    let name = format!(
        "tts-{}.wav",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let path = state.cache_dir.join(name);
    std::fs::write(&path, &bytes).map_err(|e| format!("写文件失败: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let model_dir = app
                .path()
                .resolve("models/kitten-nano-en-v0_2_fp16", tauri::path::BaseDirectory::Resource)
                .or_else(|_| {
                    // 开发模式下模型在 src-tauri/models/,不在 Resource 目录
                    Ok::<_, tauri::Error>(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("models/kitten-nano-en-v0_2-fp16"))
                })
                .expect("无法定位模型目录");
            let cache_dir = app.path().app_cache_dir().expect("无法定位缓存目录");
            std::fs::create_dir_all(&cache_dir).ok();
            app.manage(AppState {
                engine: tts::Engine::new(model_dir),
                cache_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![synth])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**注意** `resolve()` 里写的是打包后的资源路径 `models/kitten-nano-en-v0_2_fp16`(下划线),而开发模式下回退到 `models/kitten-nano-en-v0_2-fp16`(连字符)。Tauri 打包 resources 时会把目录名里的连字符规范化,**这个差异必须实测确认** —— 在 Step 4 里两种模式都要跑。

- [ ] **Step 2: 编译**

```bash
cd app/src-tauri && cargo build 2>&1 | tail -10
```

Expected: 编译通过。

- [ ] **Step 3: 注册 asset protocol 权限**

创建 `app/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "默认权限",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 4: 验证两种模式都能定位模型**

Run: `cd app && npm run dev`

然后在窗口里按 `Cmd+Option+I` 打开开发者工具,在 Console 里执行:

```js
await window.__TAURI__.core.invoke('synth', { text: 'Hello world.', sid: 1, speed: 1.2 })
```

Expected: 返回一个 `/var/folders/.../tts-<数字>.wav` 路径,无报错。

再把返回的路径用 `afplay` 播一下确认有声音。

- [ ] **Step 5: 提交**

```bash
git add app/src-tauri/src/main.rs app/src-tauri/capabilities
git commit -m "feat(app): synth 命令与引擎状态"
```

---

## Task 6: 前端界面移植

**Files:**
- Create: `app/src/styles.css`
- Modify: `app/src/index.html`

- [ ] **Step 1: 移植样式**

把浏览器版 `index.html` 里 `<style>` 标签内的**全部内容**复制到 `app/src/styles.css`(CSS 变量、深浅色媒体查询、布局、按钮、滑块、下拉、`#count.limit` 等全部保留)。

追加两条桌面端专用规则:

```css
/* 桌面应用:禁用文本选择拖拽,更像原生 */
body { user-select: none; }
textarea, #status { user-select: text; }
```

- [ ] **Step 2: 写界面骨架**

`app/src/index.html` 替换为(结构沿用浏览器版,去掉不支持的部分):

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>文字转语音</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main>
  <h1>文字转语音</h1>
  <div class="card">
    <textarea id="text" maxlength="5000"
      placeholder="在这里输入或粘贴英文文字…"></textarea>
    <div class="meta">
      <span id="count">0 / 5000 字</span>
      <span id="engine">引擎:Kitten nano · 本地离线</span>
    </div>
    <div class="row">
      <label for="rate">语速</label>
      <input type="range" id="rate" min="0.5" max="2" step="0.1" value="1.2">
      <output id="rateValue" title="点击复位到 1.2x">1.2x</output>
    </div>
    <div class="row">
      <label for="voice">声音</label>
      <select id="voice"></select>
    </div>
    <div class="actions">
      <button id="play" disabled>▶ 播放</button>
      <button id="pause" hidden>⏸ 暂停</button>
      <button id="stop" class="ghost" disabled>⏹ 停止</button>
      <button id="export" class="ghost" disabled>⤓ 导出</button>
    </div>
    <p id="status" role="status"></p>
  </div>
</main>
<script type="module" src="main.js"></script>
</body>
</html>
```

**与浏览器版的差异**:文本框占位符改成「英文」(模型只支持英文);语速上限从 3.0 改为 **2.0**、**默认值 1.2**;移除了「导出仅桌面 Chrome」那类提示。

- [ ] **Step 3: 写最小 main.js**

`app/src/main.js`:

```js
// 音色表:顺序对应模型 sid 0-7
const VOICES = [
  { sid: 0, name: 'Bella',  gender: '女声' },
  { sid: 1, name: 'Jasper', gender: '男声' },
  { sid: 2, name: 'Luna',   gender: '女声' },
  { sid: 3, name: 'Bruno',  gender: '男声' },
  { sid: 4, name: 'Rosie',  gender: '女声' },
  { sid: 5, name: 'Hugo',   gender: '男声' },
  { sid: 6, name: 'Kiki',   gender: '女声' },
  { sid: 7, name: 'Leo',    gender: '男声' },
];

const voiceSelect = document.getElementById('voice');
for (const v of VOICES) {
  const o = document.createElement('option');
  o.value = String(v.sid);
  o.textContent = `${v.name} · ${v.gender}`;
  voiceSelect.append(o);
}
voiceSelect.value = '1';   // 默认 Jasper
```

- [ ] **Step 4: 验证界面**

Run: `cd app && npm run dev`

Expected: 窗口里显示完整界面 —— 标题、文本框、语速滑块(停在偏左 1.2x)、8 个音色的下拉(默认选中 Jasper · 男声)、四个按钮(播放/导出禁用)。

切换系统深浅色,界面应跟随。

- [ ] **Step 5: 提交**

```bash
git add app/src/styles.css app/src/index.html app/src/main.js
git commit -m "feat(app): 界面移植"
```

---

## Task 7: 合成分句与队列播放

**Files:**
- Modify: `app/src/main.js`

**设计要点:** 复用浏览器版的 `chunker`(纯函数,与引擎无关)和 `generation` 令牌模式(防旧回调污染新播放),但音源从 `speechSynthesis` 换成 `invoke('synth')` + `<audio>`。**预生成 2–3 句**填充缓冲,消除句间空隙。

- [ ] **Step 1: 追加 chunker**

在 `main.js` 里追加(从浏览器版原样移植):

```js
const MAX_CHARS = 5000;
const MAX_CHUNK = 200;
const MIN_CHUNK = 60;
const SENTENCE_END = '.!?;';

function chunk(text) {
  const out = [];
  let buf = '';
  for (const ch of String(text)) {
    if (ch === '\n') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
    const tooLong = buf.length >= MAX_CHUNK;
    const endsSentence = SENTENCE_END.includes(ch) && buf.length >= MIN_CHUNK;
    if (tooLong || endsSentence) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
```

- [ ] **Step 2: 追加播放器**

```js
const { invoke, convertFileSrc } = window.__TAURI__.core;

const PRE_BUFFER = 2;   // 预生成句数

const player = {
  queue: [],
  index: 0,
  state: 'idle',          // idle | playing | paused
  sid: 1,
  speed: 1.2,
  generation: 0,
  audio: null,            // 当前 <audio>
  cache: new Map(),       // index -> Promise<url>
  onStateChange: null,

  setState(s) {
    this.state = s;
    if (this.onStateChange) this.onStateChange(s);
  },

  // 合成第 i 句,返回可播放的 URL;结果缓存避免重复合成
  prepare(i) {
    if (i >= this.queue.length) return null;
    if (!this.cache.has(i)) {
      this.cache.set(i, (async () => {
        const path = await invoke('synth', {
          text: this.queue[i], sid: this.sid, speed: this.speed,
        });
        return convertFileSrc(path);
      })());
    }
    return this.cache.get(i);
  },

  async start(text) {
    this._reset();
    const gen = this.generation;
    this.queue = chunk(text);
    this.index = 0;
    if (!this.queue.length) { this.setState('idle'); return; }
    this.setState('playing');
    await this.playCurrent(gen);
  },

  async playCurrent(gen) {
    if (gen !== this.generation) return;
    if (this.index >= this.queue.length) { this.setState('idle'); return; }

    // 预生成后续几句,填充缓冲
    for (let k = 0; k < PRE_BUFFER; k++) this.prepare(this.index + k);

    let url;
    try {
      url = await this.prepare(this.index);
    } catch (e) {
      if (gen === this.generation) {
        setStatus('合成失败:' + e, true);
        this.setState('idle');
      }
      return;
    }
    if (gen !== this.generation) return;   // 等待期间被 stop()

    const audio = new Audio(url);
    this.audio = audio;
    audio.onended = () => {
      if (gen !== this.generation) return;
      this.index++;
      this.playCurrent(gen);
    };
    audio.onerror = () => {
      if (gen !== this.generation) return;
      setStatus('播放失败', true);
      this.setState('idle');
    };
    audio.play().catch((e) => {
      if (gen !== this.generation) return;
      setStatus('播放被拒绝:' + e.message, true);
      this.setState('idle');
    });
  },

  pause() {
    if (this.state !== 'playing') return;
    if (this.audio) this.audio.pause();
    this.setState('paused');
  },

  resume() {
    if (this.state !== 'paused') return;
    if (this.audio) this.audio.play();
    this.setState('playing');
  },

  // 内部:清空队列并让所有旧回调失效,不通知 UI
  // (与浏览器版同样的做法:start() 内部调用它,避免闪一次多余的 idle 状态)
  _reset() {
    this.generation++;
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this.queue = [];
    this.index = 0;
    this.cache.clear();
  },

  stop() {
    this._reset();
    this.setState('idle');
  },
};
```

**说明**:`generation` 令牌照搬浏览器版的做法 —— 每次 `start()`/`stop()` 自增,所有异步回调先比对令牌再行动,避免"停止后仍继续播下一句"。`audio.url` 指向缓存文件,不 revoke(文件在 app cache 里,由系统管理)。

- [ ] **Step 3: 接线 UI**

```js
const textEl = document.getElementById('text');
const countEl = document.getElementById('count');
const statusEl = document.getElementById('status');
const btnPlay = document.getElementById('play');
const btnPause = document.getElementById('pause');
const btnStop = document.getElementById('stop');
const btnExport = document.getElementById('export');
const rateEl = document.getElementById('rate');
const rateValueEl = document.getElementById('rateValue');

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', !!isError);
}

function refresh() {
  const n = textEl.value.length;
  countEl.textContent = n + ' / ' + MAX_CHARS + ' 字';
  countEl.classList.toggle('limit', n >= MAX_CHARS);
  btnPlay.disabled = !textEl.value.trim() || player.state !== 'idle';
  btnExport.disabled = btnPlay.disabled;
}

player.onStateChange = (state) => {
  const active = state === 'playing' || state === 'paused';
  btnPlay.hidden = active;
  btnPause.hidden = !active;
  btnPause.textContent = state === 'paused' ? '▶ 继续' : '⏸ 暂停';
  btnStop.disabled = state === 'idle';
  textEl.readOnly = state !== 'idle';
  refresh();
};

function applyRate(value) {
  const rate = Math.min(2, Math.max(0.5, Number(value) || 1.2));
  player.speed = rate;
  rateValueEl.textContent = rate.toFixed(1) + 'x';
}
rateEl.addEventListener('input', () => applyRate(rateEl.value));
rateValueEl.addEventListener('click', () => { rateEl.value = '1.2'; applyRate(1.2); });

btnPlay.addEventListener('click', () => {
  const text = textEl.value.trim();
  if (!text) return;
  setStatus('');
  player.sid = Number(voiceSelect.value);
  player.start(text);
});
btnPause.addEventListener('click', () => {
  if (player.state === 'playing') player.pause();
  else if (player.state === 'paused') player.resume();
});
btnStop.addEventListener('click', () => player.stop());
voiceSelect.addEventListener('change', () => { player.sid = Number(voiceSelect.value); });
textEl.addEventListener('input', refresh);

applyRate(rateEl.value);
refresh();
```

**语速与音色的生效时机**:`player.speed` / `player.sid` 在每次 `prepare()` 时读取,所以**播放中改动会从下一句起生效**,与浏览器版行为一致。

- [ ] **Step 4: 偏好记忆与快捷键**

在 `main.js` 末尾(`applyRate(rateEl.value); refresh();` 之后)追加:

```js
// ---- 偏好记忆(WebView 的 localStorage 在 Tauri 里持久化)----
const STORE = {
  read() {
    try { return JSON.parse(localStorage.getItem('tts.prefs') || '{}'); }
    catch { return {}; }
  },
  write(patch) {
    try { localStorage.setItem('tts.prefs', JSON.stringify({ ...this.read(), ...patch })); }
    catch { /* 受限环境静默失败 */ }
  }
};

const saved = STORE.read();
if (saved.sid != null && VOICES.some(v => v.sid === saved.sid)) {
  voiceSelect.value = String(saved.sid);
  player.sid = saved.sid;
}
if (saved.rate) {
  rateEl.value = String(saved.rate);
  applyRate(saved.rate);
}
rateEl.addEventListener('change', () => STORE.write({ rate: player.speed }));
voiceSelect.addEventListener('change', () => STORE.write({ sid: player.sid }));

// ---- 快捷键 ----
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const inControl = tag === 'textarea' || tag === 'input'
    || tag === 'select' || tag === 'button';

  // Esc:任何位置都能停止朗读
  if (e.key === 'Escape' && player.state !== 'idle') {
    player.stop();
    e.preventDefault();
    return;
  }
  // 空格:只在未聚焦控件时当作播放 / 暂停
  if (e.code === 'Space' && !inControl) {
    e.preventDefault();
    if (player.state === 'idle') btnPlay.click();
    else btnPause.click();
  }
});
```

- [ ] **Step 5: 验证**

Run: `cd app && npm run dev`

1. 输入 `I have two pencils, three pens and an eraser in it.` → 点播放 → 应听到 Jasper 男声朗读
2. 拖语速到 0.5x 后重播 → 明显变慢
3. 播放途中拖语速 → **下一句**起语速改变
4. 点停止 → **等 3 秒确认没有继续念下一句**
5. 换成 Luna(sid 2)重播 → 音色改变
6. 贴一段 600 字符以上的英文 → 能连贯读完,句间无明显空隙(预缓冲生效)
7. 把语速调到 1.6x、音色换成 Luna,退出应用重开 → 滑块和音色应保持上次的选择
8. 按空格 → 开始/暂停;按 Esc → 立即停止;在文本框里按空格 → 正常输入空格,不触发播放
9. 点 `1.2x` 数值 → 滑块复位

- [ ] **Step 6: 提交**

```bash
git add app/src/main.js
git commit -m "feat(app): 分句队列播放、语速音色控制、偏好记忆与快捷键"
```

---

## Task 8: 导出 WAV

**Files:**
- Modify: `app/src/main.js`
- Modify: `app/src-tauri/Cargo.toml`, `app/src-tauri/src/main.rs`, `app/src-tauri/capabilities/default.json`

**方案:** 用 Tauri 的 dialog 插件让用户选保存位置。导出走**整段文本一次性合成**(而不是拼接队列里的分句缓存),这样得到的是一段连续的音频。

- [ ] **Step 1: 加 dialog 插件**

```bash
cd app && npm install @tauri-apps/plugin-dialog
cd src-tauri && cargo add tauri-plugin-dialog
```

`app/src-tauri/capabilities/default.json` 的 `permissions` 数组加上 `"dialog:default"`。

`main.rs` 的 builder 链上插入 `.plugin(tauri_plugin_dialog::init())`(在 `.setup()` 之前)。

- [ ] **Step 2: 加 Rust 命令 save_wav**

在 `main.rs` 里追加:

```rust
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
```

注册到 `generate_handler![synth, save_wav]`。

- [ ] **Step 3: 前端接线导出**

`main.js` 顶部加:

```js
const { save } = window.__TAURI__.dialog;
```

追加按钮逻辑:

```js
btnExport.addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (!text) return;
  const sid = Number(voiceSelect.value);

  const dest = await save({
    title: '导出 WAV',
    defaultPath: 'speech.wav',
    filters: [{ name: 'WAV 音频', extensions: ['wav'] }],
  });
  if (!dest) return;   // 用户取消

  btnExport.disabled = true;
  setStatus('正在合成整段音频…');
  try {
    await invoke('save_wav', { text, sid, speed: player.speed, dest });
    setStatus('已导出:' + dest);
  } catch (e) {
    setStatus('导出失败:' + e, true);
  } finally {
    refresh();
  }
});
```

- [ ] **Step 4: 验证**

Run: `cd app && npm run dev`

1. 输入一段英文 → 点「导出」→ 出现系统保存对话框 → 存到桌面
2. 用 `afplay ~/Desktop/speech.wav` 或双击播放 → 内容与界面里播放的一致
3. 导出**长文本**(600 字符以上)→ 导出的是**一整段连续音频**,不是拼接的碎片
4. 导出时语速滑块设成 0.5x → 导出的文件也是慢速的
5. 在保存对话框点取消 → 不应有任何报错

- [ ] **Step 5: 提交**

```bash
git add app/src/main.js app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/src/main.rs app/src-tauri/capabilities/default.json app/package.json app/package-lock.json
git commit -m "feat(app): 导出 WAV 文件"
```

---

## Task 9: 打包构建

**Files:**
- Modify: `app/src-tauri/tauri.conf.json`(如需)

- [ ] **Step 1: 生成完整图标集**

```bash
cd app && npx tauri icon icons/icon.png
```

Expected: `icons/` 下生成 `icon.icns`、`icon.ico`、各尺寸 PNG。

- [ ] **Step 2: 构建**

```bash
cd app && npm run build 2>&1 | tail -20
```

Expected: 产出 `app/src-tauri/target/release/bundle/macos/TTS.app` 和 `.../dmg/TTS_0.1.0_aarch64.dmg`

- [ ] **Step 3: 验证安装包体积**

```bash
du -sh app/src-tauri/target/release/bundle/macos/TTS.app
du -sh app/src-tauri/target/release/bundle/dmg/*.dmg
```

Expected: `.app` 约 30–40MB(24.5MB 模型 + 二进制 + 运行时)。

- [ ] **Step 4: 验证独立运行**

```bash
open app/src-tauri/target/release/bundle/macos/TTS.app
```

Expected: 应用启动,**不需要** `npm run dev`,完全独立。重复 Task 7 的验证步骤 1–6 确认功能完整。

**重点验证**:打包后 `BaseDirectory::Resource` 的路径解析是否命中模型 —— 如果启动就报「无法定位模型目录」或合成失败,说明 `resolve()` 的路径写错了(参考 Task 5 Step 5 的连字符/下划线差异,用 `find TTS.app -name "*.onnx"` 看实际路径)。

- [ ] **Step 5: 提交**

```bash
git add app/icons app/src-tauri/tauri.conf.json
git commit -m "feat(app): 打包配置与图标"
```

---

## 自查记录

**Spec 覆盖检查**

| Spec 要求 | 对应任务 |
|---|---|
| Tauri 2 + sherpa-onnx 静态链接 | Task 1、Task 4 |
| Kitten nano 模型,裁剪后约 24.5MB | Task 2 |
| 语速 0.5–2.0x,默认 1.2x | Task 6、Task 7 |
| 8 个音色,默认 Jasper | Task 6 |
| 播放/暂停/停止 + 预生成缓冲 | Task 7 |
| 导出 WAV(全平台可用) | Task 8 |
| asset protocol 播放(非 IPC base64) | Task 5、Task 7 |
| 模型随安装包分发 | Task 2、Task 9 |
| 深浅色跟随系统 | Task 6 |
| 偏好记忆(语速 / 音色) | Task 7 Step 4 |
| 快捷键(空格 / Esc) | Task 7 Step 4 |
| 纯英文界面文案调整 | Task 6 |
| 桌面应用(非浏览器) | Task 9 |

**已知风险点(实现时必须实测)**

1. **`OfflineTts` 的 Send/Sync**(Task 4 Step 1)—— 编译期断言会暴露;不满足则改线程 + 通道。
2. **打包后模型路径**(Task 9 Step 4)—— resources 目录名的连字符/下划线规范化行为需实测。
3. **`build.rs` 下载 native lib 无校验和**(Task 1 Step 10)—— 若下载中断,删掉 `target/` 里对应的缓存重来;必要时用 `SHERPA_ONNX_LIB_DIR` 手工指向。

**超出本计划范围(后续阶段)**

- Windows 构建(GitHub Actions matrix)
- iOS/Android(需 shared 链接 + APK assets 适配)
- 应用签名与公证
