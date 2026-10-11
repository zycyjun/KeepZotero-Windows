# KeepZotero Windows · Zotero 10

让 Zotero 10 关闭主窗口时继续在后台运行，支持 Windows 系统托盘、双击恢复、右键退出和可开关的后台自启动。

**本项目的灵感来自 [yhmtsai/KeepZotero](https://github.com/yhmtsai/KeepZotero)，并在其部分代码与插件结构基础上进行了 Zotero 10 适配和 Windows 功能扩展。感谢原作者 Yu-Hsiang M. Tsai。** 这是独立维护的修改版本，非原项目官方发布，也不代表原作者或 Zotero 官方的认可。原项目的版权声明和 BSD-3-Clause 许可证已保留。

## 下载与安装

从 [Releases](https://github.com/zycyjun/KeepZotero-Windows/releases) 下载 `.xpi` 安装包；也可以直接下载仓库中的 [0.3.5 安装包](https://github.com/zycyjun/KeepZotero-Windows/raw/refs/heads/main/keepzotero-zotero10-tray-0.3.5.xpi)。

1. 打开 Zotero，进入 **工具 → 插件**。
2. 点击右上角齿轮，选择 **从文件安装插件**，选中下载的 `.xpi`。
3. 在 Zotero 设置中进入 **KeepZotero (Zotero 10)**，调整所需选项。
4. 更新插件后，如出现重启提示，通过托盘右键菜单的 **退出 Zotero** 完全退出，再重新打开。

为沿用原来的设置，本版本保留插件 ID `keepzotero@yhmtsai`。安装会替换同 ID 的 KeepZotero 版本；请勿同时运行其他拦截关闭或管理托盘的插件。本修改版的更新地址指向本仓库，不会从原项目自动更新。

## 功能

- **关闭后留在后台**：点击主窗口右上角 ×，默认隐藏到 Windows 系统托盘，Zotero 进程继续运行。
- **双击打开**：左键双击托盘图标恢复窗口；单击不会打开。
- **右键菜单**：右键点击托盘图标，选择“打开 Zotero”或“退出 Zotero”。
- **任务栏恢复**：隐藏后点击固定在任务栏的 Zotero 图标，恢复现有窗口。
- **保留窗口状态**：恢复时保留窗口大小、最大化或全屏状态。
- **后台自启动**：可在设置中开启当前 Windows 账户登录后自动启动，启动后保持主窗口隐藏；双击托盘图标或点击任务栏图标可打开。
- **关闭行为选项**：可开启退出确认，以及 Ctrl+W、Alt+F4、Ctrl+Q 最小化。Ctrl+W 仅针对文库标签页，保留其他标签页的正常关闭操作。

托盘图标可能位于 Windows 任务栏右侧的隐藏图标区域（小箭头内）。完全退出请使用托盘右键菜单的 **退出 Zotero** 或 Zotero 的 **文件 → 退出**。

## 设置默认值

| 选项 | 默认值 |
| --- | --- |
| Windows 开机时自动启动 Zotero | 关闭 |
| 点击主窗口 × 时最小化 | 开启 |
| 最小化时隐藏到系统托盘 | 开启 |
| 退出 Zotero 前显示确认提示 | 关闭 |
| 文库标签页 Ctrl+W 时最小化 | 关闭 |
| Alt+F4 或系统关闭窗口时最小化 | 关闭 |
| Ctrl+Q 时最小化 | 关闭 |

勾选或取消自启动会立即更新当前账户的 Windows 启动项，无需管理员权限。正常退出 Zotero 会保留启动项；禁用或卸载插件会移除本插件为该配置目录创建的启动项。

## 兼容范围与限制

- 安装包面向 **Windows x64 + Zotero 10.0.x**；已在 **Zotero 10.0.6** 的隔离配置目录中验证。其他版本和 Windows ARM64 原生程序尚未验证；不提供 macOS / Linux 托盘支持。
- 后台自启动在插件初始化时隐藏窗口。**Zotero 主窗口在插件加载前可能短暂闪现，不能保证启动全过程完全无窗口。** 已验证后台启动命令和后续恢复，尚未进行实际重启 Windows 的验证。
- 需要安装并启用插件，且 Windows 启动应用未被系统设置禁用。更改 Zotero 安装路径后，应重新打开 Zotero，让插件更新启动命令。
- 若托盘初始化失败，后台启动会尝试恢复主窗口，避免窗口无法访问。
- Zotero 后续更新若更改内部窗口或命令接口，可能需要重新适配。

## 实现与构建

不需要安装外部托盘软件，也不启动单独的辅助 EXE。插件使用 Zotero 的 ChromeWorker 和 js-ctypes 调用 Windows API；附带的 `keepzotero-tray.dll` **加载在 Zotero 进程内**，将托盘消息转发到工作线程。DLL 的完整源码在 [tray-bridge.c](tray-bridge.c)，预编译文件为 x64。

自启动使用 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`。启动项名称包含配置目录的哈希，命令携带 `-profile` 和 `-keepzotero-background` 参数。插件不修改文献库。

需要 Python 3，打包不依赖第三方 Python 库：

```powershell
python build.py
```

如需从源码重新编译原生 DLL，需要 MinGW-w64 x64 GCC：

```powershell
python build.py --rebuild-native --gcc gcc
```

脚本生成仓库根目录的版本化 `.xpi`、SHA-256 校验文件和 `keepzotero-update.json`。ZIP 目录映射、固定时间戳和完整性检查均在脚本中。发布时需同步提交安装包和更新清单。

验证范围见 [VALIDATION.md](VALIDATION.md)，版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证与致谢

采用 [BSD-3-Clause](LICENSE) 许可证。原版权归 Yu-Hsiang M. Tsai 所有；本仓库保留其版权声明、许可条件和免责声明。

再次感谢 [yhmtsai/KeepZotero](https://github.com/yhmtsai/KeepZotero) 提供关闭转最小化的灵感与基础实现。来源和修改说明见 [NOTICE.md](NOTICE.md)。
