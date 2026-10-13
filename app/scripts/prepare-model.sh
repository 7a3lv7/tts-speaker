#!/bin/bash
# 从仓库根的 .models/ 复制 Kitten 模型并裁剪 espeak-ng-data。
#
# 裁剪依据:官方 espeak-ng-data 含 113 个语言词典共 17MB(ru_dict 8.1MB、cmn_dict 1.5MB 等),
# 英文模型只需要英语相关部分。白名单经实测:数字/货币/日期($25.50、January 3rd, 2026)、
# 缩写(Dr.、NASA、Ph.D.)、邮箱电话等文本均能正常合成。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/.models/kitten-nano-en-v0_2-fp16"
DST="$ROOT/app/src-tauri/models/kitten-nano-en-v0_2-fp16"

if [ ! -d "$SRC" ]; then
  echo "错误:找不到源模型目录 $SRC" >&2
  echo "请先下载 kitten-nano-en-v0_2-fp16" >&2
  echo "(HuggingFace: csukuangfj/kitten-nano-en-v0_2-fp16)" >&2
  exit 1
fi

echo "源:   $SRC"
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

# 3) 清掉 macOS 的 .DS_Store(否则会拖慢 app 签名)
find "$DST" -name '.DS_Store' -delete

echo
echo "=== 结果 ==="
echo "文件数: $(find "$DST" -type f | wc -l | tr -d ' ')"
echo "体积:   $(du -sh "$DST" | cut -f1)"
echo "预期:   约 24.5MB / 约 240 个文件"
