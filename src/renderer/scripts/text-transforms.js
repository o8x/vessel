'use strict';

/* 文本处理的纯函数（大小写转换 / 行处理 / 统计）。
   与具体界面无关，供「文本处理」工具（编码转换页）调用，也便于离线断言。 */

window.ShipsTextTransforms = (function createTextTransforms() {
  /* 拆词：先拆驼峰（lowerUpper / UPPERLower），再按非字母数字切分；
     中文等没有大小写的文字整段保留为一个词。 */
  function splitWords(text) {
    return String(text == null ? '' : text)
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  }

  function capitalize(word) {
    const chars = Array.from(String(word || ''));
    if (!chars.length) return '';
    return chars[0].toUpperCase() + chars.slice(1).join('').toLowerCase();
  }

  function mapLines(text, fn) {
    return String(text == null ? '' : text)
      .split('\n')
      .map((line) => fn(line))
      .join('\n');
  }

  const CASE_TRANSFORMS = {
    upper: (text) => String(text).toUpperCase(),
    lower: (text) => String(text).toLowerCase(),
    camel: (text) =>
      mapLines(text, (line) => {
        const words = splitWords(line);
        if (!words.length) return '';
        return words
          .map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word)))
          .join('');
      }),
    pascal: (text) => mapLines(text, (line) => splitWords(line).map(capitalize).join('')),
    snake: (text) => mapLines(text, (line) => splitWords(line).map((w) => w.toLowerCase()).join('_')),
    kebab: (text) => mapLines(text, (line) => splitWords(line).map((w) => w.toLowerCase()).join('-')),
    constant: (text) => mapLines(text, (line) => splitWords(line).map((w) => w.toUpperCase()).join('_')),
    title: (text) =>
      mapLines(text, (line) =>
        splitWords(line)
          .map((word) => (/^[\p{Ll}\p{N}]/u.test(word) ? capitalize(word) : word))
          .join(' ')
      ),
  };

  const LINE_TRANSFORMS = {
    dedupe: (text) => {
      const seen = new Set();
      const out = [];
      for (const line of String(text).split('\n')) {
        if (seen.has(line)) continue;
        seen.add(line);
        out.push(line);
      }
      return out.join('\n');
    },
    sortAsc: (text) =>
      String(text)
        .split('\n')
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .join('\n'),
    sortDesc: (text) =>
      String(text)
        .split('\n')
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
        .join('\n'),
    reverse: (text) => String(text).split('\n').reverse().join('\n'),
    dropBlank: (text) =>
      String(text)
        .split('\n')
        .filter((line) => line.trim() !== '')
        .join('\n'),
    trim: (text) => String(text).split('\n').map((line) => line.trim()).join('\n'),
    trimAll: (text) =>
      String(text)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join('\n'),
  };

  /* 统计：行数 / 字符数（按码点）/ 单词数 / UTF-8 字节数 / 去重行数。 */
  function stats(text) {
    const value = String(text == null ? '' : text);
    let bytes = 0;
    try {
      bytes = new TextEncoder().encode(value).length;
    } catch (err) {
      bytes = value.length;
    }
    return {
      lines: value === '' ? 0 : value.split('\n').length,
      chars: Array.from(value).length,
      words: value.trim() ? value.trim().split(/\s+/).length : 0,
      bytes,
      unique: value === '' ? 0 : new Set(value.split('\n')).size,
    };
  }

  return { splitWords, capitalize, mapLines, CASE_TRANSFORMS, LINE_TRANSFORMS, stats };
})();
