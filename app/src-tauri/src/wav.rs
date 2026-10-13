//! f32 PCM 采样 → 16-bit 单声道 WAV 字节。

pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    const HEADER: usize = 44;
    let data_len = (samples.len() * 2) as u32;
    let mut buf = Vec::with_capacity(HEADER + data_len as usize);

    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());             // fmt 块大小
    buf.extend_from_slice(&1u16.to_le_bytes());              // PCM
    buf.extend_from_slice(&1u16.to_le_bytes());              // 单声道
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // 字节率 = 采样率 × 块对齐
    buf.extend_from_slice(&2u16.to_le_bytes());              // 块对齐 = 声道数 × 位深/8
    buf.extend_from_slice(&16u16.to_le_bytes());             // 位深
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());

    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        buf.extend_from_slice(&v.to_le_bytes());
    }
    buf
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
        // data 块长度字段
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
