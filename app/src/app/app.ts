import { Component, computed, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { save } from '@tauri-apps/plugin-dialog';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSliderModule } from 'ng-zorro-antd/slider';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';

import { PlayerService } from './player';
import { VOICES, DEFAULT_SID, DEFAULT_SPEED, MIN_SPEED, MAX_SPEED, MAX_CHARS, tts } from './tts';

const PREFS_KEY = 'tts.prefs';

interface Prefs {
  sid?: number;
  speed?: number;
}

@Component({
  selector: 'app-root',
  imports: [FormsModule, NzButtonModule, NzInputModule, NzSelectModule, NzSliderModule, CdkTextareaAutosize],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly player = inject(PlayerService);

  readonly voices = VOICES;
  readonly minSpeed = MIN_SPEED;
  readonly maxSpeed = MAX_SPEED;
  readonly maxChars = MAX_CHARS;

  readonly text = signal('');
  readonly speed = signal(DEFAULT_SPEED);
  readonly sid = signal(DEFAULT_SID);
  readonly exporting = signal(false);
  readonly exportNote = signal('');

  readonly state = this.player.state;
  readonly speechError = this.player.error;

  readonly charCount = computed(() => this.text().length);
  readonly atLimit = computed(() => this.charCount() >= this.maxChars);
  readonly busy = computed(() => this.state() !== 'idle');
  readonly canPlay = computed(() => this.text().trim().length > 0 && !this.busy());
  readonly canExport = computed(() => this.canPlay() && !this.exporting());
  readonly status = computed(() => this.exportNote() || this.speechError());

  constructor() {
    const prefs = this.readPrefs();
    if (typeof prefs.speed === 'number') {
      this.speed.set(clampSpeed(prefs.speed));
    }
    if (prefs.sid != null && VOICES.some(v => v.sid === prefs.sid)) {
      this.sid.set(prefs.sid);
    }
    this.player.sid = this.sid();
    this.player.speed = this.speed();
  }

  // ---- 播放控制 ----

  play(): void {
    const text = this.text().trim();
    if (!text || this.busy()) return;
    this.exportNote.set('');
    this.player.clearError();
    this.syncPlayer();
    void this.player.start(text);
  }

  pause(): void {
    if (this.state() === 'playing') this.player.pause();
    else if (this.state() === 'paused') this.player.resume();
  }

  stop(): void {
    this.player.stop();
  }

  // ---- 语速 / 音色 ----

  onSpeedChange(value: number): void {
    const speed = clampSpeed(value);
    this.speed.set(speed);
    this.syncPlayer();
    this.writePrefs({ speed });
  }

  onSidChange(sid: number): void {
    this.sid.set(sid);
    this.syncPlayer();
    this.writePrefs({ sid });
  }

  resetSpeed(): void {
    this.onSpeedChange(DEFAULT_SPEED);
  }

  // ---- 导出 ----

  async exportWav(): Promise<void> {
    const text = this.text().trim();
    if (!text || this.exporting()) return;

    const dest = await save({
      title: '导出 WAV',
      defaultPath: 'speech.wav',
      filters: [{ name: 'WAV 音频', extensions: ['wav'] }]
    });
    if (!dest) return; // 用户取消

    this.exporting.set(true);
    this.exportNote.set('正在合成整段音频…');
    try {
      await tts.synthToFile(text, this.sid(), this.speed(), dest);
      this.exportNote.set('已导出:' + dest);
    } catch (e) {
      this.exportNote.set('导出失败:' + (e instanceof Error ? e.message : String(e)));
    } finally {
      this.exporting.set(false);
    }
  }

  // ---- 快捷键 ----

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase() ?? '';
    const inControl = ['textarea', 'input', 'select', 'button'].includes(tag);
    const inDropdown = (e.target as HTMLElement)?.closest?.('.ant-select, .ant-slider') != null;

    if (e.key === 'Escape' && this.busy()) {
      this.stop();
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' && !inControl && !inDropdown) {
      e.preventDefault();
      if (this.state() === 'idle') this.play();
      else this.pause();
    }
  }

  // ---- 内部 ----

  private syncPlayer(): void {
    this.player.sid = this.sid();
    this.player.speed = this.speed();
  }

  private readPrefs(): Prefs {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs;
    } catch {
      return {};
    }
  }

  private writePrefs(patch: Prefs): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...this.readPrefs(), ...patch }));
    } catch {
      /* 受限环境下静默忽略 */
    }
  }
}

function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SPEED;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, v));
}
