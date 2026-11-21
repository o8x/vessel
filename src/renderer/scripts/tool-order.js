"use strict"

// 顶部 TAB 工具顺序：改这个数组即可调整图标区顺序。
// 未在此列出的工具会按注册顺序追加到末尾。id 对应各工具注册时的 id。
window.ShipsToolOrder = [
    "ssh", // SSH 管理
    "twofa", // 2FA 动态验证码（TOTP）
    "timestamp", // 时间戳转换
    "subnet", // IP / 网段与掩码计算
    "encode", // 文本处理（编码转换 + 二维码 / Data Matrix + 大小写 / 行处理 / 统计）
    "radix", // 进制转换 + 单位转换（字节 / 位 / KiB–TiB / Kbps–Gbps）
    "json", // JSON 格式化
    "hash", // 哈希计算（MD5 / SHA1 / SHA256）
    "regex", // 正则测试（匹配 / 捕获组 / 替换预览 / 模式解释）
    "color", // 颜色转换（HEX / RGB / HSL / HSV / OKLCH + WCAG 对比度）
    "ids", // ID 与密码（UUID v4 / v7、ULID、随机字符串、随机密码）
    "nutrient", // 营养成分
    "clipboard", // 剪贴板
    "games", // 游戏（EmulatorJS）
]
