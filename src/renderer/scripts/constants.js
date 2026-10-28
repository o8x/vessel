'use strict';

window.ShipsConstants = {
  // ssh 退出标记（需与 src/shared/constants.js 的 SSH_EXIT_MARKER 保持一致）。
  SSH_EXIT_MARKER: '\u001b]777;VesselSshExit\u0007',
  // ssh 退出标记的 shell 片段；从 shell 回显中删除，避免在前台显示。
  SSH_EXIT_MARKER_COMMAND: "; printf '\\033]777;VesselSshExit\\007'",
  FALLBACK_VERSION: '0.0.0',
  COPY_FEEDBACK_MS: 1200,
  // 终端字号范围（Cmd +/- 与 设置 → 终端 共用）。
  TERMINAL_FONT_MIN: 8,
  TERMINAL_FONT_MAX: 64,
  TERMINAL_FONT_DEFAULT: 14,
  // 终端窗口标题栏：字号取自终端字号并夹在 10–20px；
  // 高度按字号线性映射并夹在 20–32px（10px 字号 → 20px，20px 字号 → 32px）。
  TERMINAL_HEADER_FONT_MIN: 10,
  TERMINAL_HEADER_FONT_MAX: 20,
  TERMINAL_HEADER_HEIGHT_MIN: 16,
  TERMINAL_HEADER_HEIGHT_MAX: 32,
  // 工具标题收起动画期间先锁住内容滚动，动画完成后再滚动内容。
  HEADER_COLLAPSE_LOCK_MS: 190,
  // Liquid Glass 表面透明度：glassOpacity(0–100，越大越透明) 映射到表面填充 alpha。
  // base = (100 - glassOpacity)/100 * GLASS_MAX_ALPHA，默认 80 → 0.08（现有观感）。
  GLASS_DEFAULT_OPACITY: 80,
  GLASS_MAX_ALPHA: 0.4,
  // 文件管理状态栏：所有提示的保留时长（到点惰性清除）。
  FILE_STATUS_TTL_MS: 30000,
  // 双击文件的默认打开方式：落在 [MIN, MAX] 体积区间内的文件下载后用 VS Code 打开。
  FILE_VSCODE_MIN_BYTES: 8 * 1024 * 1024,
  FILE_VSCODE_MAX_BYTES: 128 * 1024 * 1024,
  // 「编辑文件」上限：仅小于等于 8M、且扩展名属于 TEXT_EXTENSIONS 的文件可用内置编辑器打开。
  FILE_EDITOR_MAX_BYTES: 8 * 1024 * 1024,
  // 明确可按纯文本编辑的扩展名白名单（小写、不含点）。
  TEXT_EXTENSIONS: [
    // 纯文本 / 数据 / 配置
    'txt', 'text', 'log', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc',
    'csv', 'tsv', 'json', 'json5', 'jsonc', 'ndjson', 'jsonl', 'xml', 'xm', 'xsd', 'xsl',
    'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'config', 'properties', 'env',
    'editorconfig', 'gitignore', 'gitattributes', 'gitmodules', 'npmrc', 'nvmrc', 'yarnrc',
    'prettierrc', 'eslintrc', 'babelrc', 'lock', 'sql', 'graphql', 'gql', 'diff', 'patch',
    // 代码
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
    'py', 'pyi', 'rb', 'php', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hxx', 'hpp', 'hh',
    'cs', 'java', 'kt', 'kts', 'scala', 'swift', 'm', 'mm', 'dart', 'lua', 'pl', 'pm', 't',
    'r', 'jl', 'ex', 'exs', 'erl', 'hrl', 'hs', 'lhs', 'clj', 'cljs', 'cljc', 'edn',
    'lisp', 'el', 'scm', 'ss', 'ml', 'mli', 'fs', 'fsi', 'fsx', 'vb', 'asm', 's',
    'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'awk', 'sed', 'tcl',
    'nim', 'zig', 'v', 'sol', 'groovy', 'gradle', 'cmake', 'mk', 'proto', 'thrift',
    'avsc', 'hcl', 'tf', 'tfvars', 'nix', 'dhall', 'cue', 'glsl', 'vert', 'frag', 'wgsl',
    // 标记 / 样式
    'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
  ],
  // 无扩展名但明确是文本的文件名（小写）。
  TEXT_FILENAMES: [
    'makefile', 'dockerfile', 'containerfile', 'gemfile', 'rakefile', 'procfile',
    'vagrantfile', 'jenkinsfile', 'license', 'licence', 'readme', 'changelog', 'authors',
    'notice', 'contributing', 'codeowners',
  ],
  NON_TEXT_EXTENSIONS: [
    // 图片 / 设计稿
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'icns', 'cur', 'tif', 'tiff',
    'heic', 'avif', 'raw', 'cr2', 'nef', 'arw', 'dng', 'psd', 'psb', 'ai', 'sketch', 'fig', 'xcf',
    // 文档（Word / Excel / PPT / PDF / 电子书等）
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
    'pages', 'numbers', 'key', 'epub', 'mobi', 'azw', 'azw3', 'djvu',
    // 音视频
    'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'ape', 'aiff', 'wma',
    'mp4', 'mov', 'mkv', 'avi', 'webm', 'mpg', 'mpeg', 'm4v', '3gp', 'm2ts', 'vob', 'flv', 'wmv',
    // 压缩 / 镜像 / 虚拟磁盘
    'zip', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'tar', '7z', 'rar', 'dmg', 'iso', 'img',
    'vmdk', 'vdi', 'qcow2', 'ova', 'ovf',
    // 可执行 / 二进制 / 包
    'exe', 'dll', 'so', 'dylib', 'bin', 'app', 'pkg', 'deb', 'rpm', 'msi', 'msix', 'appx',
    'apk', 'xapk', 'ipa', 'jar', 'war', 'ear', 'class', 'dex', 'pyc', 'pyo', 'o', 'a', 'lib',
    'obj', 'ko', 'wasm', 'crx', 'xpi', 'vsix',
    // 数据 / 数据库 / 抓包 / 3D
    'db', 'sqlite', 'sqlite3', 'mdb', 'dat', 'pcap', 'pcapng',
    'blend', '3ds', 'stl', 'glb', 'gltf', 'fbx',
    // 字体
    'ttf', 'ttc', 'otf', 'woff', 'woff2', 'eot',
  ],
  // 右键「从 Wireshark 打开」：仅 pcap / pcapng 且体积不超过 4GB。
  WIRESHARK_EXTENSIONS: ['pcap', 'pcapng'],
  WIRESHARK_MAX_BYTES: 4 * 1024 * 1024 * 1024,
  DEBOUNCE_MS: 120,
  // 游戏列表分批渲染：每批 tile 数量（几千个 ROM 时避免一次性建满 DOM）。
  GAME_TILE_CHUNK_SIZE: 120,
  // 占位封面文字：忽略括号内容，取前两个有效单词；连接字符不计入长度；
  // 汉字按 2 个单位、其它字母 / 数字按 1 个单位，上限 16 个单位（= 8 个汉字）。
  GAME_COVER_LABEL_WORDS: 2,
  GAME_COVER_LABEL_MAX_UNITS: 16,
  GAME_COVER_HAN_UNITS: 2,
  ACCENT_PRESETS: ['#2e6bfc', '#7c3aed', '#e5484d', '#f59e0b', '#10b981', '#0ea5e9', '#ec4899'],
  JSON_HIGHLIGHT_MAX_BYTES: 1024 * 1024,
  LANGUAGES: [
    { value: 'zh', label: '简体中文' },
    { value: 'en', label: 'English' },
  ],
  ANSI_COLORS: {
    reset: '\u001b[0m',
  },
  // SSH 目录浏览：文件按扩展名 / 文件名映射到 assets/icons 里的图标。
  // 目录固定用 folder，未命中的文件用 DEFAULT_FILE_ICON。
  FILE_TYPE_ICONS: {
    // 代码
    js: 'code', mjs: 'code', cjs: 'code', ts: 'code', jsx: 'code', tsx: 'code', vue: 'code',
    py: 'code', rb: 'code', go: 'code', rs: 'code', c: 'code', h: 'code', cc: 'code',
    cpp: 'code', hpp: 'code', cs: 'code', java: 'code', kt: 'code', swift: 'code',
    php: 'code', pl: 'code', lua: 'code', html: 'code', htm: 'code', css: 'code',
    scss: 'code', less: 'code', sql: 'code',
    // 脚本
    sh: 'terminal', bash: 'terminal', zsh: 'terminal', fish: 'terminal', ps1: 'terminal', bat: 'terminal',
    // 结构化数据 / 配置
    json: 'braces', jsonc: 'braces', yml: 'braces', yaml: 'braces', toml: 'braces', ini: 'braces',
    conf: 'braces', cfg: 'braces', env: 'braces', properties: 'braces', xml: 'braces',
    // 文本 / 文档
    md: 'doc', markdown: 'doc', txt: 'doc', log: 'doc', rst: 'doc', csv: 'doc', tsv: 'doc',
    doc: 'doc', docx: 'doc', pdf: 'doc', rtf: 'doc',
    // 图片
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
    svg: 'image', ico: 'image', tif: 'image', tiff: 'image', heic: 'image', avif: 'image',
    // 音视频
    mp3: 'play', wav: 'play', flac: 'play', aac: 'play', m4a: 'play', ogg: 'play',
    mp4: 'play', mov: 'play', mkv: 'play', avi: 'play', webm: 'play', mpg: 'play',
    // 压缩包 / 镜像
    zip: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive', zst: 'archive',
    tar: 'archive', '7z': 'archive', rar: 'archive', dmg: 'archive', iso: 'archive',
  },
  FILE_NAME_ICONS: {
    makefile: 'code',
    dockerfile: 'code',
    license: 'doc',
    readme: 'doc',
  },
  DEFAULT_FILE_ICON: 'file',
  // IP 工具：端口测试可选协议（needsPort=false 时禁用端口输入）。
  // 需与 src/main/utils/net-test.js 的 PROTOCOLS 保持一致。
  NET_TEST_PROTOCOLS: [
    { value: 'tcp', label: 'TCP', tipKey: 'tipTcp', port: 'required' },
    { value: 'udp', label: 'UDP', tipKey: 'tipUdp', port: 'required' },
    // 标签保持短（单行 TAB 放得下），完整含义见 tipKey 文案。
    { value: 'http', label: 'HTTP', tipKey: 'tipHttp', port: 'required' },
    { value: 'icmp', label: 'ICMP', tipKey: 'tipIcmp', port: 'none' },
    { value: 'arp', label: 'ARP', tipKey: 'tipArp', port: 'none' },
    // 扫描应用单地址 / 网段都行，端口可留空（扫可用端口）；扫描主机需要网段。
    { value: 'scan-app', labelKey: 'scanApp', tipKey: 'tipScanApp', port: 'optional' },
    { value: 'scan-host', labelKey: 'scanHost', tipKey: 'tipScanHost', port: 'none', subnetOnly: true },
  ],
  NET_TEST_DEFAULT_PORT: 80,
  NET_TEST_SCAN_PREFIX_MIN: 16,
  NET_TEST_SCAN_PREFIX_MAX: 30,
};
