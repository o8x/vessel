'use strict';

/* 编码转换（CLI 用）：与渲染层「文本处理」工具的字段保持一致
   （字符串 / Base64 / 十六进制 / URL 编码 / URL 解码 / ASCII 十进制）。 */

/* URL 编码：保留 URL 结构字符（encodeURI 的保留集）与 `%`，只编码空格 / 中文等。 */
function encodeUrl(text) {
  return encodeURI(String(text == null ? '' : text)).replace(/%25/g, '%');
}

/* URL 反转义（容错）：非法转义不报错，先把孤立的 % 转义成 %25 再尽量还原。 */
function decodeUrl(text) {
  const value = String(text == null ? '' : text);
  try {
    return decodeURIComponent(value);
  } catch (err) {
    try {
      return decodeURIComponent(value.replace(/%(?![0-9a-fA-F]{2})/g, '%25'));
    } catch (err2) {
      return value;
    }
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

function bytesToAscii(bytes) {
  return Array.from(bytes).join(' ');
}

function encodeAll(text) {
  const value = String(text == null ? '' : text);
  const bytes = Buffer.from(value, 'utf8');
  return {
    text: value,
    base64: bytes.toString('base64'),
    hex: bytesToHex(bytes),
    url: encodeUrl(value),
    urlDecode: decodeUrl(value),
    ascii: bytesToAscii(bytes),
  };
}

module.exports = { encodeAll, encodeUrl, decodeUrl, bytesToHex, bytesToAscii };
