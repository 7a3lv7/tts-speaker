# 离线 TTS 桌面应用 — 设计文档

日期:2026-10-13
状态:已确认(桌面先行)
前置:本文档延续 `2026-10-13-tts-web-design.md`(浏览器版)。浏览器版用系统语音,本文档是用本地神经网络模型的独立应用。

## 目标

一个**跨平台、完全离线**的文字转语音桌面应用:文字进,语音出,可调语速、可选音色、可导出音频文件。不联网、不依赖系统语音。

目标平台:**macOS(先行)→ Windows → iOS/Android**。不含 Linux。

## 已确认的决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 模型 | KittenTTS nano v0.2 (fp16) | 实测 24.5MB,听感达标(用户已试听 8 个音色) |
| 音色 | 默认 Jasper (sid 1),其余 7 个可选 | 用户指定 |
| 应用框架 | Tauri 2.x | 用户指定;复用现有 Web 前端 |
| 推理引擎 | `sherpa-onnx` crate v1.13.8(静态链接) | 官方维护,进程内调用,已实测编译通过 |
| 音频通路 | Rust 写 WAV → asset protocol → `<audio>` | IPC base64 方案实测阻塞主线程 891ms |
| 平台分期 | 桌面先行,移动端独立阶段 | 移动端有 shared 链接 + APK assets 额外复杂度 |
| 中文支持 | **不支持** | Kitten 是纯英文模型,用户已知悉并接受 |

## 架构

```
┌─ 前端(复用现有 index.html 的 UI 与队列逻辑)────────────┐
│  文本框 · 语速滑块 · 8 音色下拉 · 播放/暂停/停止 · 导出    │
│  chunker(分句) → speaker(队列) → 预生成 2–3 句缓冲      │
└────────────┬────────────────────────────┬──────────────┘
             │ invoke("synth",            │ <audio src=
             │   {text, sid, speed})      │  convertFileSrc(path)>
             ↓                            ↑
┌─ Rust 后端(Tauri 命令)──────────────────────────────────┐
│  sherpa-onnx(静态链接,进程内)                          │
│  Kitten 模型 → f32 PCM → 写 WAV 到 app cache_dir        │
└─────────────────────────────────────────────────────────┘
              模型随安装包分发:src-tauri/models/ (~24.5MB)
```

### 数据流

1. 前端 `chunker` 把输入文本按标点切成句
2. 逐句 `invoke("synth", { text, sid, speed })`
3. Rust 侧 `OfflineTts::generate_with_config` 返回 `{ samples: Vec<f32>, sample_rate: i32 }`
4. 写成 16-bit PCM WAV 到 `app_cache_dir`
5. 返回路径,前端 `convertFileSrc()` → `<audio>` 播放
6. 队列在播放前预生成 2–3 句,消除句间空隙

## 功能规格

| 功能 | 说明 |
|---|---|
| 文字输入 | 复用现有 UI,5000 字上限 |
| 播放 / 暂停 / 停止 | 按句队列,暂停即停止当前句并保留队列位置 |
| 语速调节 | 0.5x–2.0x,步长 0.1,**默认 1.2x**(0.5–2.0 为实测验证过的区间,超出未经测试) |
| 音色选择 | 8 个(Bella/Jasper/Luna/Bruno/Rosie/Hugo/Kiki/Leo),默认 Jasper,记忆选择 |
| 导出 | 生成真正的 WAV 文件(本地合成,不再需要浏览器录制方案),全平台可用 |
| 深浅色 | 跟随系统(复用现有 CSS) |

**默认 1.2x 的依据**:实测 Kitten 朗读速度为 103ms/字符,正常英语朗读约 75–80ms/字符,默认偏慢约 30%。

## 实测数据(供实现参考)

| 指标 | 数值 |
|---|---|
| 模型体积 | `model.fp16.onnx` 22.7MB + 裁剪后 `espeak-ng-data` 1.8MB ≈ **24.5MB** |
| RTF(sid 0,英语) | 0.26–0.64(语速越低 RTF 越低;0.5x 时 0.26) |
| 语速线性度 | 0.5x→2.0x 时长比 3.7 倍(理论 4 倍),`speed` 参数真实生效 |
| 长文本 | 621 字符/10 句 → 64.1s 音频,RTF 0.415,无削波(峰值 0.861) |
| 内存占用 | 313MB(Node 进程含运行时;Tauri 侧预期更低) |
| 采样率 | 24000 Hz 单声道 |

### espeak-ng-data 裁剪(体积从 18MB → 1.8MB)

原始 `espeak-ng-data` 有 357 个文件、18MB,其中 `ru_dict` 8.1MB、`cmn_dict` 1.5MB 等 113 个语言词典对英文模型完全无用。

**保留白名单**(实测可正常工作):

```
phondata, phontab, phonindex, intonations, en_dict
lang/          (133 个文件, 532KB —— 实测保留后正常)
voices/        (105 个文件, 428KB —— 实测保留后正常)
```

已验证:裁剪后数字/货币/日期(`$25.50`、`January 3rd, 2026`、`9:30 AM`)、缩写(`Dr.`、`NASA`、`Ph.D.`)、邮箱电话等文本全部正常合成。注意引擎只强校验 `phondata`/`phontab`/`phonindex`/`intonations` 四个文件,`lang/` 和 `voices/` 是保守保留。

## 平台分期

### Phase 1:macOS(先行)

- 本地 `cargo tauri build` 出 .app / .dmg
- 验证全流程:合成、播放、语速、音色、导出
- 自用无需签名

### Phase 2:Windows

- GitHub Actions `tauri-action` matrix 原生构建
- 交叉编译已被排除:macOS→Windows 唯一路径 `cargo-xwin` 官方标注 highly experimental,且 sherpa-onnx 的 win-x64 静态库是 117MB 的 C++ 库,交叉编译不现实

### Phase 3:iOS / Android(独立阶段)

额外工作量(与桌面不共享):

- iOS 与 Android 上 sherpa-onnx **只支持 shared 链接**(桌面是 static),Cargo.toml 需 `default-features = false, features = ["shared"]`
- iOS 需把 `SherpaOnnxC.framework` 注册进 `bundle.iOS.frameworks`
- Android 的 `.so` 放 jniLibs
- **模型文件在 Android 上变成 APK assets**,路径前缀 `asset://localhost/`,**不能 `std::fs` 直读**,资源加载需抽象成一层

## 关键约束与风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 纯英文模型 | 无中文合成能力 | 已确认接受 |
| macOS 不签名 | 分发后用户看到"已损坏" | 自用无影响;分发需 Apple 开发者账号($99/年) |
| Windows 不签名 | SmartScreen 拦截 | 分发需代码签名证书 |
| `build.rs` 下载 native lib 无校验和、无原子重命名 | 中断的下载被永久复用 | CI 中用 `SHERPA_ONNX_ARCHIVE_DIR` 预置;或 `SHERPA_ONNX_LIB_DIR` 指向已解包目录 |
| macOS universal 构建 | build.rs 按 host triple 下载 `osx-arm64-static-lib`,universal 会失败 | 需 `SHERPA_ONNX_LIB_DIR` 指向 `osx-universal2-static-lib`;**此路径必须实测** |
| 安装包体积 | fp16 权重与词典已近似不可压,压缩收益仅几个百分点 | 按 ≈1:1(24.5MB)规划 |

## 为什么不用其他方案(调研结论)

- **Sidecar 调 CLI**:实测二进制符号表确认三个硬限制 —— 无 stdin(文本只能位置参数)、无 stdout 音频(只能写文件)、无流式。每句都要建进程 + 写临时文件,还要为各平台手工组装二进制与 rpath。
- **自己用 `ort`:** 需自行实现文本正规化、espeak-ng G2P、tokenizer、voices.bin 解析、Kitten 张量布局、波形后处理,等于重写 `offline-tts-kitten-model.cc`。
- **IPC 传音频**:base64 方案主线程阻塞 891ms、帧卡顿 1129ms;raw bytes 也有 1811ms 卡顿。asset protocol 接近零开销,且白送 HTTP Range(`<audio>` 可 seek)。**切勿 `return Vec<u8>`** —— serde 会序列化成 JSON 数字数组,6.3MB 膨胀到 22.5MB。
- **MSE / AudioWorklet 流式**:WAV/PCM 不被 MediaSource 支持,且各 WebView 支持度不一。按句合成 + 队列缓冲是真实项目(Voxify)的成熟做法。

## 许可证

- KittenTTS nano v0.2 = **Apache 2.0**(模型卡与附带 LICENSE 均已核实),可商用,需保留版权与 NOTICE
- 注意:**KittenTTS 2** 已改为 Stellon Labs Community License,本项目不使用该版本,升级前需重新核实

## 仓库组织

在现有 `tts` 仓库中新建 `app/` 子目录存放 Tauri 项目,与浏览器版 `index.html` 并存。浏览器版保留为轻量备选(零依赖、支持中文)。

复用清单:

- **直接移植**:`chunker`(纯函数,与引擎无关)、CSS 设计系统(`index.html` 中的样式变量与布局)、字数统计与快捷键绑定
- **需改写**:`speaker` 的音源部分 —— 原来调 `speechSynthesis`,现在改为调 `invoke("synth")` 并驱动 `<audio>`;状态机与 `generation` 令牌那套并发保护逻辑可以保留
- **删除**:`recorder` 模块(浏览器录制方案)、`voices`(系统发音人列表,换成固定的 8 个 Kitten 音色)
