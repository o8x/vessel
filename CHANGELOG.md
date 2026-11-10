# 更新日志

> 记录面向用户的功能变化，技术细节不在此展开。

## v6.6.0 - 2026-11-10

### 新增

- Highlight the cursor line in the active terminal
- Toggle split layout to terminal context menu
- Terminal split toggle to header
- Restart app to tray menu
- In-window terminal split panes

### 修复

- Narrow terminal line-number gutter to two digits
- Keep line numbers on the leftmost pane after split
- Restore random terminal ball icon on new windows
- Use distinct new-window icon in terminal header
- Keep quick connect open on window blur

## v6.5.1 - 2026-11-09

### 修复

- Size update window by content type

## v6.5.0 - 2026-11-09

### 新增

- Official WHOIS and ping lookup links
- Local address lookup to IP/subnet tool
- Restore radix conversion alongside unit conversion

## v6.4.0 - 2026-11-07

### 新增

- Split data and logs into separate settings sections

### 修复

- Show update check failure reason and shrink prompt window

## v6.3.0 - 2026-11-07

### 新增

- Vessel://open/terminal protocol
- Icons to file manager context menus
- Rework terminal shortcut and context menu
- Window management settings
- Replace radix tool with unit conversion
- SSH quick connect that opens a new terminal

### 修复

- Re-record terminal space after bringing it to front

## v6.2.0 - 2026-11-04

### 新增

- Show changelog in update window and add release notes automation

## v6.1.1 - 2026-11-03

### 修复

- 网段拆分结果改为每行一个，长列表更易阅读。
- 完善 IPv6 地址展开 / 压缩的补零显示，并正确隐藏当前不可用的协议区块。

## v6.1.0 - 2026-11-03

### 新增

- 子网计算支持 IPv6 地址的展开 / 压缩、完整 IPv6 子网计算与按数量拆分。

## v6.0.0 - 2026-11-02

### 新增

- 拖入终端窗口的文件 / 文件夹路径可直接插入终端。
- 打开主界面或设置窗口时自动检查更新。
- 支持终端背景透明、终端右键菜单。

### 修复

- 终端窗口不再始终置顶。
- 「网络测试」功能已移除。

## v5.5.0 - 2026-10-28

### 新增

- 文件管理支持粘贴本地文件。
- 8M 以内的文件可直接在内置编辑器打开，二进制文件以只读方式处理。
- 非文本文件支持仅下载，并可用 Wireshark 打开抓包文件。
- 编辑器新增「从 VS Code 打开」「下载到本地」按钮，并支持 8–128M 文件改用 VS Code 打开。

### 修复

- 编辑器工具栏占满宽度，保存状态移至底部状态栏。
- 文件列表单元格与表头补充水平留白。
- 父目录需双击进入。

## v5.0.0 - 2026-10-26

### 新增

- 文件管理显示目录，支持内嵌编辑器与更顺畅的文件操作。
- 终端窗口支持背景透明度与右键菜单。

### 变更

- 移除悬浮球模式。
