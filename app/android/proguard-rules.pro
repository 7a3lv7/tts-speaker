# Tauri + Android 的混淆规则。
#
# 背景:Tauri 的 Android 侧通过 JNI 与 Rust 通信、并靠反射加载若干类,
# R8 无法静态分析出这些引用,默认会被裁掉或改名,导致运行时崩溃。
# 下面的规则把这类入口固定住。
#
# 由 scripts/patch-android-release.sh 复制到 gen/android/app/ 下,
# 因为 gen/ 不进版本库(CI 上每次现生成 Android 工程)。

# ---- Rust <-> Kotlin 的 JNI 边界 ----

# 原生方法名必须保留,否则 JNI 按名字找不到实现
-keepclasseswithmembernames class * {
    native <methods>;
}

# Tauri 生成的 Rust 桥接类
-keep class com.jaelynwong.ttsapp.generated.** { *; }

# ---- Tauri 运行时的入口类 ----
# 这些类由 Rust 侧按全限定名反射调用,混淆后会 ClassNotFoundException
-keep class app.tauri.** { *; }
-keep class com.jaelynwong.ttsapp.** { *; }

# ---- WebView 回调 ----
# 若应用内定义了自己的 WebViewClient/WebChromeClient,系统按类型调用
-keep class * extends android.webkit.WebViewClient { *; }
-keep class * extends android.webkit.WebChromeClient { *; }
-keep class * extends android.webkit.WebView { *; }

# ---- 保留必要的元信息 ----
# 异常栈里保留行号,便于排查线上崩溃
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
