#!/bin/bash
# CI 专用:从 HuggingFace 下载 Kitten 模型并裁剪到 app/src-tauri/models/。
#
# 与 prepare-model.sh 的区别:那个从本地 .models/ 缓存复制(开发机用),
# 这个直接从 HF 拉取(CI 的全新 checkout 没有本地缓存)。
#
# 模型不进 git 的原因:24.5MB 二进制会让仓库每次改动都膨胀,
# 而它在 HF 上是稳定可下载的,构建时拉取更干净。
#
# 只用 node 做 JSON 解析和 URL 编码(CI 里必有 node,不依赖 python)。
set -euo pipefail

REPO="csukuangfj/kitten-nano-en-v0_2-fp16"
BASE="https://huggingface.co/$REPO/resolve/main"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DST="$ROOT/app/src-tauri/models/kitten-nano-en-v0_2-fp16"

echo "下载源: $BASE"
echo "目标:   $DST"

mkdir -p "$DST/espeak-ng-data"

MANIFEST="$(mktemp)"
curl -sL --max-time 60 "https://huggingface.co/api/models/$REPO?blobs=true" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      JSON.parse(s).siblings.forEach(f=>console.log(f.rfilename));
    })" > "$MANIFEST"

encode() { node -e "console.log(encodeURIComponent(process.argv[1]))" "$1"; }

download() {
  local path="$1"
  local out="$DST/$path"
  mkdir -p "$(dirname "$out")"
  curl -sL --retry 3 --max-time 600 -o "$out" "$BASE/$(encode "$path")"
}

echo "[1/3] 模型本体…"
download "model.fp16.onnx"
download "voices.bin"
download "tokens.txt"

echo "[2/3] 裁剪 espeak-ng-data(只保留英文需要的)…"
for f in phondata phontab phonindex intonations en_dict; do
  download "espeak-ng-data/$f"
done
# 语言规则与声音变体目录(体积很小,整目录保留)
grep -E '^espeak-ng-data/(lang|voices)/' "$MANIFEST" | grep -v '\.DS_Store' | while IFS= read -r p; do
  download "$p"
done

echo "[3/3] 清理与校验…"
find "$DST" -name '.DS_Store' -delete
rm -f "$MANIFEST"

if [ ! -s "$DST/model.fp16.onnx" ]; then
  echo "错误:model.fp16.onnx 下载失败" >&2
  exit 1
fi

echo
echo "文件数: $(find "$DST" -type f | wc -l | tr -d ' ')"
echo "体积:   $(du -sh "$DST" | cut -f1)"
