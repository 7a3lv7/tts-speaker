/**
 * 把长文本切成适合逐句合成的片段。
 *
 * 为什么需要:神经网络 TTS 一次合成的文本越长,首句出声的等待就越久。
 * 切成句子后可以边合成边播放,还能让语速/音色的改动从下一句起立即生效。
 */

const MAX_CHUNK = 200; // 单句上限,防止过长的片段拖慢首字响应
const MIN_CHUNK = 60; // 短于此时不在句末切,避免停顿过碎
const SENTENCE_END = '.!?;';

export function chunk(text: string): string[] {
  const out: string[] = [];
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
