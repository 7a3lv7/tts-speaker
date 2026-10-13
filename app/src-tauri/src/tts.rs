//! sherpa-onnx Kitten 引擎封装。

use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKittenModelConfig,
    OfflineTtsModelConfig,
};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct SynthResult {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

pub struct Engine {
    model_dir: PathBuf,
    /// `OfflineTts` 提供了 `unsafe impl Send`/`Sync`,但 C 库只保证「单对象使用」
    /// 下的线程安全,所以这里用 Mutex 把并发调用串行化,首次调用时才加载模型(约 1.5s)。
    inner: Mutex<Option<OfflineTts>>,
}

impl Engine {
    pub fn new(dir: impl AsRef<Path>) -> Self {
        Self {
            model_dir: dir.as_ref().to_path_buf(),
            inner: Mutex::new(None),
        }
    }

    fn ensure_loaded(&self, slot: &mut Option<OfflineTts>) -> Result<(), String> {
        if slot.is_some() {
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
        *slot = Some(OfflineTts::create(&config).ok_or_else(|| {
            format!("创建 TTS 引擎失败,模型目录: {}", d.display())
        })?);
        Ok(())
    }

    pub fn synth(&self, text: &str, sid: i32, speed: f32) -> Result<SynthResult, String> {
        let mut slot = self.inner.lock().map_err(|e| e.to_string())?;
        self.ensure_loaded(&mut slot)?;
        let tts = slot.as_ref().ok_or("引擎未初始化")?;

        let gen_cfg = GenerationConfig {
            sid,
            speed,
            ..Default::default()
        };
        // 泛型参数必须显式标注,否则传 None 时 F 无法推断。
        let audio = tts
            .generate_with_config::<fn(&[f32], f32) -> bool>(text, &gen_cfg, None)
            .ok_or("合成失败")?;

        Ok(SynthResult {
            samples: audio.samples().to_vec(),
            sample_rate: audio.sample_rate() as u32,
        })
    }
}

/// 编译期断言:Tauri 的共享状态要求 Send + Sync。
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Engine>();
};
