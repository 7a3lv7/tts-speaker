#!/bin/bash
# 在 `tauri android init` 之后修补生成的 Android 工程。
#
# 为什么需要这个脚本:gen/ 不进版本库(Tauri 约定),CI 上每次现生成,
# 所以对 build.gradle.kts 的改动没法直接提交,只能用脚本重放。
#
# 做两件事:
#   1. 放置 ProGuard 规则(模板的 proguardFiles 用 fileTree(".") 自动收集 *.pro)
#   2. release 开启混淆与资源收缩,并指向 debug 签名
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/app/src-tauri/gen/android"
APP_DIR="$ANDROID_DIR/app"
GRADLE_FILE="$APP_DIR/build.gradle.kts"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "错误:找不到 $ANDROID_DIR" >&2
  echo "请先运行 npx tauri android init" >&2
  exit 1
fi

# ---- 1. ProGuard 规则 ----
cp "$ROOT/app/android/proguard-rules.pro" "$APP_DIR/proguard-rules.pro"
echo "✓ ProGuard 规则已放置"

# ---- 2. 修补 release buildType ----
python3 - "$GRADLE_FILE" <<'PY'
import sys

path = sys.argv[1]
src = open(path, encoding='utf-8').read()

if 'signingConfigs.getByName("debug")' in src:
    print("✓ build.gradle.kts 已是修补状态,跳过")
    sys.exit(0)

# 匹配 Tauri 模板里的 release 块开头(缩进 8 空格)
old = '''        getByName("release") {
            optimization {
               enable = true
            }'''

new = '''        getByName("release") {
            optimization {
               enable = true
            }
            // 用 debug 签名,便于直接安装到设备测试;正式发布需换成 release keystore。
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true'''

if old not in src:
    print("✗ 未匹配到 release 模板块 —— Tauri 的 Android 模板可能已变动", file=sys.stderr)
    print("  请检查 gen/android/app/build.gradle.kts 并更新本脚本的匹配串", file=sys.stderr)
    sys.exit(1)

open(path, 'w', encoding='utf-8').write(src.replace(old, new, 1))
print("✓ build.gradle.kts 已修补(release:混淆 + 资源收缩 + debug 签名)")
PY
