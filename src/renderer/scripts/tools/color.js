'use strict';

/* 颜色转换工具：HEX / RGB / RGBA / HSL / HSLA / HSV / HSBA / OKLCH / OKLAB 互转，
   带实时色块预览与 WCAG 对比度检查（含透明度合成）。
   全部逻辑在渲染层完成（纯前端、无 IPC、无新依赖）。 */

(function registerColorTool() {
  const { el, section, inputField, resultRow, copyText, Icons } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      tools: { color: '颜色转换' },
      toolDesc: { color: 'HEX / RGB / HSL / HSV / OKLCH 互转与 WCAG 对比度检查' },
      color: {
        input: '颜色',
        placeholder: '#3498db / rgb(52, 152, 219) / hsl(204, 70%, 53%)',
        hint: '支持 HEX、RGB(A)、HSL(A)、HSV(A) 输入，格式非法时下方会提示。',
        invalid: '无法识别的颜色格式',
        random: '随机颜色',
        copyHex: '复制 HEX',
        copied: '已复制',
        copyFailed: '复制失败',
        preview: '预览',
        pickColor: '点击选择颜色',
        formats: '格式换算',
        contrast: '对比度检查',
        foreground: '前景色',
        background: '背景色',
        contrastHint: '前景色带透明度时按标准 alpha 合成到背景色后再计算对比度。',
        ratio: '对比度',
        wcagAaNormal: 'AA 正文 (≥4.5:1)',
        wcagAaaNormal: 'AAA 正文 (≥7:1)',
        wcagAaLarge: 'AA 大字 (≥3:1)',
        wcagAaaLarge: 'AAA 大字 (≥4.5:1)',
        pass: '通过',
        fail: '未通过',
        recommend: '推荐前景色',
        recommendValue: '{color}（对比度 {ratio}:1）',
        fmtHex: 'HEX',
        fmtHexa: 'HEXA',
        fmtRgb: 'RGB',
        fmtRgba: 'RGBA',
        fmtHsl: 'HSL',
        fmtHsla: 'HSLA',
        fmtHsv: 'HSV',
        fmtHsva: 'HSBA',
        fmtOklch: 'OKLCH',
        fmtOklab: 'OKLAB',
      },
    },
    en: {
      tools: { color: 'Color converter' },
      toolDesc: { color: 'HEX / RGB / HSL / HSV / OKLCH conversion with WCAG contrast checks' },
      color: {
        input: 'Color',
        placeholder: '#3498db / rgb(52, 152, 219) / hsl(204, 70%, 53%)',
        hint: 'Accepts HEX, RGB(A), HSL(A) and HSV(A); invalid values are flagged below.',
        invalid: 'Unrecognized color format',
        random: 'Random color',
        copyHex: 'Copy HEX',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        preview: 'Preview',
        pickColor: 'Click to pick a color',
        formats: 'Formats',
        contrast: 'Contrast check',
        foreground: 'Foreground',
        background: 'Background',
        contrastHint: 'A translucent foreground is alpha-composited over the background before measuring.',
        ratio: 'Contrast ratio',
        wcagAaNormal: 'AA body (≥4.5:1)',
        wcagAaaNormal: 'AAA body (≥7:1)',
        wcagAaLarge: 'AA large (≥3:1)',
        wcagAaaLarge: 'AAA large (≥4.5:1)',
        pass: 'Pass',
        fail: 'Fail',
        recommend: 'Recommended foreground',
        recommendValue: '{color} (ratio {ratio}:1)',
        fmtHex: 'HEX',
        fmtHexa: 'HEXA',
        fmtRgb: 'RGB',
        fmtRgba: 'RGBA',
        fmtHsl: 'HSL',
        fmtHsla: 'HSLA',
        fmtHsv: 'HSV',
        fmtHsva: 'HSBA',
        fmtOklch: 'OKLCH',
        fmtOklab: 'OKLAB',
      },
    },
  });

  /* ------------------------------ 颜色核心算法 ------------------------------ */
  /* 该区块只含纯函数（不依赖 DOM / i18n），便于离线断言。 */

  /* 数值裁剪 */
  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return value < min ? min : value > max ? max : value;
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  /* 保留 n 位小数的四舍五入（仅用于显示） */
  function roundTo(value, digits) {
    if (!Number.isFinite(value)) return 0;
    const factor = Math.pow(10, digits);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const BLACK = { r: 0, g: 0, b: 0, a: 1 };

  /* ---------------- HEX 解析 ---------------- */

  /* 支持 3 / 4 / 6 / 8 位，带或不带 '#' */
  function parseHex(text) {
    const body = String(text).trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]+$/.test(body)) return null;
    const expand = (ch) => parseInt(ch + ch, 16);
    const pair = (i) => parseInt(body.slice(i, i + 2), 16);
    if (body.length === 3 || body.length === 4) {
      return {
        r: expand(body[0]),
        g: expand(body[1]),
        b: expand(body[2]),
        a: body.length === 4 ? expand(body[3]) / 255 : 1,
      };
    }
    if (body.length === 6 || body.length === 8) {
      return {
        r: pair(0),
        g: pair(2),
        b: pair(4),
        a: body.length === 8 ? pair(6) / 255 : 1,
      };
    }
    return null;
  }

  /* ---------------- 通用分量解析 ---------------- */

  /* 解析单个数值：返回 { percent, value } 或 null */
  function parseNumberToken(token) {
    const raw = String(token == null ? '' : token).trim();
    if (!raw) return null;
    const body = raw.endsWith('%') ? raw.slice(0, -1).trim() : raw;
    // 只接受十进制数字（排除 0x10、Infinity、'' 等 Number() 会放过的写法）。
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(body)) return null;
    const value = Number(body);
    if (!Number.isFinite(value)) return null;
    return { percent: raw.endsWith('%'), value };
  }

  /* 解析 alpha：0 - 1 的小数，或 0% - 100% */
  function parseAlphaToken(token) {
    const parsed = parseNumberToken(token);
    if (!parsed) return null;
    if (parsed.percent) {
      if (parsed.value < 0 || parsed.value > 100) return null;
      return parsed.value / 100;
    }
    if (parsed.value < 0 || parsed.value > 1) return null;
    return parsed.value;
  }

  /* 解析色相（度），允许 'deg' 后缀 */
  function parseHueToken(token) {
    const raw = String(token == null ? '' : token).trim().replace(/deg$/i, '');
    const parsed = parseNumberToken(raw);
    if (!parsed || parsed.percent) return null;
    return parsed.value;
  }

  /* 解析 0 - 100 的百分比量（不带 % 时也按百分比数值处理） */
  function parsePercentToken(token) {
    const parsed = parseNumberToken(token);
    if (!parsed) return null;
    const value = parsed.value;
    if (value < 0 || value > 100) return null;
    return value;
  }

  /* 把参数串拆成「分量 + alpha」：支持逗号、空格与 '/' 分隔 */
  function splitColorArgs(body) {
    const parts = String(body).split('/');
    const tokens = parts[0].split(/[\s,]+/).filter(Boolean);
    let alphaToken = parts.length > 1 ? parts.slice(1).join(' ').trim() : '';
    if (!alphaToken && tokens.length === 4) alphaToken = tokens.pop();
    return { tokens, alphaToken };
  }

  /* ---------------- RGB / HSL / HSV 解析 ---------------- */

  /* tokens: 3 个颜色分量（可带 %），可选第 4 个为 alpha */
  function parseRgbTokens(tokens, alphaToken) {
    if (tokens.length !== 3) return null;
    const channels = [];
    for (let i = 0; i < 3; i += 1) {
      const parsed = parseNumberToken(tokens[i]);
      if (!parsed) return null;
      let value;
      if (parsed.percent) {
        if (parsed.value < 0 || parsed.value > 100) return null;
        value = (parsed.value / 100) * 255;
      } else {
        if (parsed.value < 0 || parsed.value > 255) return null;
        value = parsed.value;
      }
      channels.push(value);
    }
    let alpha = 1;
    if (alphaToken != null && alphaToken !== '') {
      alpha = parseAlphaToken(alphaToken);
      if (alpha == null) return null;
    }
    return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
  }

  /* tokens: 色相（度）、饱和度 %、明度 %，可选第 4 个为 alpha */
  function parseHslTokens(tokens, alphaToken) {
    if (tokens.length !== 3) return null;
    const hue = parseHueToken(tokens[0]);
    const saturation = parsePercentToken(tokens[1]);
    const lightness = parsePercentToken(tokens[2]);
    if (hue == null || saturation == null || lightness == null) return null;
    let alpha = 1;
    if (alphaToken != null && alphaToken !== '') {
      alpha = parseAlphaToken(alphaToken);
      if (alpha == null) return null;
    }
    const rgb = hslToRgb({ h: hue, s: saturation, l: lightness });
    rgb.a = alpha;
    return rgb;
  }

  /* tokens: 色相（度）、饱和度 %、明度 %，可选第 4 个为 alpha */
  function parseHsvTokens(tokens, alphaToken) {
    if (tokens.length !== 3) return null;
    const hue = parseHueToken(tokens[0]);
    const saturation = parsePercentToken(tokens[1]);
    const value = parsePercentToken(tokens[2]);
    if (hue == null || saturation == null || value == null) return null;
    let alpha = 1;
    if (alphaToken != null && alphaToken !== '') {
      alpha = parseAlphaToken(alphaToken);
      if (alpha == null) return null;
    }
    const rgb = hsvToRgb({ h: hue, s: saturation, v: value });
    rgb.a = alpha;
    return rgb;
  }

  /* 解析任意受支持的写法；失败返回 null（调用方据此显示红色错误） */
  function parseColor(input) {
    try {
      const text = String(input == null ? '' : input).trim();
      if (!text) return null;
      const fn = text.toLowerCase().match(/^([a-z]+)\s*\(([^)]*)\)$/);
      if (fn) {
        const { tokens, alphaToken } = splitColorArgs(fn[2]);
        if (fn[1] === 'rgb' || fn[1] === 'rgba') return parseRgbTokens(tokens, alphaToken);
        if (fn[1] === 'hsl' || fn[1] === 'hsla') return parseHslTokens(tokens, alphaToken);
        if (fn[1] === 'hsv' || fn[1] === 'hsba' || fn[1] === 'hsb') return parseHsvTokens(tokens, alphaToken);
        return null;
      }
      if (text.includes(',')) {
        const tokens = text.split(',').map((part) => part.trim()).filter(Boolean);
        if (tokens.length !== 3 && tokens.length !== 4) return null;
        const alphaToken = tokens.length === 4 ? tokens.pop() : '';
        const hasPercent = tokens.some((token) => token.includes('%'));
        const headIsNumber = !tokens[0].includes('%');
        const tailHasPercent = tokens.some((token) => token.includes('%'));
        // 形如 "0, 100%, 50%" 视为 HSL；其余按 RGB 处理。
        if (hasPercent && headIsNumber && tailHasPercent) {
          return parseHslTokens(tokens, alphaToken);
        }
        return parseRgbTokens(tokens, alphaToken);
      }
      return parseHex(text);
    } catch (err) {
      return null;
    }
  }

  /* ---------------- sRGB ↔ HSL / HSV ---------------- */

  function rgbToHsl(rgb) {
    const r = clamp(rgb.r, 0, 255) / 255;
    const g = clamp(rgb.g, 0, 255) / 255;
    const b = clamp(rgb.b, 0, 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hslToRgb(hsl) {
    const h = ((((hsl.h % 360) + 360) % 360) / 360);
    const s = clamp(hsl.s, 0, 100) / 100;
    const l = clamp(hsl.l, 0, 100) / 100;
    if (s === 0) {
      const v = l * 255;
      return { r: v, g: v, b: v, a: 1 };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      let x = t;
      if (x < 0) x += 1;
      if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    return {
      r: hue2rgb(h + 1 / 3) * 255,
      g: hue2rgb(h) * 255,
      b: hue2rgb(h - 1 / 3) * 255,
      a: 1,
    };
  }

  function rgbToHsv(rgb) {
    const r = clamp(rgb.r, 0, 255) / 255;
    const g = clamp(rgb.g, 0, 255) / 255;
    const b = clamp(rgb.b, 0, 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    const s = max === 0 ? 0 : d / max;
    return { h: h * 360, s: s * 100, v: max * 100 };
  }

  function hsvToRgb(hsv) {
    const h = ((((hsv.h % 360) + 360) % 360) / 60);
    const s = clamp(hsv.s, 0, 100) / 100;
    const v = clamp(hsv.v, 0, 100) / 100;
    const i = Math.floor(h);
    const f = h - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r;
    let g;
    let b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
    return { r: r * 255, g: g * 255, b: b * 255, a: 1 };
  }

  /* ---------------- sRGB ↔ OKLab / OKLCH（Björn Ottosson 矩阵） ---------------- */

  function srgbToLinear(channel) {
    const c = clamp01(channel);
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(channel) {
    const c = channel <= 0 ? 0 : channel;
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  function rgbToOklab(rgb) {
    const r = srgbToLinear(rgb.r / 255);
    const g = srgbToLinear(rgb.g / 255);
    const b = srgbToLinear(rgb.b / 255);
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    return {
      L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    };
  }

  function oklabToRgb(lab) {
    const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return {
      r: clamp(linearToSrgb(r) * 255, 0, 255),
      g: clamp(linearToSrgb(g) * 255, 0, 255),
      b: clamp(linearToSrgb(b) * 255, 0, 255),
      a: 1,
    };
  }

  function rgbToOklch(rgb) {
    const lab = rgbToOklab(rgb);
    const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { L: lab.L, C: c, h };
  }

  function oklchToRgb(oklch) {
    const rad = (oklch.h * Math.PI) / 180;
    return oklabToRgb({
      L: oklch.L,
      a: oklch.C * Math.cos(rad),
      b: oklch.C * Math.sin(rad),
    });
  }

  /* ---------------- WCAG 对比度 ---------------- */

  /* WCAG 相对亮度（阈值 0.03928） */
  function wcagLinearize(channel) {
    const c = clamp01(channel);
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(rgb) {
    const r = wcagLinearize(rgb.r / 255);
    const g = wcagLinearize(rgb.g / 255);
    const b = wcagLinearize(rgb.b / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(fg, bg) {
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* 标准 alpha 合成：result = fg * alpha + bg * (1 - alpha) */
  function compositeOver(fg, bg) {
    const alpha = clamp01(fg.a == null ? 1 : fg.a);
    return {
      r: fg.r * alpha + bg.r * (1 - alpha),
      g: fg.g * alpha + bg.g * (1 - alpha),
      b: fg.b * alpha + bg.b * (1 - alpha),
      a: 1,
    };
  }

  /* 背景色本身带透明度时，先合成到白色画布上 */
  function flattenBackground(bg) {
    if (bg.a == null || bg.a >= 1) return bg;
    return compositeOver(bg, WHITE);
  }

  /* 计算前景 / 背景的对比度（前景带透明度时先合成） */
  function computeContrast(fg, bg) {
    const background = flattenBackground(bg);
    const foreground = compositeOver(fg, background);
    return {
      ratio: contrastRatio(foreground, background),
      foreground,
      background,
    };
  }

  /* 给定背景色，推荐对比度更高的前景色（黑或白） */
  function recommendForeground(bg) {
    const background = flattenBackground(bg);
    const white = contrastRatio(WHITE, background);
    const black = contrastRatio(BLACK, background);
    return white >= black
      ? { color: '#ffffff', ratio: white }
      : { color: '#000000', ratio: black };
  }

  /* ---------------- 格式化 ---------------- */

  function toHexPair(value) {
    const byte = Math.round(clamp(value, 0, 255));
    return byte.toString(16).padStart(2, '0');
  }

  function formatHex(rgb) {
    return `#${toHexPair(rgb.r)}${toHexPair(rgb.g)}${toHexPair(rgb.b)}`;
  }

  function formatHexa(rgb) {
    const alpha = Math.round(clamp01(rgb.a == null ? 1 : rgb.a) * 255);
    return `#${toHexPair(rgb.r)}${toHexPair(rgb.g)}${toHexPair(rgb.b)}${alpha.toString(16).padStart(2, '0')}`;
  }

  function formatAlpha(alpha) {
    return String(roundTo(clamp01(alpha == null ? 1 : alpha), 3));
  }

  function formatRgb(rgb) {
    return `rgb(${Math.round(clamp(rgb.r, 0, 255))}, ${Math.round(clamp(rgb.g, 0, 255))}, ${Math.round(clamp(rgb.b, 0, 255))})`;
  }

  function formatRgba(rgb) {
    return `rgba(${Math.round(clamp(rgb.r, 0, 255))}, ${Math.round(clamp(rgb.g, 0, 255))}, ${Math.round(clamp(rgb.b, 0, 255))}, ${formatAlpha(rgb.a)})`;
  }

  function formatHsl(hsl) {
    return `hsl(${roundTo(hsl.h, 1)}, ${roundTo(hsl.s, 1)}%, ${roundTo(hsl.l, 1)}%)`;
  }

  function formatHsla(hsl, alpha) {
    return `hsla(${roundTo(hsl.h, 1)}, ${roundTo(hsl.s, 1)}%, ${roundTo(hsl.l, 1)}%, ${formatAlpha(alpha)})`;
  }

  function formatHsv(hsv) {
    return `hsv(${roundTo(hsv.h, 1)}, ${roundTo(hsv.s, 1)}%, ${roundTo(hsv.v, 1)}%)`;
  }

  function formatHsva(hsv, alpha) {
    return `hsva(${roundTo(hsv.h, 1)}, ${roundTo(hsv.s, 1)}%, ${roundTo(hsv.v, 1)}%, ${formatAlpha(alpha)})`;
  }

  function formatOklch(oklch) {
    return `oklch(${roundTo(oklch.L * 100, 2)}% ${roundTo(oklch.C, 4)} ${roundTo(oklch.h, 2)})`;
  }

  function formatOklab(lab) {
    return `oklab(${roundTo(lab.L * 100, 2)}% ${roundTo(lab.a, 4)} ${roundTo(lab.b, 4)})`;
  }

  /* ------------------------------ 颜色核心算法结束 ------------------------------ */

  /* 随机颜色（优先使用系统密码学随机源） */
  function randomColorHex() {
    const bytes = new Uint8Array(3);
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        window.crypto.getRandomValues(bytes);
      } else {
        bytes[0] = Math.floor(Math.random() * 256);
        bytes[1] = Math.floor(Math.random() * 256);
        bytes[2] = Math.floor(Math.random() * 256);
      }
    } catch (err) {
      bytes[0] = Math.floor(Math.random() * 256);
      bytes[1] = Math.floor(Math.random() * 256);
      bytes[2] = Math.floor(Math.random() * 256);
    }
    return formatHex({ r: bytes[0], g: bytes[1], b: bytes[2], a: 1 });
  }

  /* 棋盘格背景（用内联样式实现，便于看清透明度） */
  const CHECKERBOARD_STYLE =
    'background-image: linear-gradient(45deg, #d9d9de 25%, transparent 25%),' +
    'linear-gradient(-45deg, #d9d9de 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, #d9d9de 75%),' +
    'linear-gradient(-45deg, transparent 75%, #d9d9de 75%);' +
    'background-size: 16px 16px;' +
    'background-position: 0 0, 0 8px, 8px -8px, -8px 0px;' +
    'background-color: #ffffff;';

  function mount(container) {
    /* ---------- 输入区 ---------- */

    const colorInput = el('input', {
      class: 'field font-mono',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: i18n.t('color.placeholder'),
    });

    const colorHint = el('div', { class: 'mt-1 text-[10px]' }, '');
    const colorField = inputField('', colorInput);
    colorField.appendChild(colorHint);

    const randomBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' });
    randomBtn.append(el('span', { class: 'inline-flex' }, Icons.refresh(13)), el('span', {}, i18n.t('color.random')));

    const copyHexBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' });
    copyHexBtn.append(el('span', { class: 'inline-flex' }, Icons.copy(13)), el('span', {}, i18n.t('color.copyHex')));

    const inputActions = el('div', { class: 'mt-2 flex flex-wrap gap-1.5' });
    inputActions.append(randomBtn, copyHexBtn);

    /* ---------- 预览色块 + 输入框（合并为一行） ---------- */

    const swatch = el('div', {
      class: 'color-swatch h-[72px] w-[72px] shrink-0 rounded-control border border-border',
      style: CHECKERBOARD_STYLE,
      'data-tip': i18n.t('color.pickColor'),
    });
    const swatchFill = el('div', { class: 'h-full w-full rounded-[inherit]' });
    // 原生取色器覆盖在色块上：点击色块即打开系统颜色面板。
    const swatchPicker = el('input', {
      class: 'color-swatch-input',
      type: 'color',
      value: '#3498db',
      'aria-label': i18n.t('color.pickColor'),
    });
    swatch.append(swatchFill, swatchPicker);

    const previewText = el('div', { class: 'min-w-0 flex-1' });
    previewText.append(colorField, inputActions);

    const previewRow = el('div', { class: 'flex items-start gap-3' });
    previewRow.append(swatch, previewText);

    const inputSection = section();
    inputSection.append(
      el('div', { class: 'text-[11px] text-fg-muted' }, i18n.t('color.hint')),
      previewRow
    );

    /* ---------- 格式换算区 ---------- */

    const formatRows = {
      hex: resultRow(i18n.t('color.fmtHex')),
      hexa: resultRow(i18n.t('color.fmtHexa')),
      rgb: resultRow(i18n.t('color.fmtRgb')),
      rgba: resultRow(i18n.t('color.fmtRgba')),
      hsl: resultRow(i18n.t('color.fmtHsl')),
      hsla: resultRow(i18n.t('color.fmtHsla')),
      hsv: resultRow(i18n.t('color.fmtHsv')),
      hsva: resultRow(i18n.t('color.fmtHsva')),
      oklch: resultRow(i18n.t('color.fmtOklch')),
      oklab: resultRow(i18n.t('color.fmtOklab')),
    };

    const formatGrid = el('div', { class: 'grid grid-cols-2 gap-1.5' });
    for (const key of Object.keys(formatRows)) formatGrid.appendChild(formatRows[key].root);

    const formatsSection = section(i18n.t('color.formats'));
    formatsSection.appendChild(formatGrid);

    /* ---------- 对比度区 ---------- */

    const fgInput = el('input', {
      class: 'field font-mono',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: '#000000',
    });
    const bgInput = el('input', {
      class: 'field font-mono',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: '#ffffff',
    });
    const fgHint = el('div', { class: 'mt-1 text-[10px]' }, '');
    const bgHint = el('div', { class: 'mt-1 text-[10px]' }, '');
    const fgSwatch = colorSwatchFor(fgInput, '#000000');
    const bgSwatch = colorSwatchFor(bgInput, '#ffffff');
    const fgRow = el('div', { class: 'flex items-center gap-2' });
    const bgRow = el('div', { class: 'flex items-center gap-2' });
    fgRow.append(fgSwatch.root, fgInput);
    bgRow.append(bgSwatch.root, bgInput);
    const fgField = inputField(i18n.t('color.foreground'), fgRow);
    const bgField = inputField(i18n.t('color.background'), bgRow);
    fgField.appendChild(fgHint);
    bgField.appendChild(bgHint);

    const swapBtn = el('button', { class: 'icon-btn h-7 w-7 shrink-0', type: 'button' });
    swapBtn.innerHTML = Icons.swap(14);
    swapBtn.setAttribute('data-tip', i18n.t('color.foreground'));

    const colorInputs = el('div', { class: 'flex items-end gap-2' });
    const fgWrap = el('div', { class: 'min-w-0 flex-1' });
    const bgWrap = el('div', { class: 'min-w-0 flex-1' });
    fgWrap.appendChild(fgField);
    bgWrap.appendChild(bgField);
    colorInputs.append(fgWrap, swapBtn, bgWrap);

    const ratioValue = el('div', { class: 'result-value text-[18px]' }, '—');
    const ratioLabel = el('div', { class: 'text-[11px] text-fg-muted' }, i18n.t('color.ratio'));
    const ratioBox = el('div', { class: 'rounded-card border border-border bg-surface px-2.5 py-2' });
    ratioBox.append(ratioLabel, ratioValue);

    const badgeBox = el('div', { class: 'flex flex-wrap gap-1.5' });

    const recommendSwatch = el('div', {
      class: 'h-5 w-5 shrink-0 rounded-control border border-border',
      style: 'background-color: #ffffff;',
    });
    const recommendText = el('div', { class: 'text-[12px]' }, '—');
    const recommendRow = el('div', { class: 'flex items-center gap-2' });
    recommendRow.append(recommendSwatch, recommendText);

    const contrastGrid = el('div', { class: 'grid grid-cols-2 gap-2' });
    contrastGrid.append(ratioBox, badgeBox);

    const contrastSection = section(i18n.t('color.contrast'));
    contrastSection.append(
      el('div', { class: 'text-[11px] text-fg-muted' }, i18n.t('color.contrastHint')),
      colorInputs,
      contrastGrid,
      recommendRow
    );

    /* ---------- 状态更新 ---------- */

    function setFieldError(inputEl, hintEl, invalid) {
      inputEl.style.borderColor = invalid ? 'var(--color-danger)' : '';
      hintEl.textContent = invalid ? i18n.t('color.invalid') : '';
      hintEl.style.color = invalid ? 'var(--color-danger)' : '';
    }

    function clearFormats() {
      for (const key of Object.keys(formatRows)) formatRows[key].set(null);
    }

    function clearPreview() {
      swatchFill.style.backgroundColor = 'transparent';
    }

    /* 对比度区的小色块：点击色块打开系统取色器，选择后自动写入输入框。 */
    function colorSwatchFor(input, initial) {
      const root = el('div', {
        class: 'color-swatch color-swatch-sm shrink-0 rounded-control border border-border',
        style: CHECKERBOARD_STYLE,
        'data-tip': i18n.t('color.pickColor'),
      });
      const fill = el('div', { class: 'h-full w-full rounded-[inherit]' });
      const picker = el('input', {
        class: 'color-swatch-input',
        type: 'color',
        value: initial,
        'aria-label': i18n.t('color.pickColor'),
      });
      const sync = () => {
        const rgb = parseColor(input.value);
        if (!rgb) {
          fill.style.backgroundColor = 'transparent';
          return;
        }
        fill.style.backgroundColor = `rgba(${Math.round(clamp(rgb.r, 0, 255))}, ${Math.round(
          clamp(rgb.g, 0, 255)
        )}, ${Math.round(clamp(rgb.b, 0, 255))}, ${clamp01(rgb.a)})`;
        picker.value = formatHex(rgb);
      };
      picker.addEventListener('input', () => {
        input.value = picker.value;
        sync();
        renderContrast();
      });
      input.addEventListener('input', sync);
      input.addEventListener('blur', sync);
      root.append(fill, picker);
      return { root, sync };
    }

    function renderFormats(rgb) {
      const hsl = rgbToHsl(rgb);
      const hsv = rgbToHsv(rgb);
      const oklch = rgbToOklch(rgb);
      const oklab = rgbToOklab(rgb);
      formatRows.hex.set(formatHex(rgb));
      formatRows.hexa.set(formatHexa(rgb));
      formatRows.rgb.set(formatRgb(rgb));
      formatRows.rgba.set(formatRgba(rgb));
      formatRows.hsl.set(formatHsl(hsl));
      formatRows.hsla.set(formatHsla(hsl, rgb.a));
      formatRows.hsv.set(formatHsv(hsv));
      formatRows.hsva.set(formatHsva(hsv, rgb.a));
      formatRows.oklch.set(formatOklch(oklch));
      formatRows.oklab.set(formatOklab(oklab));
    }

    function renderPreview(rgb) {
      swatchFill.style.backgroundColor = `rgba(${Math.round(clamp(rgb.r, 0, 255))}, ${Math.round(
        clamp(rgb.g, 0, 255)
      )}, ${Math.round(clamp(rgb.b, 0, 255))}, ${clamp01(rgb.a)})`;
      swatchPicker.value = formatHex(rgb);
    }

    function makeBadge(labelText, passed) {
      const badge = el('span', { class: 'chip' }, `${labelText} · ${passed ? i18n.t('color.pass') : i18n.t('color.fail')}`);
      badge.style.color = passed ? 'var(--color-success)' : 'var(--color-danger)';
      badge.style.borderColor = passed
        ? 'color-mix(in srgb, var(--color-success) 45%, var(--color-border))'
        : 'color-mix(in srgb, var(--color-danger) 45%, var(--color-border))';
      return badge;
    }

    function renderContrast() {
      const fg = parseColor(fgInput.value);
      const bg = parseColor(bgInput.value);
      fgSwatch.sync();
      bgSwatch.sync();
      setFieldError(fgInput, fgHint, !fgInput.value.trim() ? false : !fg);
      setFieldError(bgInput, bgHint, !bgInput.value.trim() ? false : !bg);
      badgeBox.innerHTML = '';
      if (!fg || !bg) {
        ratioValue.textContent = '—';
        recommendText.textContent = '—';
        recommendSwatch.style.backgroundColor = 'transparent';
        return;
      }
      const result = computeContrast(fg, bg);
      ratioValue.textContent = `${roundTo(result.ratio, 2)}:1`;
      badgeBox.append(
        makeBadge(i18n.t('color.wcagAaNormal'), result.ratio >= 4.5),
        makeBadge(i18n.t('color.wcagAaaNormal'), result.ratio >= 7),
        makeBadge(i18n.t('color.wcagAaLarge'), result.ratio >= 3),
        makeBadge(i18n.t('color.wcagAaaLarge'), result.ratio >= 4.5)
      );
      const recommended = recommendForeground(bg);
      recommendSwatch.style.backgroundColor = recommended.color;
      recommendText.textContent = i18n.t('color.recommendValue', {
        color: recommended.color,
        ratio: roundTo(recommended.ratio, 2),
      });
    }

    function updateColor() {
      const text = colorInput.value.trim();
      if (!text) {
        setFieldError(colorInput, colorHint, false);
        clearFormats();
        clearPreview();
        return;
      }
      const rgb = parseColor(text);
      if (!rgb) {
        setFieldError(colorInput, colorHint, true);
        clearFormats();
        clearPreview();
        return;
      }
      setFieldError(colorInput, colorHint, false);
      renderPreview(rgb);
      renderFormats(rgb);
    }

    /* ---------- 事件绑定 ---------- */

    colorInput.addEventListener('input', updateColor);
    colorInput.addEventListener('blur', updateColor);
    // 点击色块取色：选择结果实时写入输入框并刷新预览 / 换算。
    swatchPicker.addEventListener('input', () => {
      colorInput.value = swatchPicker.value;
      updateColor();
    });
    fgInput.addEventListener('input', renderContrast);
    bgInput.addEventListener('input', renderContrast);

    randomBtn.addEventListener('click', () => {
      colorInput.value = randomColorHex();
      updateColor();
    });

    copyHexBtn.addEventListener('click', async () => {
      const rgb = parseColor(colorInput.value);
      const label = copyHexBtn.lastChild;
      if (!rgb) {
        label.textContent = i18n.t('color.invalid');
        setTimeout(() => {
          label.textContent = i18n.t('color.copyHex');
        }, 1200);
        return;
      }
      const ok = await copyText(formatHex(rgb));
      label.textContent = ok ? i18n.t('color.copied') : i18n.t('color.copyFailed');
      setTimeout(() => {
        label.textContent = i18n.t('color.copyHex');
      }, 1200);
    });

    swapBtn.addEventListener('click', () => {
      const fgValue = fgInput.value;
      fgInput.value = bgInput.value;
      bgInput.value = fgValue;
      renderContrast();
    });

    /* ---------- 初始状态 ---------- */

    fgInput.value = '#000000';
    bgInput.value = '#ffffff';
    colorInput.value = '#3498db';
    updateColor();
    renderContrast();

    container.append(inputSection, formatsSection, contrastSection);
  }

  window.ShipsToolRegistry.register({ id: 'color', icon: 'color', mount });
})();
