// 离线 TTS 前端:分句 → Rust 侧合成 WAV → 队列播放。
// 全程无网络请求,引擎是打包进应用的本地 Kitten 模型。

const tauri = window.__TAURI__;
if (!tauri) {
  document.body.innerHTML =
    '<p style="padding:2rem;font:15px system-ui">未检测到 Tauri 运行时。' +
    '请通过桌面应用启动,而不是直接用浏览器打开这个文件。</p>';
  throw new Error('Tauri runtime not found');
}
const { invoke, convertFileSrc } = tauri.core;

// ---- 音色表(sid 与模型内置顺序一致)----
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

// ---- 元素 ----
const textEl = document.getElementById('text');
const countEl = document.getElementById('count');
const statusEl = document.getElementById('status');
const voiceSelect = document.getElementById('voice');
const rateEl = document.getElementById('rate');
const rateValueEl = document.getElementById('rateValue');
const btnPlay = document.getElementById('play');
const btnPause = document.getElementById('pause');
const btnStop = document.getElementById('stop');
const btnExport = document.getElementById('export');

for (const v of VOICES) {
  const o = document.createElement('option');
  o.value = String(v.sid);
  o.textContent = `${v.name} · ${v.gender}`;
  voiceSelect.append(o);
}

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', !!isError);
}

// ---- 分句(纯函数,与引擎无关)----
const MAX_CHARS = 5000;
const MAX_CHUNK = 200;   // 单句上限
const MIN_CHUNK = 60;    // 短于此时不在句末切,避免停顿过碎
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

// ---- 播放器 ----
const PRE_BUFFER = 2;   // 预生成句数,用于消除句间空隙

const player = {
  queue: [],
  index: 0,
  state: 'idle',          // idle | playing | paused
  sid: 1,
  speed: 1.2,
  generation: 0,
  audio: null,
  cache: new Map(),       // index -> Promise<url>
  onStateChange: null,

  setState(s) {
    this.state = s;
    if (this.onStateChange) this.onStateChange(s);
  },

  // 合成第 i 句并返回可播放 URL;同一句只合成一次
  prepare(i) {
    if (i >= this.queue.length) return null;
    if (!this.cache.has(i)) {
      this.cache.set(i, (async () => {
        const path = await invoke('synth', {
          text: this.queue[i],
          sid: this.sid,
          speed: this.speed,
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

    // 预生成后续几句,填缓冲
    for (let k = 0; k < PRE_BUFFER; k++) {
      const p = this.prepare(this.index + k);
      if (p) p.catch(() => {});   // 预生成的失败留给真正播放时处理
    }

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
    if (gen !== this.generation) return;   // 等待期间被 stop() 了

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
      setStatus('播放被拒绝:' + (e && e.message ? e.message : e), true);
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

  // 内部:清空并让所有旧回调失效,不通知 UI
  // (start() 内部用它,避免闪一次多余的 idle 状态)
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

// ---- UI 状态 ----
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
  return rate;
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

// ---- 导出 WAV ----
btnExport.addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (!text) return;

  const dest = await tauri.dialog.save({
    title: '导出 WAV',
    defaultPath: 'speech.wav',
    filters: [{ name: 'WAV 音频', extensions: ['wav'] }],
  });
  if (!dest) return;   // 用户取消

  btnExport.disabled = true;
  setStatus('正在合成整段音频…');
  try {
    await invoke('save_wav', {
      text,
      sid: Number(voiceSelect.value),
      speed: player.speed,
      dest,
    });
    setStatus('已导出:' + dest);
  } catch (e) {
    setStatus('导出失败:' + e, true);
  } finally {
    refresh();
  }
});

// ---- 偏好记忆 ----
const STORE = {
  read() {
    try { return JSON.parse(localStorage.getItem('tts.prefs') || '{}'); }
    catch { return {}; }
  },
  write(patch) {
    try { localStorage.setItem('tts.prefs', JSON.stringify({ ...this.read(), ...patch })); }
    catch { /* 受限环境静默失败 */ }
  },
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

  if (e.key === 'Escape' && player.state !== 'idle') {
    player.stop();
    e.preventDefault();
    return;
  }
  if (e.code === 'Space' && !inControl) {
    e.preventDefault();
    if (player.state === 'idle') btnPlay.click();
    else btnPause.click();
  }
});

// ---- 初始化 ----
applyRate(rateEl.value);
refresh();
