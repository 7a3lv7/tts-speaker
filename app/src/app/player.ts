import {Injectable, signal} from '@angular/core';
import {chunk} from './chunker';
import {DEFAULT_SID, DEFAULT_SPEED, tts} from './tts';

export type PlayerState = 'idle' | 'playing' | 'paused';

/** 播放当前句时,提前合成后面几句,填补句间空隙。 */
const PRE_BUFFER = 2;

@Injectable({providedIn: 'root'})
export class PlayerService {
  private readonly _state = signal<PlayerState>('idle');
  private readonly _error = signal('');

  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();

  /** 语速与音色在每次合成前读取,所以播放中改动会从**下一句**起生效。 */
  speed = DEFAULT_SPEED;
  sid = DEFAULT_SID;

  private queue: string[] = [];
  private index = 0;
  /**
   * 自增令牌:每次 start/stop 都 +1,所有异步回调先比对令牌。
   * 否则「停止」之后,已在途的合成结果仍会把队列往前推,继续念下一句。
   */
  private generation = 0;
  private audio: HTMLAudioElement | null = null;
  private cache = new Map<number, Promise<string>>();

  async start(text: string): Promise<void> {
    this.reset();
    const gen = this.generation;
    this.queue = chunk(text);
    this.index = 0;

    if (!this.queue.length) {
      this._state.set('idle');
      return;
    }
    this._error.set('');
    this._state.set('playing');
    await this.playCurrent(gen);
  }

  pause(): void {
    if (this._state() !== 'playing') return;
    this.audio?.pause();
    this._state.set('paused');
  }

  resume(): void {
    if (this._state() !== 'paused') return;
    void this.audio?.play();
    this._state.set('playing');
  }

  stop(): void {
    this.reset();
    this._state.set('idle');
  }

  clearError(): void {
    this._error.set('');
  }

  /** 内部:清空队列并让所有在途回调失效,不改变对外状态。 */
  private reset(): void {
    this.generation++;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    this.queue = [];
    this.index = 0;
    this.cache.clear();
  }

  /** 合成第 i 句(带缓存),返回可播放的 asset URL。 */
  private prepare(i: number): Promise<string> | null {
    if (i >= this.queue.length) return null;
    let pending = this.cache.get(i);
    if (!pending) {
      pending = tts.synth(this.queue[i], this.sid, this.speed).then(p => tts.toPlayableUrl(p));
      this.cache.set(i, pending);
    }
    return pending;
  }

  private async playCurrent(gen: number): Promise<void> {
    if (gen !== this.generation) return;
    if (this.index >= this.queue.length) {
      this._state.set('idle');
      return;
    }

    // 预热后续句子;失败留给真正播到时再报,避免未播放的句子刷错误信息
    for (let k = 0; k < PRE_BUFFER; k++) {
      this.prepare(this.index + k)?.catch(() => undefined);
    }

    let url: string;
    try {
      url = await this.prepare(this.index)!;
    } catch (e) {
      if (gen !== this.generation) return;
      this._error.set('合成失败:' + errText(e));
      this._state.set('idle');
      return;
    }
    if (gen !== this.generation) return; // 等待期间被 stop/start 打断

    const audio = new Audio(url);
    this.audio = audio;

    audio.onended = () => {
      if (gen !== this.generation) return;
      this.index++;
      void this.playCurrent(gen);
    };
    audio.onerror = () => {
      if (gen !== this.generation) return;
      this._error.set('播放失败');
      this._state.set('idle');
    };

    try {
      await audio.play();
    } catch (e) {
      if (gen !== this.generation) return;
      this._error.set('播放被拒绝:' + errText(e));
      this._state.set('idle');
    }
  }
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
