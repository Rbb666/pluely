# Windows 中文本地版构建

本分支保留现有中文界面、截图提问、应用内拼音、语音处理和用户数据导入导出功能。构建产物使用 `Pluely Local` 名称及 `com.pluely.local` 应用标识；已有该标识下的用户数据继续保存在用户目录。

## GitHub Actions 安装包

仓库的 **Actions → Windows installer** 在推送到 `master`、向 `master` 发起 Pull Request 或手动点击 **Run workflow** 时构建 Windows x64 安装包。

工作流安装锁定的 npm 和 Cargo 依赖，执行前端回归检查与 Rust 测试，最后构建简体中文 NSIS 安装程序。运行成功后，在该次运行的 **Artifacts** 中下载 `Pluely-Local-Windows-x64-<commit SHA>`，解压即可得到安装包和同名 `.sha256` 校验文件。产物保留 14 天。

安装程序会检测目标电脑上的 WebView2 Evergreen 运行时。已安装时直接复用，缺少时需要联网从微软下载并安装。[Tauri 的 WebView2 安装选项](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)

首次使用时请配置自己的 AI 和语音服务。截图提问需要支持图片输入的模型。官方云端服务仍需要对应的服务配置和许可。

## 本地构建

需要 Windows x64、Node.js 24、Rust 1.100.0 MSVC 工具链，以及 Visual Studio C++ Build Tools 和 Windows SDK。RTK 是可选的，脚本在未安装 RTK 时直接调用 npm。

在仓库根目录安装依赖并构建默认安装包。

```powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1
```

安装包默认输出到 `src-tauri/target/release/bundle/nsis/`。

### 离线安装包

目标电脑缺少 WebView2 且无法联网时，可构建内含固定版 WebView2 的离线安装包。安装前端依赖后，在仓库根目录运行以下命令。如果 `src-tauri/runtime/` 已有经过校验的完整运行库，直接执行第二条命令。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-windows-runtime.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1 -Offline
```

离线包默认输出到 `src-tauri/target/offline/release/bundle/nsis/`。如果已指定 `CARGO_TARGET_DIR`，离线构建会使用其下的 `offline` 子目录。两种安装包使用同一个应用标识。

### 单独构建程序

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-local.ps1 -Release
```

## 运行库和生成资源

WebView2 的版本、微软下载地址和 CAB SHA-256 固定在 `src-tauri/windows/webview2-runtime.json`。升级时一起更新版本、地址和校验值，并重新验证安装包。`prepare-windows-runtime.ps1` 校验 CAB 后完整展开，保留微软文件并附带许可说明。

语音检测资源由 `npm run build` 的前置脚本从锁定的 npm 依赖生成到 `public/vad/`。离线拼音资源与其许可证保存在仓库中，可用 `node scripts/prepare-pinyin-dictionary.cjs` 重建。原始词库按字节校验，Git 属性固定其原始换行。

安装包、`src-tauri/runtime/`、`public/vad/`、`release-private/`、`.local-tools/`、环境密钥文件和 `.pluely-backup.json` 用户备份均不应加入 Git。CI 会主动清空 `PLUELY_MIGRATION_SEED_DIR`，公共安装包与个人数据迁移文件分开保存。
