# 5. 数据与接口

> Index: [docs/PRD.md](../PRD.md)

### 5.1 本地数据与加密存储

| 文件 | 位置 | 结构 | 生命周期 |
| --- | --- | --- | --- |
| `settings.json` | `app.getPath('userData')`（macOS：`~/Library/Application Support/vessel/settings.json`） | `{ locale, theme, accent, launchAtLogin, vibrancy, glassOpacity, developerMode, clipboardLimit, clipboardPollMs, terminalShell, terminalFontFamily, terminalFontSize, terminalWindowWidth, terminalWindowHeight, terminalAlwaysOnTop（遗留字段，恒为 `false`、启动时归一）, terminalScrollback, terminalSearchQuery（终端查找上次关键词，关闭 / 重启后回填）, terminalOpacity（聚焦时的底色透明度；旧默认值 5% / 20% 仅在旧版本写出的设置文件上迁移为 10%）, terminalBlurOpacity（失焦时的底色透明度，0 = 不透明、100 = 完全透明，默认 80%）, mainWindowHotkey, terminalHotkey, terminalCloseAction, sshBuiltinTerminal, followSystemProxy, sftpDownloadDir, terminalBallEnabled, terminalBallDelayMs, terminalBallSize, terminalBallIcon, terminalBallDark, terminalBallTransparent, fileWindowAlwaysOnTop, gameWorkDir, gameFdsBios, gameCommonKeys, gameKeymaps, gameHotkeys, gameVolume, gameControlsHidden, logRetentionDays, trayClickAction（`menu` = 点击托盘图标弹右键菜单（默认）/ `window` = 直接显示主界面，见 §3.2） }` | 持久；重启保留 |
| `vessel-YYYY-MM-DD.log` | **macOS：`~/Library/Logs/Vessel/`**（Console.app 的「日志报告」会收录该目录，与 JetBrains/CLion 一致，与用户数据目录分离）；其它平台：`app.getPath('userData')` 的 `logs/` 子目录（`src/main/utils/paths.js` 的 `LOG_DIR`，按 `process.platform` 选择） | 按天追加的文本日志（启动信息、SSH 探测 / SFTP / 终端 / 文件管理等）；启动时把数据文件清单也写进去 | 持久；**惰性清理**：每天首次写日志时删除保留期之前的日志文件（保留天数取设置 `logRetentionDays`，默认 **7 天**，来自 `package.json` 的 `vessel.logRetentionDays`） |
| `ssh-detected.json` | 同上目录 | `{ [alias]: { os, family, label, at } }` | 持久；缓存探测结果 |
| `ssh-credentials.json` | 同上目录 | `{ entries: { [别名]: { iv, tag, data } } }`（**AES-256-GCM 密文**，全 base64） | 持久；在设置里保存 / 清除 SSH 密码时更新。密钥随机生成、存 `ssh-credentials.key`（0600）；密码明文不落盘，连接时主进程解密后交给内置终端自动输入（见 §3.4） |
| `ssh-credentials.key` | 同上目录 | base64 的 32 字节随机密钥（0600） | 持久；首次存密码时生成，用于加解密 `ssh-credentials.json` |
| `totp-accounts.json` | 同上目录 | `{ accounts: [{ id, title, subtitle, period, digits, algorithm, secret: { iv, tag, data } }] }`（**TOTP 密钥为 AES-256-GCM 密文**，全 base64；标题 / 副标题 / 参数为明文）。`algorithm` ∈ `SHA1`（默认）/`SHA256`/`SHA512`，`period` 默认 30（1–600），`digits` ∈ 6（默认）/8 | 持久；「ID 与密码」工具内的 2FA 区块添加 / 删除账号时更新。密钥随机生成、存 `totp-accounts.key`（0600）；密钥明文不落盘，验证码由主进程解密后计算（见 §4「2FA 验证码」） |
| `totp-accounts.key` | 同上目录 | base64 的 32 字节随机密钥（0600） | 持久；首次存 2FA 账号时生成，用于加解密 `totp-accounts.json` |
| `main-window.json` | 同上目录 | `{ x, y }`（主窗口位置；兼容旧版 `{ bounds: { x, y, width, height } }`，只取 x / y；**不记录桌面 / 屏幕 / 尺寸**） | 持久；拖动后防抖 400ms 与关闭前写入；下次显示应用到当前鼠标所在屏幕并夹回工作区，无记录则居中；「清理数据」可删除 |
| `terminal-window.json` | 同上目录 | `{ display: { id, scaleFactor, bounds: { x, y, width, height } }, bounds: { x, y, width, height } }`（悬浮终端窗口最近一次的所在屏幕 + 位置 + 尺寸） | 持久；打开 / 拖动 / 缩放 / 关闭时写入（含「实际生效」的几何，恢复时被夹取过也记夹取后的值）；同一块屏幕再次打开即沿用，换屏 / 拔屏 / 无记录则改用默认尺寸居中 |
| `file-window.json` | 同上目录 | 同 `terminal-window.json` 的结构（独立文件窗口的屏幕 + 位置 + 尺寸） | 持久；记忆方式与终端窗口一致 |
| `game-window.json` | 同上目录 | 同 `terminal-window.json` 的结构（独立游戏窗口的屏幕 + 位置 + 尺寸） | 持久；记忆方式与终端窗口一致 |
| `transfer-window.json` | 同上目录 | 同 `terminal-window.json` 的结构（文件传输窗口 / 穿梭框的屏幕 + 位置 + 尺寸） | 持久；记忆方式与终端窗口一致 |
| `<workDir>/roms/{fc,gbc,gba,n64,sfc}/` | 游戏工作目录（未打包默认 `assets/games`，打包默认 `应用数据目录/games`；可在设置 → 游戏修改） | 用户 ROM 文件，应用只读；封面为 ROM 同目录同名 `.png/.jpg/.jpeg/.webp` | 用户文件，应用不修改 |
| `<workDir>/bios/disksys.rom` | 同上 | 用户选择的 FDS BIOS 副本（见 `games:set-bios`） | 持久；清除配置不删除文件 |
| `<workDir>/profiles/<gameId>/` | 同上 | `battery.srm`（电池存档）、`state.slot1`（即时存档）、`state.slot1.png`（截图）、`meta.json`（引擎 / ROM 相对路径 / 游玩时间）；每游戏独立目录 | 持久；存档写入为临时文件 + rename；旧目录 `profile/` 兼容读取 |
| `file-layout.json` | 同上目录 | `{ treeWidth, name, size, perm, time, panelHeight, sortKey, sortDir }`（**内嵌面板**的目录树宽、文件名 / 体积 / 权限 / 时间四个数据列、面板高度：`treeWidth` / `panelHeight` 单位 px，默认 `300` / `260`；`name` / `size` / `perm` / `time` 为**列宽占比（%）**、四项合计恒为 100，默认 `36.4 / 13.6 / 20.5 / 29.5`；**旧版按 px 记录的列宽（160 / 60 / 90 / 130 等）在读取时按相对比例自动换算成占比，无需手动迁移**；`sortKey` ∈ `''`（不排序）/`name`/`size`/`time`、`sortDir` ∈ `asc`/`desc`；`treeWidth` 仍按基准字号 12px 记录、内嵌面板按 `--fm-scale`（= 终端字号 ÷ 12）等比放大；列宽占比不随字号缩放） | 持久；拖动分隔线 / 列宽分界线、点击列头排序时写入；**有记录时不再套用首次的最小布局**（§3.8-10） |
| `file-window-layout.json` | 同上目录 | 同 `file-layout.json` 结构（**独立文件窗口**自己的布局记录，与内嵌面板**分开保存**） | 持久；独立窗口拖动分隔线 / 列宽时写入 |
| `nutrient-records.json` | 同上目录 | `{ products: { [name]: { name, energy, protein, fat, carbohydrate, sodium, total, savedAt } }, tdee: { sex, age, height, weight, activity, bmr, tdee, savedAt } 或 null }`（商品名去重、同名覆盖；TDEE 保存输入与计算结果） | 持久；营养成分工具保存商品 / TDEE 变化时写入 |
| `cd-history.json` | 同上目录 | `{ [“用户名@主机”]: string[] }`（文件面板每个 ssh 目标最近 cd 到的远端目录，去重、越新越靠前、最多 `CD_HISTORY_MAX` = 10 条） | 持久；仅记录通过 cd 到达的目录（终端跟随 / `cd 到此目录` 按钮 / 点历史条目），手动浏览不记录；「清理数据」可删除 |
| `editor-backups/*.json` | `<数据目录>/editor-backups/` | 内置编辑器的本地恢复副本：每个文件（本地路径，或「远端目标 + 路径」的哈希）一个 JSON 数组，元素为 `{ id, time, size, name, content }`，按时间倒序、最多保留 **5** 份（`file-editor:backup` 写入，正常保存后清空） | 持久；仅在有未保存修改时每 30s 写入一份（内容未变化则跳过）；文件权限 0600；用于意外退出后按时间恢复 |
| 剪贴板历史 | 内存（不落盘） | 最近 5 条 `{ id, type, text?, thumb?, width?, height?, truncated?, at }` | 随进程退出丢失 |
| `~/.ssh/config` | 用户主目录 | 标准 OpenSSH 配置；**分组用一行注释 `# group: <名称>` 标记**（紧随其后的 Host 属于该分组，直到下一个标记；未标记的属「未分组」；ssh 忽略注释，不影响连接） | 由设置内 SSH 管理读写；未加密（非机密） |
| `bin/vessel` / `bin/_vessel` | `<数据目录>/bin/` | CLI 主脚本（`#!/bin/sh`，0755）与 zsh 补全（`_vessel`，0644）；由设置 → 数据 →「安装 CLI」从应用内 `assets/cli/vessel.sh` / `assets/cli/_vessel` 复制而来（见 §5.3） | 持久；仅用户主动安装时写入，重新安装覆盖 |
| `vessel-cli.sock` | `<数据目录>/vessel-cli.sock` | 运行期 Unix domain socket（权限 0600）：`vessel` 命令与主进程通信的唯一通道，**不监听网络端口、不落盘令牌**；应用退出时删除 | 随进程存在；重启重建 |

- 机密数据：**默认不保存密码**；仅当用户在设置 → SSH 主动填写登录密码时，密码以 **AES-256-GCM 加密**保存在 `ssh-credentials.json`（密钥 `ssh-credentials.key`，均 0600），明文不落盘。2FA（TOTP）密钥同理由用户主动添加，以 **AES-256-GCM 加密**保存在 `totp-accounts.json`（密钥 `totp-accounts.key`，均 0600），明文不落盘、且不下发到渲染层（验证码在主进程计算）。导出备份文件时密码为**明文**（用户自行保管）。SSH 私钥仍由用户自行管理与使用，不复制、不落盘到应用数据目录。
- 设置默认值来自 `package.json` 的 `vessel.defaultLocale/defaultTheme/defaultAccent`。
- **从 Ships 更名升级**：打包版首次启动时，若新数据目录不存在，会把旧 `~/Library/Application Support/ships` 重命名为新目录，并把旧 `~/Library/Logs/Ships` 重命名为 `~/Library/Logs/Vessel`；目标已存在时不覆盖。
- 启动时打印数据文件清单与绝对路径（`src/main/utils/paths.js` → `describeDataFiles`）。

### 5.2 IPC 通道

**invoke（渲染 → 主，返回 Promise）**

| 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `app:info` | — | `{ version, platform, arch, systemLocale, dataDir, dataFiles, terminalScrollback }` | 版本取 `package.json`；`terminalScrollback` 取 `vessel.terminalWindow.scrollback` |
| `app:list-fonts` | — | `{ ok, fonts?, error? }`（`fonts: [{ family, mono }]`） | 通过 AppKit `NSFontManager`（`osascript -l JavaScript`）读取系统已安装字体家族，并标记是否为等宽字体；**等宽字体排在前面**，同组按名称排序，结果缓存。供字体选择子窗口使用。仅 macOS |
| `app:local-address` | `{ kind }`（`'public4'` / `'public6'` / `'lan4'` / `'lan6'`） | `{ ok, address }` 或 `{ ok: false, error }` | 取本机地址供 IP / 网段工具的下拉使用：`lan4` / `lan6` 从 `os.networkInterfaces()` 取对应地址族的非内部地址（v4 优先 RFC 1918 私有网段；v6 去掉作用域后缀并优先非链路本地）；`public4` / `public6` 按地址族（`family: 4` / `6`）请求 `ipv4.icanhazip.com` / `ipv6.icanhazip.com`（失败退回 `ifconfig.me/ip`，返回值必须与请求的地址族匹配，避免把 IPv4 当作 IPv6）获取出口 IP（遵循系统代理，5s 超时，任一成功即返回）；均失败返回 `{ ok: false }` |
| `font-picker:open` | — | `{ ok }` | 打开设置窗口的非模态字体选择子窗口（`font-picker.html`）；已打开时聚焦现有窗口 |
| `app:open-data-folder` | — | `{ ok, error? }` | 打开数据目录 |
| `cli:status` | — | `{ supported, installed, path, binDir, aliasPath, aliasInstalled, completionPath, zshrcPath, zshrcConfigured }` | 设置 → 数据 → 命令行工具：查询 `vessel` 是否已安装（`<数据目录>/bin/vessel` 是否存在）以及 `~/.zshrc` 里是否已写入 PATH 块（见 §5.3），仅 macOS |
| `cli:install` | — | `{ ok, ...status }` 或 `{ ok:false, error }` | 安装 CLI：把 `assets/cli/vessel.sh` / `_vessel` 复制到 `<数据目录>/bin/`（0755 / 0644），并在 `~/.zshrc` 写入 / 原地更新带起止标记的 PATH 块（可重复安装，不产生重复块），仅 macOS |
| `app:open-log` | — | `{ ok, error? }` | 打开**日志文件夹**（macOS：`~/Library/Logs/Vessel`；不存在则创建；**只打开文件夹，不打开日志文件**） |
| `app:open-console` | — | `{ ok, error? }` | 打开 macOS 系统「控制台」App（`/System/Applications/Utilities/Console.app`，缺失时退回 `/Applications/Utilities/Console.app`）；非 macOS 返回 `{ ok: false, error: 'unsupported' }`；由设置 → 日志的「打开控制台 App」按钮调用 |
| `app:clear-data` | — | `{ ok }` | 一键清理**非业务数据**：删除 `main-window.json`、`terminal-window.json`、`file-window.json`、`game-window.json`、`file-layout.json`、`file-window-layout.json`、`cd-history.json`（窗口位置 / 尺寸、列宽 / 面板高度、cd 历史）；**不动** `settings.json`、日志、`~/.ssh/config` 与游戏 ROM / 存档；由设置 → 应用 的「清理数据」（二次确认后）调用 |
| `app:open-external` | `url` | `{ ok, error? }` | 仅允许 `http(s)` |
| `app:open-path` | `target` | `{ ok, error? }` | 终端路径链接：展开 `~`、校验绝对路径且存在，然后 `shell.showItemInFolder` 在 Finder 中定位（不执行文件 / 不启动 .app） |
| `app:copy-image` | PNG data URL | `{ ok, error? }` | 把 PNG 图片写入系统剪贴板（Electron 44：`new ClipboardItem({ 'image/png': Blob })` + `await clipboard.write([…])`）；仅接受 `data:image/png;base64,` 前缀；编码转换工具的二维码「复制」用 |
| `app:save-image` | `{ dataUrl, name? }` | `{ ok, path?, canceled?, error? }` | 保存对话框把 PNG data URL 存为本地文件（默认名 `qrcode.png`）；编码转换工具的二维码「下载到本地」用 |
| `app:check-updates` | — | `{ ok, checking?, error?, message? }` | 设置 → 应用 → 关于 的「检查更新」：触发一次自动更新检查（`updater-service`）。**每次手动检查都会给出反馈**（有新版本 / 已是最新 / 暂时无法检查 / 开发模式不检查，均由**应用内提示框**即更新窗口显示），反复点击不会静默无响应；检查进行中（含自动检查）再次点击返回 `{ ok: true, checking: true }`，设置页就地提示「检查更新中…」。**失败时在友好提示后附具体原因**（如请求超时、GitHub API 限流 403/429、DNS 解析失败、连接被拒绝、网络中断、缺少发布仓库配置、未找到当前架构安装包等；无法归类时回退原始错误信息），完整技术错误同时写日志；`message` 字段返回同样的文案，界面提示统一走更新窗口 |
| `app:check-updates-state` | — | `{ checking }` | 设置页查询当前是否有自动 / 手动检查在进行；用于打开设置窗口时初始化「检查更新」按钮的禁用态与「检查更新中…」文案 |
| `update:state` | — | `{ phase, mode, version, percent, transferred, total, bytesPerSecond, countdown, changelog, prompt }` 或 `null` | 更新窗口查询当前状态（`phase` ∈ `idle` / `downloading` / `downloaded`；`changelog` = 当前版本到最新版之间的 Markdown 更新日志（可能为空）；`prompt` = 待处理的提示框 `{ id, title, message, buttons, defaultId, cancelId, changelog }` 或 `null`，窗口加载完成时据此补显示）；只接受来自**更新窗口**的请求 |
| `update:cancel` | — | `{ ok }` | 下载窗口「取消」：下载阶段中止下载（`CancellationToken`），已完成则停止倒计时、不立即重启（退出本次更新）；只接受来自更新窗口的请求 |
| `update:install` | — | `{ ok }` | 下载窗口「重启更新」：`quitAndInstall()` 立即重启并安装；只接受来自更新窗口的请求 |
| `update:open-release` | `version` | `{ ok, error? }` | 下载窗口「下载安装包」：在系统浏览器打开该版本的 GitHub Release 页面（版本非法或缺少发布仓库配置时返回 `{ ok:false }`）；只接受来自更新窗口的请求 |
| `update:choice` | `{ id, index }` | `{ ok }` | 应用内提示框：渲染层回传用户点击的按钮下标（`id` 由主进程下发）；`id` 过期 / 不匹配返回 `{ ok:false }`，只接受来自更新窗口的请求 |
| `settings:get` | — | `settings` | |
| `settings:set` | `patch` | 合并后的 `settings` | 副作用：写盘 + 广播 + 可能修改登录项 |
| `ssh:list` | — | `{ hosts, detected }` | 读 `~/.ssh/config`；每个 host 含 `group`（分组名，未分组为 `''`）与 `hasPassword`（是否已存密码，见 §5.1）字段；显示名按 `用户名@地址` 归一化（`ssh-config-service.hostLabel()`） |
| `ssh:edit` | `{ alias }` | `{ ok, error? }` | 主面板 SSH 条目的编辑图标：隐藏主面板、打开设置窗口的 SSH 分区，并让该主机直接进入编辑表单（设置窗口未打开时等渲染层挂载后再发 `settings:edit-ssh`）；别名缺失返回错误 |
| `ssh:connect` | `{ alias, inTerminal? }` | `{ ok, command?, error? }` | 按 alias 查表并拼 `ssh …`：`inTerminal: true`（终端内发起，如右键「连接到服务器」；头部下拉已隐藏但仍兼容）**强制注入当前悬浮终端窗口**、不受 `sshBuiltinTerminal` 影响；省略时按 `settings.sshBuiltinTerminal` 决定走悬浮终端或 iTerm |
| `ssh:quick-connect` | `{ hostName, user?, port?, password?, inCurrentTerminal? }` | `{ ok, command?, alias?, hosts?, reused?, error? }` | SSH 管理 / 终端右键「快速连接」：`hostName` **必填**（缺省返回 `{ ok:false, error:'hostName required' }`），`port` 默认 `22`。有 `password` 则加密保存，否则清除该别名旧密码并使用 `~/.ssh/id_ed25519`。**`用户名@地址` 已存在时不再新建条目**（复用已有主机，只在有密码时更新凭据，返回 `reused: true`）；否则**无论连接成败**都写入 `~/.ssh/config` 的「快速连接」分组并置于最前，随后广播 `ssh-config:changed` 并触发探测。连接目标：省略 / `inCurrentTerminal: false` → **始终新开一扇终端**再注入（`runInNewTerminal`）；`inCurrentTerminal: true`（终端右键菜单）→ 在**发起请求的那个终端窗口**注入（`runInTerminal` 指定窗口，不新开）。成功返回 `command` / `alias` |
| `ssh:open-in-terminal` | `{ path, alias?, target?, host?, username?, port?, identityFile?, password? }` | `{ ok, command?, error? }` | 独立文件窗口目录右键「在终端打开」：按 `alias` 命中 `~/.ssh/config`（否则用手动字段构造主机），**新开一扇终端**执行 `ssh -t 'cd <path> && exec $SHELL -l'`，让远端 shell 直接进入该目录；有显式密码 / 该别名已保存密码时交给终端在密码提示处自动输入（同 §3.4-4），否则用密钥 |
| `ssh:open-iterm` | `{ alias, path? }` | `{ ok, command?, error? }` | 终端内联命令 `\v iterm`：按 `alias` 查表拼 `ssh …`（带 `path` 时追加 `-t 'cd <path> && exec $SHELL -l'`），在 iTerm 中打开并**销毁发起请求的终端窗口**；成功后返回实际执行的 `command` |
| `ssh:detect` | `{ alias }` | `{ queued }` | 异步，结果经 `ssh:detected` 回传（兼容保留） |
| `ssh:detect-host` | `{ alias?, hostName, user?, port?, identityFile?, proxyJump?, password?, useStoredPassword? }` | `{ ok, alias, info }` | 对任意主机（可尚未保存）同步探测，结果写入缓存并广播。**支持密码认证**：用 `password`（表单填的明文密码）优先，为空且 `useStoredPassword !== false` 时回退到该别名已保存的加密密码（主进程解密后用于这次探测，不外传） |
| `ssh:get-detected` | — | `{ [alias]: { os, family, label, at } }` | 读取探测缓存 |
| `terminal:open` | `{ ballIcon?, randomBallIcon?, excludeBallIcon? }` | `{ ok }` | **新开**一扇悬浮终端窗口（落在当前桌面；不复用 / 不拉取别的桌面的窗口，§3.8）。可选 `ballIcon`（`assets/icons/ball/*.svg` 文件名）：该窗口本次专用的悬浮球图标，经 URL 查询参数传给渲染层，**不写入设置**、不影响其它窗口。未传 `ballIcon` 且 `randomBallIcon: true` 时，由主进程从 `assets/icons/ball` 随机挑一个（可用 `excludeBallIcon` 排除当前窗口的图标），结果同样经 URL 查询参数传入；终端右键菜单「窗口 → 新建终端」即用此方式 |
| `terminal:duplicate` | `{ alias, path?, randomBallIcon?, excludeBallIcon? }` | `{ ok, command? }` | **复制会话**：新开一扇终端窗口并自动连接 `alias` 指向的 SSH 主机；给了 `path` 时远端 shell 直接进入该目录（`ssh -t 'cd <path> && exec $SHELL -l'`），没给则连接后停在默认目录。已存密码由主进程解密后随命令注入（与「在终端打开」同一套实现）。终端右键菜单「窗口 → 复制会话」即用此通道 |
| `terminal:start` | `{ cols, rows }` | `{ ok, id, cols, rows, shell }` | 新建交互终端会话（真实 PTY + 默认登录 shell） |
| `terminal:input` | `{ id, data }` | `{ ok }` | 把 xterm 的键盘输入写进 PTY |
| `terminal:resize` | `{ id, cols, rows }` | `{ ok }` | 同步 PTY 尺寸（`TIOCSWINSZ`） |
| `terminal:interrupt` | `{ id }` | `{ ok }` | 向终端发送 Ctrl-C |
| `terminal:kill` | `{ id }` | `{ ok }` | 结束会话 |
| `terminal:copy-text` | `{ text }` | `{ ok }` | 终端右键菜单「复制」：把文本写入系统剪贴板（`clipboard.writeText`）；空文本返回 `{ ok: false }`；只接受来自终端窗口本身的请求 |
| `terminal:paste-text` | — | `{ ok, text }` | 终端右键菜单「粘贴」：读取系统剪贴板文本返回给渲染层，由 `term.paste()` 注入 shell；只接受来自终端窗口本身的请求 |
| `terminal:ball-restore` | — | `{ ok }` | 悬浮球点击：把该终端窗口从圆形小窗放大回原窗口（恢复 bounds / 最小尺寸 / 可缩放 / 置顶并 `focus`，见 §3.8-12）；只接受来自该终端窗口本身的请求 |
| `sftp:connect` | `{ target, username?, host?, port?, auth?: 'password' \| 'key', password?, identityFile? }` | `{ ok, id?, home?, target?, error?, code? }` | 新建一条 SFTP 会话。`target` = ssh 目标 token（命中 `~/.ssh/config` 时用记录里的 host / port / user / IdentityFile；ProxyJump 返回 `proxyjump`）。独立文件窗口还可传手动字段：`host` / `username` / `port` **显式字段优先于 config**；`auth: 'password'` 用 `password` 认证（**仅用于本次连接，不持久化**，留空时回退到该别名的已保存密码），`auth: 'key'` 用 `identityFile`（留空用 config / `~/.ssh/id_ed25519`）。**未显式指定 `auth`（内嵌面板 / 自动连接）时与 SSH 连接一致：有已保存密码先用密码，没有才用密钥。**返回会话 `id`（内嵌面板与独立窗口各持一个）；`code` ∈ `proxyjump`/`auth`/`timeout`/`sftp`/`connect`/`no-target`；只接受来自终端窗口或独立文件窗口的请求 |
| `sftp:list` | `{ id, path? }` | `{ ok, path, parent, home, entries?, code?, error? }` | 列远端目录（`entries[]` = `{ name, type: dir\|file\|link, size, mtime, mode }`，目录在前；`mode` 为 st_mode，用于渲染权限列）；`path` 省略 / `~` 取家目录；会话不存在返回 `code: 'not-connected'` |
| `sftp:download` | `{ id, path }` | `{ ok, path?, name?, error? }` | 下载远端文件到设置的下载目录（重名自动加 ` (n)`），返回本地绝对路径；过程中经 `sftp:progress` 回传进度 |
| `sftp:open` | `{ id, path }` | `{ ok, path?, name?, error? }` | 右键「从 Finder 打开」（Windows 文案为「在资源管理器中显示」）：先下载（同 `sftp:download`，含进度回传），成功后由主进程 `shell.showItemInFolder` 在系统文件管理器中定位该文件；只接受来自终端窗口或独立文件窗口的请求 |
| `sftp:open-vscode` | `{ id, path }` | `{ ok, path?, name?, error? }` | 右键「从 VS Code 打开」：先下载（同 `sftp:download`，含进度回传），成功后由主进程用 **Visual Studio Code** 打开该文件（优先 `code` CLI，否则 `open -b com.microsoft.VSCode`）；打开失败返回 `{ ok: false, error }`；只接受来自终端窗口或独立文件窗口的请求 |
| `sftp:open-wireshark` | `{ id, path }` | `{ ok, path?, name?, error? }` | 右键「从 Wireshark 打开」（选中项全部为 `.pcap` / `.pcapng` 时菜单可见，体积 > 4GB 时置灰不可点）：先下载（同 `sftp:download`，含进度回传），成功后由主进程用 **Wireshark** 打开该文件（优先 `wireshark` CLI，否则 `open -b org.wireshark.Wireshark`）；打开失败返回 `{ ok: false, error }`；只接受来自终端窗口或独立文件窗口的请求 |
| `sftp:upload` | `{ id, localPath, remoteDir }` | `{ ok, name?, path?, error? }` | 把本地文件上传到远端目录（`remoteDir` 省略 / `~` 取家目录），同名覆盖；过程中经 `sftp:progress` 回传进度 |
| `sftp:close` | `{ id }` | `{ ok }` | 关闭指定 SFTP 会话（切换 ssh / 窗口销毁时调用） |
| `sftp:transfer-command` | `{ id, paths, recursive? }` | `{ ok, command?, error? }` | 生成把远端文件 / 目录传回本地下载目录的 `scp` 命令（`paths` 为数组，支持多选 → 多个源；目录加 `-r`，端口 22 / 默认私钥省略，远端路径加引号），**并写入系统剪贴板**；界面已移除「复制传输命令」菜单，通道仅为向后兼容保留；只接受终端窗口 / 独立文件窗口的请求 |
| `sftp:copy-path` | `{ paths }` | `{ ok, paths?, error? }` | 右键「复制路径」：把选中的远端绝对路径写入系统剪贴板（`paths` 为数组，多条按换行）；空数组返回 `{ ok: false }`；只接受终端窗口 / 独立文件窗口的请求 |
| `sftp:copy-text` | `{ text }` | `{ ok, error? }` | 文件列表 Cmd / Ctrl + C：把选中行导出的 CSV 文本写入系统剪贴板；空文本返回 `{ ok: false }`；只接受终端窗口 / 独立文件窗口的请求 |
| `sftp:copy-reference` | `{ id, paths }` | `{ ok, references?, error? }` | 右键「复制引用」：按会话的 `用户名@主机` 把 `用户名@地址:远端绝对路径` 写入系统剪贴板（`paths` 为数组，多条按换行）；空数组返回 `{ ok: false }`；只接受终端窗口 / 独立文件窗口的请求 |
| `cd-history:list` | `{ id }` | `{ ok, entries }` | 读取该 SFTP 会话所属 ssh 目标（`用户名@主机`）的 cd 历史；会话不存在 / 未连接返回空数组 |
| `cd-history:add` | `{ id, path }` | `{ ok, entries }` | 记录一次 cd 到的远端目录（去重、越新越靠前、最多 10 条，写 `cd-history.json`）；只接受终端窗口 / 独立文件窗口的请求 |
| `file-window:open` | `{ target?, path? }` | `{ ok }` | 打开 / 聚焦独立文件窗口；`target` 省略沿用上次目标，传**空串** = **不选中任何连接**（主面板「文件管理」按钮用），传别名 = 自动连接该主机（SSH 管理 `folder` 图标用）；`path` = 连接后要进入的初始目录（内嵌面板「分离为独立窗口」带过去当前目录）。已存在时把 `{ target, path }` 经 `file-window:target` 发过去 |
| `file-window:info` | — | `{ ok, target, path, settings }` | 独立文件窗口启动时读取初始目标 / 初始目录与当前设置；只接受来自该窗口的请求 |
| `file-window:close` | — | `{ ok }` | 销毁独立文件窗口（自绘红绿灯关闭按钮）；只接受来自该窗口的请求 |
| `file-window:set-top` | `{ value: boolean }` | `{ ok, alwaysOnTop }` | 独立文件窗口的置顶开关：写 `settings.fileWindowAlwaysOnTop`；**默认关**（普通窗口），持久 |
| `file-window:snap-size` | `{ height }` | `{ ok, height? }` | 保留兼容：独立文件窗口已**不再自动对齐整行高度**，渲染层不再调用；通道仍按工作区 / 最小高度夹取后设置内容高度；只接受来自该窗口的请求 |
| `file-editor:open` | `{ sessionId, path, name? }` | `{ ok, error? }` | 从文件管理器打开一扇内置编辑器窗口（每文件一扇、可多开）；`sessionId` 必须是**发起窗口自己**的 SFTP 会话；只接受终端窗口 / 独立文件窗口的请求 |
| `file-editor:open-local` | — | `{ ok, path?, name?, error?, canceled? }` | 编辑器窗口内「打开文件」：拉起系统打开面板，把**当前窗口**切换到选中的本地文件（仅本地文件；超过 20MB 返回 `{ ok:false, error:'too-large' }`；取消返回 `{ ok:false, canceled:true }`） |
| `file-editor:new-local` | — | `{ ok, path?, error? }` | 新建**本地**文件（落在设置里配置的「文件下载目录」，文件名 `scratch-<时间戳>.txt`，重名自动加序号）并用内置编辑器打开；不依赖 SSH / SFTP；只接受终端窗口 / 独立文件窗口的请求 |
| `file-editor:info` | — | `{ ok, path, name, reference, local? }` | 编辑器启动后读取当前文件信息与引用（`用户名@地址:路径`）；本地临时文件时 `reference` 为本地路径、`local: true`；只接受来自编辑器窗口的请求 |
| `file-editor:read` | — | `{ ok, content, size, mtime, binary, error?, code? }` | 读取当前文件文本（远端 ≤ 20MB、拒绝目录；本地临时文件直接读 fs）；含 NUL 的二进制内容不报错，按有损 UTF-8 解码返回并置 `binary: true`，渲染层据此只读；**远端文件按 64KB 分块流式读取，过程中经 `file-editor:progress` 实时回传进度**；只接受来自编辑器窗口的请求 |
| `file-editor:save` | `{ content }` | `{ ok, path?, bytes?, error? }` | 覆盖写回当前文件（远端走 SFTP，本地临时文件走 fs）；编辑器状态栏显示保存中 / 已保存；只接受来自编辑器窗口的请求 |
| `file-editor:save-as` | `{ path, content }` | `{ ok, path?, bytes?, error?, canceled? }` | 另存为：远端文件要求 `path` 为 `/` 开头的绝对路径；**本地文件忽略 `path` 并拉起系统保存面板（Finder 样式）选择位置**，写入成功后该编辑器切换到新文件；只接受来自编辑器窗口的请求 |
| `file-editor:open-vscode` | `{ content, name? }` | `{ ok, path?, name?, error? }` | 编辑器「从 VS Code 打开」：远端文件把当前内容写成本地文件（下载目录，重名自动加 ` (n)`）后用 VS Code 打开；本地临时文件先落盘当前内容再直接打开该文件；不修改远端文件；只接受来自编辑器窗口的请求 |
| `file-editor:download` | `{ content, name? }` | `{ ok, path?, name?, error? }` | 编辑器「下载到本地」：把编辑器当前内容写成本地文件到设置的下载目录（同名自动加 ` (n)`）；只接受来自编辑器窗口的请求 |
| `file-editor:close-all` | — | `{ ok, closed }` | 关闭发起窗口打开的所有编辑器窗口（文件管理器销毁 / 断开 / 切换目标时调用）；只接受终端窗口 / 独立文件窗口的请求 |
| `file-editor:set-dirty` | `{ dirty }` | `{ ok }` | 编辑器把「是否有未保存修改」同步给主进程；有未保存修改时关闭窗口先弹二次确认（取消 / 不保存退出）；**选择「不保存退出」会一并删除该文件的恢复副本**，只接受来自编辑器窗口的请求 |
| `file-editor:backup` | `{ content }` | `{ ok, count?, skipped?, error? }` | 写入当前文件的本地恢复副本（`<数据目录>/editor-backups/<key>.json`，最多 5 份；内容与最新一份相同则 `skipped:true`）；只接受来自编辑器窗口的请求 |
| `file-editor:backups` | — | `{ ok, items: [{ id, time, size, name }] }` | 列出当前文件的恢复副本元数据（按时间倒序），打开文件后据此提示是否恢复；只接受来自编辑器窗口的请求 |
| `file-editor:backup-read` | `{ id }` | `{ ok, content, time, size }` | 读取指定恢复副本的内容（恢复到编辑器）；只接受来自编辑器窗口的请求 |
| `file-editor:backup-clear` | — | `{ ok }` | 删除当前文件的全部恢复副本（正常保存 / 用户选择忽略后调用）；只接受来自编辑器窗口的请求 |
| `file-editor:render-image` | `{ html, options: { width, dpi, padding } }` | `{ ok, dataUrl, width, height, cssWidth, cssHeight, error? }` | Markdown 图片导出预览：复用隐藏导出窗口，按 `width`（默认 600）/ `dpi`（默认 150，输出像素宽 = width×dpi/96）/ `padding`（默认 32px）离屏渲染；长文档按 1600px 切片截图再拼接，CSS 高度上限 **30000px**（输出画布另有 60000px / 6000 万像素上限，超出等比缩小）；只接受来自编辑器窗口的请求 |
| `file-editor:save-image` | `{ dataUrl, name }` | `{ ok, path?, error? }` | 把导出的 PNG 保存到设置里配置的「文件下载目录」（重名自动加序号，扩展名 `.png`）；只接受来自编辑器窗口的请求 |
| `games:scan` | — | `{ ok, workDir, resolvedWorkDir, isDefault, engines }` | 扫描游戏工作目录；`engines[].games[]` 含 `{ id, name, engine, label, core, romRelativePath, size, mtime, played, coverUrl, romUrl }`（`played` 表示该游戏是否启动过）；支持 `roms/<engine>/<文件夹>/xxx.rom`（单 ROM 子目录以文件夹名为游戏名；多 ROM 子目录生成 `<引擎> - <文件夹>` 独立分类），扩展名匹配不区分大小写；已启动过的游戏会以 `id: recent` 的「最近启动」分类置顶（按 `lastPlayedAt` 倒序最多 8 个）；只接受主窗口 / 设置窗口请求 |
| `games:open` | `{ gameId }` | `{ ok, error? }` | 打开 / 复用游戏窗口并加载游戏，同时更新 `meta.json` 的 `lastPlayedAt`；只接受主窗口请求 |
| `games:window-info` | — | `{ ok, game, emulatorVersion, settings }` | 游戏窗口启动时读取当前游戏与按键 / 音量 / `hasFdsBios` 设置；只接受游戏窗口请求 |
| `games:load-ready` | `{ gameId }` | `{ ok, error? }` | 切换游戏时渲染层 flush 成功后确认；主进程此时更新当前游戏；只接受游戏窗口请求 |
| `games:save-sram` / `games:load-sram` | `{ gameId, data? }` / `{ gameId }` | `{ ok, exists?, data?, error? }` | 读写 `profiles/<gameId>/battery.srm`；`gameId` 必须匹配当前窗口游戏 |
| `games:save-state` / `games:load-state` | `{ gameId, state, screenshot? }` / `{ gameId }` | `{ ok, exists?, state?, screenshot?, error? }` | 读写 `state.slot1` 与 `state.slot1.png`；只接受游戏窗口请求 |
| `games:touch` | `{ gameId, playSeconds }` | `{ ok, error? }` | 更新 `meta.json` 的 `lastPlayedAt` / `playSeconds` |
| `games:close-now` | — | `{ ok }` | 游戏窗口 flush 完成后销毁自身；超过 3 秒主进程强制销毁 |
| `games:select-workdir` / `games:set-workdir` | — / `{ path }` | `{ path }` / `{ ok, workDir, resolvedWorkDir, isDefault, error? }` | 选择 / 校验并写入游戏工作目录；自动创建 `roms/`、`bios/` 与 `profiles/` 骨架 |
| `games:select-bios` / `games:set-bios` | — / `{ path }` | `{ path }` / `{ ok, path?, error? }` | 选择 / 校验 FDS BIOS（`disksys.rom`）并复制到 `<workDir>/bios/disksys.rom`，把副本路径写入 `settings.gameFdsBios`；空字符串清除；默认未配置 |
| `games:open-workdir` / `games:open-profile` | — / `{ gameId? }` | `{ ok, path?, error? }` | 在 Finder 打开工作目录 / 指定游戏存档目录 |
| `games:keymap-set` / `games:hotkey-set` | `{ common }` / `{ engine, maps }` / `{ all }` / `{ common, all }` / `{ maps }` | `{ ok, maps, error? }` | 保存通用按键 / 平台专有按键 / 功能快捷键；冲突（同平台重复、与功能快捷键冲突）或非法键返回错误 |
| `games:set-controls-hidden` / `games:set-volume` | `{ hidden }` / `{ volume }` | `{ ok, hidden }` / `{ ok, volume }` | 持久化控制区显隐 / 音量（0–1）；只接受游戏窗口请求 |
| `games:fit-window` | `{ aspect }` | `{ ok, width, height, error? }` | 按游戏宽高比调整游戏窗口尺寸，消除左右黑边；只接受游戏窗口请求 |
| `files-layout:get` | — | `{ treeWidth, name, size, time, panelHeight }` | 读取文件管理布局（`file-layout.json`） |
| `files-layout:set` | `{ ...patch }` | 合并后的布局 | 合并写入文件管理布局（拖动分隔线 / 列宽时调用） |
| `terminal:export` | `{ text, name? }` | `{ ok, path?, canceled?, error? }` | 保存对话框 + 把终端文本写入本地文件 |
| `terminal:save-buffer` | `{ text }` | `{ ok, path?, error? }` | 把终端缓冲区文本写入**应用数据目录**下的 `terminal-<时间戳>.txt`，并用内置编辑器打开该文件（本地文件模式） |
| `terminal:open-iterm` | — | `{ ok, command?, error? }` | 在 iTerm 中重放最后注入的命令并关闭终端窗口 |
| `terminal:set-top` | `{ value: boolean }` | `{ ok, alwaysOnTop: false }` | **已弃用（兼容保留）**：终端窗口不再置顶（图钉按钮只控制失焦缩成悬浮球），本通道恒返回 `alwaysOnTop: false`、**不写设置** |
| `shortcut:set` | `{ target: 'terminal', hotkey: string }` | `{ ok, hotkey, error? }` | 设置 → 快捷键 改绑**终端**全局快捷键：先试注册（空串 = 注销），**成功才写 `settings.terminalHotkey`**；失败返回 `{ ok: false, error }`（`unavailable` = 已被占用，`invalid-target` = target 非法 / `main` 已不再支持）并保持原值 |
| `terminal:reset` | — | `{ ok, settings }` | 设置 → 终端 →「重置」：把终端相关设置（`terminalShell`/`terminalFontSize`/`terminalScrollback`/`terminalOpacity`/`terminalBlurOpacity`/`terminalWindowWidth`/`terminalWindowHeight`/`terminalAlwaysOnTop`/`terminalCloseAction`/`sshBuiltinTerminal`/`terminalBallEnabled`/`terminalBallDelayMs`/`terminalBallSize`/`terminalBallIcon`/`terminalBallDark`/`terminalBallTransparent`）恢复为 `package.json` 里的默认值，并删除 `terminal-window.json`（记住的屏幕 / 位置 / 大小）；返回重置后的完整设置 |
| `terminal:destroy` | — | `{ ok }` | 会话结束后销毁终端窗口（渲染层在 shell `exit` 时调用）：**始终销毁，不受「关闭按钮行为=隐藏」影响**；只接受来自终端窗口本身的请求 |
| `terminal:snap-size` | `{ width?, height? }` | `{ ok, size?, deferred? }` | 渲染层按**实测余量**请求把窗口收到「整行 / 整列」：**拖动期间只挂起**（`deferred: true`），松手后由渲染层重新测量再对齐；偏差 > 60px 视为状态异常、不做。只接受来自终端窗口本身的请求 |
| `terminal:ensure-size` | `{ width, height }` | `{ ok, width?, height? }` | 打开内嵌文件面板时把本窗口**只放大不缩小**到至少给定内容尺寸（首次无布局记录时用，见 §3.8-10）；受屏幕工作区限制，不写回几何记忆；只接受来自终端窗口本身的请求 |
| `window:control` | `{ action: 'close' \| 'minimize' \| 'zoom' }` | `{ ok, action }` | 终端窗口自绘小红绿灯的窗口控制：只作用于**发起请求的那个窗口**（`BrowserWindow.fromWebContents(event.sender)`），未知 action 返回 `{ ok: false }`；`close` 在终端窗口上按「关闭按钮行为」收缩成悬浮球或销毁（见 §3.8-9） |
| `window:show-main` | — | `{ ok }` | 终端右键菜单「显示主界面」：`showMainWindow()` 显示 / 带到前台主面板（主窗口已无全局快捷键，见 §3.8-8） |
| `window:list-open` | — | `[{ id, type, title }]` | 设置 → 窗口管理：列出当前已打开的可管理窗口；`type` ∈ `main` / `terminal` / `file` / `editor` / `game`（编辑器 `title` 为文件名） |
| `window:activate` | `{ id }` | `{ ok }` | 激活指定窗口：最小化的先还原，再 `show()` + `focus()` + `moveTop()` |
| `window:destroy-window` | `{ id }` | `{ ok }` | 销毁指定窗口：终端走 `destroyTerminalWindow`（结束会话）、游戏先存档、文件窗口先落盘几何；其余直接 `destroy()` |
| `ssh-config:read` | — | `hosts` | 每个 host 含 `group` 与 `hasPassword` 字段（见 §5.1） |
| `ssh-config:upsert` | `host`（含可选 `group`、`originalAlias`） | 更新后的 `hosts` | 保留未管理指令与注释；`group` 有值时写入 / 复用 `# group: <名称>` 注释并归入该分组，空串 / 缺省 = 未分组；改分组时把主机移动到目标分组末尾，分组清空后自动移除其注释标记 |
| `ssh-config:remove` | `alias` | 更新后的 `hosts` | 删除该分组最后一个主机后自动移除其 `# group:` 注释标记 |
| `ssh-config:rename-group` | `{ from, to }` | 更新后的 `hosts` | 把 config 中所有匹配 `from` 的 `# group:` 注释改成 `to`（不区分大小写）；空值 / 同名视为无操作；由设置 · SSH 的分组重命名图标调用 |
| `ssh-password:save` | `{ alias, password }` | `{ ok, error? }` | 把登录密码 **AES-256-GCM 加密**写入 `ssh-credentials.json`（密钥见 §5.1）；由设置 · SSH 的「保存」调用 |
| `ssh-password:remove` | `{ alias }` | `{ ok }` | 删除该别名的加密密码；由设置 · SSH 的「清除密码」调用 |
| `backup:export` | — | `{ ok, path?, canceled?, error? }` | 保存对话框导出**全部配置**（设置 + SSH 主机；SSH 密码为**明文**）为 JSON；由设置 · 导入 / 导出调用 |
| `backup:import` | — | `{ ok, settings, added, skipped, passwords?, canceled?, error? }` | 打开对话框选 JSON 并导入：**设置覆盖**当前值、**SSH 主机只新增**（别名已存在则跳过），随新增主机保存其密码；由设置 · 导入 / 导出调用 |
| `ssh-config:export` | — | `{ ok, path?, canceled?, error? }` | 经保存对话框导出 `~/.ssh/config` 副本 |
| `geo:lookup` | `ip`（IPv4 字符串） | `{ iso_3166, country, province, city, isp }` 或 `null` | 本地 `assets/geoip.json` 查询；内网返回 `{ isp: '保留地址' }`；**逐级回退**（省 / 市只有中国、台湾有数据，缺失不影响国家级结果；只有 ISP 命中时仅返回 `isp`；都不命中返回 `null`） |
| `devtools:open` | `'main' \| 'settings' \| 'terminal' \| 'file' \| 'game'` | `{ ok }` | 打开对应窗口的开发者工具（detach 模式；主面板会先显示，`'terminal'` / `'file'` 未打开时先打开对应窗口） |
| `clipboard:list` | — | `item[]`（最多 5 条） | 内存历史，含文本 / 图片缩略图 |
| `clipboard:copy` | `id` | `{ ok, error? }` | 文本用 `writeText`，图片用 `ClipboardItem` 写回 |
| `clipboard:clear` | — | `{ ok }` | 清空历史（不清空系统剪贴板） |
| `dns:lookup` | `{ host, type }`（`type` 可空：`a`/`aaaa`/`mx`/`txt`/`cname`/`ns`/`soa`/`ptr`；留空时**输入是 IP 自动按 `ptr`、否则按 `a`**） | `{ ok, type, host, records?, error? }` | DNS 查询（Node 内置 `dns.promises`）：`records` 为字符串数组（MX 为「优先级 + 交换主机」，TXT 已按段拼接，SOA 已拼成一行）；失败返回 `{ ok: false, error }` |
| `hash:text` | `text` | `{ md5, sha1, sha256, sha384, sha512, crc32, fnv1a32, fnv1a64, xxhash64, cityhash64 }` | 计算文本哈希（全部 10 种算法） |
| `hash:file` | `file`（绝对路径） | `{ ok, hashes?, info?, error? }` | 流式计算文件哈希（全部 10 种算法；`cityhash64` 因算法依赖尾部字节，走「两次读取」） |
| `hash:algorithms` | — | `[{ id, label }]` | 返回可用哈希算法清单（渲染层据此生成结果行，避免两侧各写一份） |
| `nutrient:get` | — | `{ ok, products, tdee }` | 读取营养成分商品记录与 TDEE 最后状态 |
| `nutrient:save-product` | `{ name, energy, protein, fat, carbohydrate, sodium, total }` | `{ ok, products, tdee }` 或 `{ ok: false, error }` | 按商品名保存（忽略大小写去重、同名覆盖）；`name` 为空返回 `name-required` |
| `nutrient:delete-product` | `{ name }` | `{ ok, products, tdee }` 或 `{ ok: false, error }` | 按商品名删除记录（忽略大小写匹配）；不存在返回 `not-found` |
| `nutrient:save-tdee` | `{ sex, age, height, weight, activity, bmr, tdee }` | `{ ok, products, tdee }` | 保存 TDEE 输入与计算结果（覆盖最后状态） |
| `totp:list` | — | `account[]` | 列出 2FA 账号（**不含密钥**）：`{ id, title, subtitle, period, digits, algorithm }`，用于渲染「ID 与密码」工具内的 2FA 卡片 |
| `totp:add` | `input`（`otpauth://` 链接或 Base32 密钥） | `{ ok, account? }` 或 `{ ok: false, error }` | 主进程校验并解析（`error` ∈ `empty`/`invalid-secret`/`invalid-url`/`unsupported-type`（非 TOTP）/`duplicate`），加密保存密钥并返回账号（不含密钥）；由「ID 与密码」工具内的 2FA 区块「添加」调用 |
| `totp:remove` | `id` | `{ ok }` | 删除该账号（含其加密密钥）；由卡片二次确认后调用 |
| `totp:codes` | — | `{ [id]: code }` | 返回全部账号**当前时间片**的 TOTP 验证码（主进程用 node `crypto` 计算，密钥不外传）；渲染层每 250ms 刷新倒计时、时间片切换时调用 |
| `dialog:open-file` | — | `{ path, name, size }` 或 `null` | 打开系统文件选择对话框 |
| `dialog:open-dir` | `{ defaultPath? }` | `{ path }` 或 `null` | 打开系统目录选择对话框（设置 → 数据 → 文件下载目录） |
| `dialog:open-files` | — | `{ paths: string[] }` | 多选文件对话框（文件管理「上传」按钮），返回本地绝对路径列表 |
| `log:write` | `text`（渲染→主 send） | — | 渲染层请求写日志：主进程用 `logger.info` 把文本同时输出到**控制台与当天日志文件**（终端窗口尺寸 / 字体 / 行高度量，见 §3.8-4） |

**send（渲染 → 主，单向）**

| 通道 | 说明 |
| --- | --- |
| `window:hide` | 隐藏主面板 |
| `window:open-settings` | 隐藏主面板并打开设置窗口；可选参数 `section`（如 `games`）指定初始分区，窗口已打开时直接切换 |
| `window:close-settings` | 关闭设置窗口 |
| `tray:tools-set` | 渲染层上报**托盘右键菜单的工具清单**：`[{ id, label }]`（顺序与主界面 TAB 一致，`label` 为当前语言下的工具名）；主进程缓存后据此生成菜单条目，切换语言后重新上报 |
| `font-picker:close` | 关闭当前字体选择子窗口（仅关闭发起请求的窗口） |
| `terminal:ball-drag` | 悬浮球拖动（见 §3.8-12）：`{ phase: 'start', x, y }` 开始（主进程记下光标相对窗口的偏移后按光标移动窗口）／ `{ phase: 'end' }` 结束 |

**事件（主 → 渲染）**

| 通道 | 负载 | 说明 |
| --- | --- | --- |
| `settings:changed` | `settings` | 设置变更后广播到两个窗口 |
| `theme:changed` | `{ shouldUseDarkColors }` | 系统主题变化 |
| `tray:show-tool` | `toolId` | 托盘右键菜单点击某个工具：主进程显示主界面后通知渲染层切换到该工具（渲染层未启动完成时先暂存，boot 后应用） |
| `transfer:progress` | `{ phase, name, path?, transferred, total, files?, localPath?, phaseAt?, error? }` | 传输任务的实时进度（`phase` ∈ `start` / `download` / `upload` / `downloaded` / `done` / `error`；`download` / `upload` 两段分别回传 `transferred/total`，`transferred` 为**当前段**已完成的字节；`downloaded` 表示下载段结束、开始上传段；`error` 时 `phaseAt` ∈ `download` / `upload` 指明失败所在段），供传输窗口状态栏的**下载 / 上传两条进度条**使用 |
| `transfer-window:locate` | `{ target, path, rightTarget?, rightPath? }` | 传输窗口已打开时，主进程通知它把**左侧栏**定位到指定 SSH 目标与目录；`rightTarget` / `rightPath` 存在时同时定位**右侧栏**（分离为独立窗口时带过去） |
| `ssh:detected` | `{ alias, os, family, label, at }` | 探测完成 |
| `clipboard:changed` | `item[]` | 剪贴板历史变化（主进程每约 1.2s 轮询系统剪贴板） |
| `terminal:data` | `{ id, type: 'data', data }` | PTY 输出（原样文本，含 ANSI），只发给拥有该会话的窗口 |
| `terminal:exit` | `{ id, type: 'exit', code, signal }` 或 `{ id, type: 'error', message }` | 会话结束 / 启动失败 |
| `terminal:session` | `{ id, type: 'session', ssh, target, busy }` | 本应用发起 SSH 连接后推送一次：`ssh` / `target` 为目标别名（供文件按钮与文件面板连接用），`busy` 恒为 `false`（保留字段）；**不再通过后台 `ps` 轮询检测**，手动敲入的 `ssh …` 不会触发；只发给对应终端窗口 |
| `terminal:ball` | `{ active, size, phase, duration, scaleX, scaleY }` | 悬浮球状态（见 §3.8-12）：`phase` ∈ `enter`（终端按缩放缩小）/ `settle`（切球或切终端）/ `grow`（终端从球 scale 放大）；`size` 球边长、`scaleX/scaleY` 起止缩放、`duration` 过渡时长。只发给对应终端窗口 |
| `terminal:ball-pin` | `{ value: boolean }` | `{ ok, value }` | 头栏「固定」按钮：设置该终端窗口是否**失焦不缩球**（`win.__ballPin`，仅当前窗口、不持久）；只接受来自该终端窗口本身的请求 |
| `terminal:ball-suppress` | `{ value: boolean }` | `{ ok, value }` | 临时抑制该终端窗口失焦缩球（`win.__suppressBall`，仅当前窗口、不持久、不改动「固定」状态）：终端内「快速连接」弹窗打开时置 `true`、关闭时置 `false`；恢复时**不主动缩球**（下次失焦再按正常逻辑处理）；只接受来自该终端窗口本身的请求 |
| `terminal:set-active-session` | `{ id }` | `{ ok, id }` | 分屏时告诉主进程「当前聚焦的终端会话」：之后 SSH 注入等落到该会话（`sessionByOwner`）；`id` 必须是仍在运行的终端会话，否则 `{ ok:false }`；只接受来自终端窗口本身的请求 |
| `terminal:recalibrate` | — | 拖动结束后请终端窗口重新测量并按整行对齐高度（拖动期间主进程不改窗口尺寸，见 §3.8-4） |
| `terminal:drag-active` | — | 主进程检测到终端窗口开始被拖动（`will-resize`）：渲染层据此在拖动期间不发对齐请求 |
| `terminal:zoom` | `'in' \| 'out' \| 'reset'` | 焦点在终端窗口时 `Cmd +/-/0` 的字号缩放（见 §5.3）；独立文件窗口不支持缩放 |
| `sftp:progress` | `{ id, direction: 'upload' \| 'download', name, transferred, total }` | SFTP 上传 / 下载进度，只发给发起该操作、拥有该会话的窗口（渲染层在状态栏显示进度条） |
| `file-editor:progress` | `{ transferred, total }` | 内置编辑器**读取远端文件**的实时进度（`transferred` = 已读字节、`total` = 文件总字节；空文件为 `0 / 0`），只发给发起读取的编辑器窗口（渲染层在工具栏下方显示进度条） |
| `transfer-window:open` | `{ target?, path?, rightTarget?, rightPath? }` | `{ ok }` | 打开 / 聚焦文件传输窗口（穿梭框）；`target` = **左侧栏**的 SSH 目标，`path` = 左侧栏初始目录（文件管理器右键「文件传输」时传入当前连接与目录）；`rightTarget` / `rightPath` = 右侧栏的 SSH 目标与目录（内嵌面板「分离为独立窗口」时传入，窗口会自动选中右侧连接）；窗口已打开时改为向其下发 `transfer-window:locate` 定位 |
| `transfer-window:info` | — | `{ ok, target, path, rightTarget, rightPath, settings }` | 传输窗口读取自身的初始连接 / 目录（含右侧）与当前设置（仅传输窗口可调用） |
| `transfer-window:close` | — | `{ ok }` | 关闭传输窗口（仅传输窗口可调用） |
| `transfer:run` | `{ fromId, toId, path, destDir, type? }` | `{ ok, transferred?, total?, files?, name?, localPath?, error? }` | 执行一次**远端 → 远端**传输（文件或目录，目录递归复制）：先把源端下载到**文件下载目录**（保留本地副本，重名加序号，`localPath` 为其路径），再从本地副本上传到目标端；源端 / 目标端为两端 SFTP 会话 id；**同一时刻只允许一个任务**，并发请求返回 `error: 'busy'`；进度经 `transfer:progress` 分「下载 / 上传」两段实时回传。**请求来源**：独立文件传输窗口**或终端窗口**（内嵌文件传输面板）；渲染层经 `window.ships.transfer.run(payload)` / `window.ships.transfer.onProgress(cb)` 调用 |
| `file-window:target` | `{ target, path }` | 独立文件窗口已打开时，`file-window:open` 带目标再次调用 → 请它切换连接并进入 `path` |
| `games:load` | `{ game }` | 复用游戏窗口时切换游戏；渲染层先 flush 旧游戏再重新加载 |
| `games:prepare-close` | — | 请求游戏窗口暂停、flush 电池存档后调用 `games:close-now` |
| `games:workdir-changed` | `{ workDir, resolvedWorkDir }` | 工作目录变更后通知主窗口重新扫描 |
| `games:fullscreen` | `{ fullscreen }` | 游戏窗口进入 / 退出原生全屏；渲染层隐藏 / 恢复头栏与控制区 |
| `ssh-config:changed` | `{ hosts }` | SSH 主机 / 分组增删改后广播（`ssh-config:upsert` / `remove` / `rename-group` 触发），终端窗口与独立文件窗口据此**实时刷新 SSH 下拉** |
| `settings:edit-ssh` | `{ alias }` | 设置窗口的 SSH 分区收到后打开该别名的编辑表单（由 `ssh:edit` 触发；等 hosts 加载完成再打开） |
| `update:progress` | 状态快照 | 下载进度变化（`percent` / `transferred` / `total` / `bytesPerSecond`），只发给更新窗口 |
| `update:downloaded` | 状态快照 | 下载完成（`phase: 'downloaded'`、`countdown: 60`），只发给更新窗口 |
| `update:countdown` | `{ countdown }` | 下载完成后的自动重启倒计时（每秒一次），只发给更新窗口 |
| `update:prompt` | 提示框对象或 `null` | 应用内提示框（`{ id, title, message, buttons, defaultId, cancelId, changelog }`）；`changelog` 为当前版本到最新版之间的 Markdown 更新日志（可能为空）；`null` = 提示结束 / 切回下载进度，只发给更新窗口 |
| `app:update-checking` | `{ checking }` | 自动 / 手动检查开始 / 结束时推送给设置窗口（`checking: true` 时按钮禁用并显示「检查更新中…」，`false` 恢复）；设置窗口未打开时不推送 |
| `settings:open-section` | `sectionId` | 请求设置窗口切换到指定分区（由 `window:open-settings` 的 `section` 触发） |

### 5.3 菜单与权限映射

- 托盘左键：切换主面板；托盘右键菜单：`打开设置`、`重启 Vessel`（`app.relaunch()` 后正常 `app.quit()`，保留退出清理流程）、`退出 Vessel`。
- **应用菜单**（`src/main/menu.js`）：自定义模板 = 应用菜单 / 编辑（撤销、剪切、拷贝、粘贴、全选；终端窗口另有**右键菜单**可复制选区 / 粘贴剪贴板，见 §3.8-4，因此编辑菜单只是快捷键层面的补充）/ 视图（放大、缩小、实际大小、全屏、开发者工具）/ 窗口菜单。视图里的三个缩放项 **只显示快捷键、不向系统注册**（`registerAccelerator: false`），改由主进程 `before-input-event` 统一处理：`Cmd + = / +` / `Cmd + -` / `Cmd + 0` —— **焦点在悬浮终端窗口时直接修改设置里的字号**（`terminal:zoom` → 写 `settings.terminalFontSize`，8–64px、默认 14px、持久化，改完重新 fit 并同步 PTY，并在头栏临时显示字号；同时改写 `--file-font-size`，文件管理部分一并缩放；**不改页面缩放因子**）；**焦点在独立文件窗口时不缩放**（字号固定 14px，`Cmd +/-` 无效）；其它窗口保持原来的整页缩放。两个悬浮窗口另外用 `setVisualZoomLevelLimits(1, 1)` 关掉 pinch 缩放、`zoom-changed` 把 `Cmd+滚轮` 也接到字号缩放上；页面缩放因子固定为 1，头栏 / 图标 / 内嵌文件面板随字号**等比缩放**（字号 = 终端字号，不再夹取 10–20px）。
- 不涉及系统权限申请（无摄像头/麦克风等）；SSH 连接依赖用户本机 iTerm 与 `~/.ssh/config`。

### 5.4 本地 API（CLI）

- **不监听任何 TCP 端口**。命令行支持走 `<数据目录>/vessel-cli.sock` 的 **Unix domain socket**（`src/main/services/cli-service.js`，仅 macOS 启动）：只有本机同一用户可连接（socket 文件权限 **0600**，应用退出时删除），不落盘任何令牌 / 密钥。
- 接口（HTTP over Unix socket，请求 `curl --unix-socket <sock> http://localhost<path>`）：

| 方法 / 路径 | 返回（`text/plain`） | 说明 |
| --- | --- | --- |
| `GET /v1/ping` | `ok` | 探活 |
| `GET /v1/tools` | 对齐表格：`ID` / `NAME`（**英文名**） | 工具清单；顺序取渲染层上报的清单，主界面从未打开时用内置英文兜底表；名称固定英文、不随界面语言变化 |
| `GET /v1/ssh` | 对齐表格：`HOST`（**归一化为 `用户名@地址`**）/ `GROUP` / `ALIAS` | 与 `~/.ssh/config` 解析结果一致；无用户名时 `HOST` 退回地址 |
| `GET /v1/2fa` | 对齐表格：`ACCOUNT` / `CODE` / `LEFT`（如 `18s`） | 验证码由主进程解密 TOTP 密钥后计算（明文密钥仍不下发） |
| `GET /v1/complete?kind=tool\|ssh` | 每行一个候选（纯文本、无表头） | 供 shell 补全：tool = id、ssh = `用户名@地址`（去重） |
| `POST /v1/tool`（请求体 = 工具 id 或名称） | `Opened tool: <id>` / 4xx `Unknown tool: …` | 显示主界面并加载该工具（`window-manager.showMainWindowWithTool`） |
| `POST /v1/ssh`（请求体两行：`<目标>` + 换行 + `<密码，可空>`） | `Connecting to <别名>` / 4xx `Target required…`、`Invalid target…` / 5xx | 命中已保存主机（别名，或同一「用户名@地址」且未给新密码）→ 直接连接；否则按「快速连接」逻辑连接（见下） |

- **数据命令路由**：`GET /v1/timestamp`（当前时间）、`POST /v1/timestamp`（转换一个值）、`GET /v1/network`（本机内网 / 公网 IPv4 / IPv6 地址）、`POST /v1/network`（网段信息）、`POST /v1/codec`（编码结果）、`POST /v1/json`（请求体首行 `text` / `file`，其余为 JSON 文本或文件路径，返回 4 空格缩进结果；可选查询参数 `?indent=N` 指定缩进空格数（0–10，**0 = 紧凑单行**，等同 `jq -c`），省略时用默认 4，非法值返回 400；可选查询参数 `?filter=<jq 过滤器>` 对结果做 jq 风格过滤（见 `jq-service`，语法错误 / 运行错误返回 400，没有命中时正文为空）；可选查询参数 `?search=<关键字>` 改为**模糊搜索**模式，返回「命中节点 + jq 风格路径」的表格（见 `json-search-service`），与 `?filter=` 同时给出时以 `?search=` 为准）、`POST /v1/hash`（请求体首行 `text` / `file`，其余为内容）、`POST /v1/id`（类型 + 可选长度，固定生成 5 个；旧的 `POST /v1/uuid` 保留为兼容别名）、`POST /v1/main`（显示主界面）、`POST /v1/restart`（先返回响应再重启应用）、`POST /v1/check-update`（触发一次交互式检查更新）、`POST /v1/upgrade`（从当前运行的 Vessel 重新安装 CLI）、`POST /v1/open`（在应用里打开工具，替代原来的 `/v1/tool`；`GET /v1/tools` 已移除）。响应均为纯文本表格。
- **`POST /v1/edit`**：请求体为文件路径（可为空）。空 → 新建本地草稿并用编辑器打开；非空 → 解析为绝对路径后打开（不存在返回 404、非文件 / 超过 20MB 返回 400）。编辑器窗口**无归属窗口**（不随任何窗口关闭）。
- **`POST /v1/ssh` 的目标解析**：`用户名@地址` / `地址` / `地址:端口` / `[IPv6]:端口`。**别名精确命中**，或**同一「用户名@地址」且没有提供新密码** → 用现有主机直接连接（自动沿用已存密码 / `~/.ssh/id_ed25519`）；其余写法走**快速连接**（`ssh-quick-connect-service`，与 SSH 工具的连接表单同一套实现）：`用户名@地址` 已存在时复用（给了密码则更新凭据），否则写入 `~/.ssh/config` 的「快速连接」分组并置于最前，然后**新开一扇内置终端**执行 `ssh`。密码可含空格（作为第 2 行原样传入），不需要密码时留空（走密钥）。
- **输出语言**：CLI 的 usage / 帮助 / 错误 / 表头 / 提示**全部为英文**；工具名固定用英文（不随界面语言变化），主机 / 账号名是数据本身、保持原样。列表按显示宽度（CJK / 全角按 2 列）对齐为固定列宽表格。
- **输出颜色**：`vessel.sh` 在**标准输出是终端**时给结果加 ANSI 颜色（表头加粗青色、UUID 绿色、`No …` / 错误类提示暗色、`键  值` 行的键为青色）；输出到管道 / 文件或 `vess` 被脚本调用时自动关闭颜色，保持纯文本。错误信息始终以红色写入 stderr。`json` 命令另用**按 JSON 语法着色**的输出（与 jq 的配色观感一致）：**键青色、字符串绿色、数字黄色、`true` 绿色 / `false` 红色、`null` 与括号暗色**，缩进本身不着色；着色同样只在终端下默认开启，可用 `--color` / `--no-color` 强制开启或关闭。
- **命令行 `vessel`**（安装位置 `<数据目录>/bin/vessel`，用法与终端内联命令 `\v` 同风格；**列表命令不带 `list` 子命令**，直接执行即列出）：
  - 命令**平铺**（不再有 `vessel tool` 子命令）：`vessel <命令> [参数]`；安装时同时创建 **`vess` 别名**（`<数据目录>/bin/vess` → symbol link 指向 `vessel`），两者等价。
  - **分层帮助**：主 `vess` / `vess help` 的 usage **只列出命令，不再包含 Examples**；`vess help <命令>`（或 `vess <命令> -h` / `--help`）输出该命令的详细参数说明与示例（如 `vess help network`、`vess help id`），未知命令返回非零并回退到 usage。
  - `ssh`：不带参数列出已保存主机（`用户名@地址` 归一化显示）；`ssh <user@host> [password]` 连接或快速连接；`ssh <别名>` 按别名连接。
  - `2fa`：列出账号与**当前验证码**（含剩余秒数）；不接受其它参数。2FA 已并入「ID 与密码」，`vessel twofa` 会打开合并后的工具。
  - `timestamp [value]`：不带参数输出当前时间（本地时间 / UTC / 秒 / 毫秒 / **纳秒**，纳秒用 `process.hrtime` 补出亚毫秒）；带参数时自动识别 `≤11 位秒 / ≤15 位毫秒 / 其余纳秒`，非纯数字按日期字符串解析。
  - `network [ip|cidr|mask]`（别名 `net` / `subnet` / `ip`）：不带参数输出本机 **内网（LAN）与公网（Public）IPv4 / IPv6** 地址；带参数输出网段信息（地址 / 类型 / CIDR / 前缀 / 网络地址 / 广播或最后地址 / 可用范围或地址总数 / 主机数 / 掩码 / 反掩码 / 地址类型）；支持 IPv4 / IPv6 / 纯数字 / `0x` 十六进制。
  - `codec <text>`（别名 `encode` / `text`）：输出文本的 Text / Base64 / Hex / URL 编码 / URL 解码 / ASCII 十进制。
  - `json [--indent N] [--color|--no-color] [filter] [file|text]`：**第一个位置参数**若是**已存在的文件** → 格式化该文件；若以 `.` 开头或是一个 jq 内置函数名 → 按**过滤器**处理（JSON 从 stdin 或第二个位置参数读，`vess json .name`）；否则按 JSON 文本解析；`-` 或管道 / 重定向时从 stdin 读取；输出 **4 空格缩进**的格式化 JSON（与 JSON 工具一致），`--indent N` 改缩进空格数（**0–10**，**0 = 紧凑单行**，等同 `jq -c`；非法值报「--indent must be a number between 0 and 10」）；非法 JSON 返回 400 与解析错误；输出在终端中按 JSON 语法着色（jq 风格，见「输出颜色」），管道 / 重定向时为纯文本，`--color` / `--no-color` 可强制开启或关闭；**无参数且非管道时保持原行为**：在应用里打开 JSON 工具。
  - **`--search <关键字>`（模糊搜索）**：在整棵 JSON 树里找出**键名命中**或**值命中**的节点，输出**表格**（三列 `PATH` / `TYPE` / `VALUE`，与其它 CLI 命令同样对齐；`PATH` 是该节点的 **jq 风格路径**，可直接拿去 `vess json <路径>` 查询）：
    - **命中判定**：键名或字符串 / 数字 / 布尔值**包含**关键字（**忽略大小写**）即命中；关键字 **≥ 3 个字符**时还允许**子序列**模糊匹配（`nme` 命中 `name`、`ite` 命中 `items`），但匹配跨度不得超过关键字长度的两倍（避免 `id` 命中 `weird key` 这类噪音）；容器（对象 / 数组）只按**键名**判定，不按内容判定；
    - **路径写法**：与 jq 一致 —— `.name` / `.items[0].id` / `."带空格的键"`；根节点自身记作 `.`；**同一个路径只出现一次**（键名与值同时命中时合并成一行）；
    - **结果顺序**：按 JSON 里的出现顺序（深度优先）；`VALUE` 用 JSON 表示（字符串带引号），超过 60 字符截断并加 `…`；没有命中时输出 `No matches for "<关键字>"`；
    - **输入来源**：与普通用法一致（stdin / 管道 / 文件 / JSON 文本）；**`--search` 模式下位置参数只当作输入**，不会被当成 jq 过滤器（因此 `--search` 与过滤器不能同时使用）；`--indent` 在搜索模式下不生效（输出是表格）。
  - **过滤器语法**（`src/main/services/jq-service.js`，jq 的一个子集；解析错误 / 运行错误返回 400，**没有命中任何结果时输出为空**）：
    - **路径**：`.`（恒等）、`.foo` / `.foo.bar`（字段）、`."foo bar"`（带引号的字段名）、`.[0]` / `.[-1]`（数组下标，**越界返回 null**）、`.[1:3]`（切片）、`.[]`（迭代数组元素 / 对象值）、`..`（递归下降，**含根本身**）、`..foo`（递归找 `foo` 字段）、`?`（可选：出错时不产生输出）；
    - **组合**：`|`（管道）、`,`（并集）、`//`（备选：左侧没有 false / null 的输出时改用右侧）、`and` / `or`（布尔，jq 真值规则）；
    - **比较与算术**：`==` `!=` `<` `<=` `>` `>=`（比较，结果为布尔；`==` 按结构相等、对象键顺序无关）、`+` `-` `*` `/` `%`（算术；`+` 另支持字符串拼接 / 数组拼接 / 对象合并（右侧覆盖同名键），`-` 另支持数组按值移除；`*` `/` `%` 只支持数字）、一元 `-`；优先级由低到高：`|` < `,` < `//` < `or` < `and` < 比较 < `+ -` < `* / %` < 一元 `-`；
    - **字面量**：数字、字符串（`\n \t \" \\ \uXXXX` 转义）、`true` / `false` / `null`；
    - **构造**：`[f]`（把 f 的输出收集成数组）、`{"key": f}`（对象构造）；
    - **内置函数**（0 参数）：`length` `keys` `keys_unsorted` `values` `type` `not` `empty` `add` `sort` `unique` `reverse` `flatten` `min` `max` `floor` `ceil` `round` `sqrt` `abs` `first` `last` `tostring` `tonumber` `tojson` `ascii_downcase` `ascii_upcase` `explode` `implode` `to_entries` `from_entries` `paths` `leaf_paths` `any` `all` `arrays` `objects` `strings` `numbers` `booleans` `nulls`；（1 参数）`has` `startswith` `endswith` `ltrimstr` `rtrimstr` `split` `join` `contains` `inside` `getpath` `test` `map` `map_values` `select` `sort_by` `group_by` `unique_by` `min_by` `max_by` `with_entries`；（2 参数）`range(a;b)` `range(a;b;c)` `limit(n; f)`。
    - **语义**：真值只有 `false` / `null` 为假；`keys` 对对象按字典序；`add` 对空数组返回 `null`；`flatten` 默认只摊平 1 层；`round` 负数远离零取整。
  - `hash <text|file>`：参数是**已存在的文件**时按文件计算，否则按文本计算；输出全部 10 种算法；无参数时从 stdin 读取。
  - `id [type] [length]`（兼容别名：`uuid` = `id uuid4`，`ulid` = `id ulid`）：按类型生成**固定 5 个**值；`type` ∈ `uuid4`（默认）/ `uuid7` / `ulid` / `random` / `password`，其它值返回 400。`uuid7` = 48 位毫秒时间戳 + 版本位 7 + 变体位；`ulid` = Crockford base32 的 26 位 ULID；`random` = 默认 16 位的字母 + 数字随机串（长度 4–64）；`password` = 默认 20 位、包含小写 / 大写 / 数字 / 符号且每类至少一个（长度 8–64，Fisher–Yates 洗牌）；随机数一律来自 Node `crypto`（CSPRNG）。
  - `edit [file]`：用内置编辑器新建本地草稿或打开指定本地文件（见上）。
  - 其余工具（`json` / `regex` / `color` / `ids` / `clipboard` / `nutrient` / `games`）：`vessel <工具 id>` 在应用里打开该工具（`/v1/open`）。
  - `main`：启动（如未运行）并显示 Vessel 主界面；不接受参数。
  - `restart`：重启 Vessel（先让 CLI 收到响应，再由主进程 `app.relaunch()` 后退出）；不接受参数。
  - `check-update`：在运行中的应用里触发一次**交互式检查更新**（与界面里的更新按钮同一流程，可能弹出更新窗口 / 提示）；不接受参数。
  - `upgrade`：从**当前运行的 Vessel** 重新安装 CLI（复制最新的 `vessel.sh` / `_vessel` 到 `<数据目录>/bin/`、重建 `vess` 别名并原地更新 `~/.zshrc` 的 PATH 块），输出当前应用版本与脚本路径；不接受参数。
  - `completion` 输出 zsh 补全函数（同时注册给 `vess` 与 `vessel`）；隐藏命令 `__complete ssh` 供补全取主机候选；`vess help <TAB>` 补全命令名。
  - `vessel completion` 输出 zsh 补全函数；隐藏命令 `vessel __complete <kind>` 供补全取候选（应用未运行时静默返回空）。
  - 应用未运行：先尝试 `open -b cn.com.stdout.vessel` 拉起（菜单栏应用，启动不弹主窗口），最多等 **10 秒**（50 × 200ms）再执行。
- **安装**（设置 → 数据 →「安装 CLI」，IPC `cli:install`）：复制 `assets/cli/vessel.sh` → `<数据目录>/bin/vessel`（0755）、`assets/cli/_vessel` → `<数据目录>/bin/_vessel`（0644），并在 `~/.zshrc` 写入（或原地替换，保证只有一块）如下标记块后重新安装也不会重复：

  ```zsh
  # >>> vessel cli >>>
  export PATH="<数据目录>/bin:$PATH"
  [ -r "<数据目录>/bin/_vessel" ] && . "<数据目录>/bin/_vessel"
  # <<< vessel cli <<<
  ```

  `_vessel` 只在已加载 `compinit`（存在 `compdef`）时注册补全，不影响未使用补全的 shell；补全候选来自 `vessel __complete`（`tool` = 工具 id、`ssh` = `用户名@地址`）。新开终端后生效。
- 设置页的「安装 CLI」按钮仅在 macOS 显示（`app:info` 的 `platform === 'darwin'`）；已安装时按钮变为「重新安装」并显示安装路径。

---
