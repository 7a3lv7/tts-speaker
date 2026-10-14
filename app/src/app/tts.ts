/**
 * 与 Rust 后端的通信层。所有合成的音频都来自本地模型,不涉及网络。
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

/** 音色表,顺序对应模型的 speaker id(0-7)。 */
export const VOICES = [
  { sid: 0, name: 'Bella', gender: '女声' },
  { sid: 1, name: 'Jasper', gender: '男声' },
  { sid: 2, name: 'Luna', gender: '女声' },
  { sid: 3, name: 'Bruno', gender: '男声' },
  { sid: 4, name: 'Rosie', gender: '女声' },
  { sid: 5, name: 'Hugo', gender: '男声' },
  { sid: 6, name: 'Kiki', gender: '女声' },
  { sid: 7, name: 'Leo', gender: '男声' }
] as const;

export const DEFAULT_SID = 1; // Jasper
export const DEFAULT_SPEED = 1.2; // Kitten 默认语速偏慢约 30%
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2.0;
export const MAX_CHARS = 5000;

/** 合成一段文字,返回缓存中的 WAV 文件路径。 */
function synth(text: string, sid: number, speed: number): Promise<string> {
  return invoke<string>('synth', { text, sid, speed });
}

/** 合成整段文字并直接写到用户选定路径。 */
function synthToFile(text: string, sid: number, speed: number, dest: string): Promise<void> {
  return invoke<void>('save_wav', { text, sid, speed, dest });
}

/** 把缓存文件路径转成 <audio> 能加载的 asset URL。 */
function toPlayableUrl(path: string): string {
  return convertFileSrc(path);
}

export const tts = { synth, synthToFile, toPlayableUrl };
