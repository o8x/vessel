'use strict';

/* 正则表达式测试工具：模式匹配、捕获组、替换预览、常用片段与模式解释。
   全部在渲染层完成（纯前端、无 IPC、无第三方依赖）。 */

(function registerRegexTool() {
  const { el, section, inputField, copyText, debounce, Icons } = window.ShipsUI;
  const i18n = window.ShipsI18n;

  i18n.extend({
    zh: {
      tools: { regex: '正则测试' },
      toolDesc: { regex: '实时匹配、捕获组、替换预览、常用片段与模式解释' },
      regex: {
        title: '正则测试',
        hint: '输入表达式与测试文本，实时查看匹配、捕获组与替换结果。',
        sectionPattern: '正则表达式',
        sectionFlags: '标志',
        sectionTest: '测试文本',
        sectionMatches: '匹配结果',
        sectionReplace: '替换',
        sectionSnippets: '常用片段',
        sectionExplain: '模式解释',
        patternPlaceholder: '例如 \\d{3}-\\d{4}',
        flagsPlaceholder: 'gim',
        flagsHint: 'g 全局 · i 忽略大小写 · m 多行 · s 跨行 · u Unicode · y 粘性',
        flagsInvalid: '标志无效：仅支持 g i m s u y，且不能重复',
        patternInvalid: '正则无效：{message}',
        testPlaceholder: '粘贴待测试的文本…',
        matchCount: '共 {count} 处匹配',
        matchTruncated: '仅显示前 {limit} 条（共 {count} 处）',
        noMatch: '没有匹配',
        matchIndex: '第 {index} 处',
        matchPosition: '行 {line} 列 {column}',
        groupLabel: '捕获组',
        replacePlaceholder: '替换为…（支持 $1 $2 $<name>）',
        replaceHint: '$1 引用第 1 组捕获，$<name> 引用命名组，$& 引用整个匹配，$$ 表示字面量 $',
        previewEmpty: '（无内容）',
        copy: '复制',
        copied: '已复制',
        clear: '清空',
        snippetEmail: '邮箱',
        snippetUrl: 'URL',
        snippetIpv4: 'IPv4',
        snippetHex: '十六进制',
        snippetNumber: '数字',
        snippetChinese: '中文',
        snippetDateTime: '日期时间',
        snippetWhitespace: '空白字符',
        snippetWord: '单词边界',
        explainEmpty: '没有可解释的构造',
        explainHint: '启发式扫描识别常见构造，非完整语法解析',
        flagG: '全局：匹配所有出现位置',
        flagI: '忽略大小写',
        flagM: '多行：^ 与 $ 匹配每行首尾',
        flagS: '跨行：. 也匹配换行符',
        flagU: 'Unicode：按码点处理',
        flagY: '粘性：从上次结束位置继续匹配',
        explain: {
          digit: '数字：等价于 [0-9]',
          digitUpper: '非数字：等价于 [^0-9]',
          word: '单词字符：字母、数字或下划线',
          wordUpper: '非单词字符',
          space: '空白字符：空格、制表符、换行等',
          spaceUpper: '非空白字符',
          wordBoundary: '单词边界：位于单词字符与非单词字符之间',
          notWordBoundary: '非单词边界',
          control: '控制字符转义：\\n \\r \\t 等',
          backref: '反向引用：引用前面已捕获的内容',
          escape: '转义：把特殊字符按字面量匹配',
          charSet: '字符组：匹配方括号中的任意一个字符',
          namedGroup: '命名捕获组：可用 $<name> 引用',
          nonCapture: '非捕获组：只分组，不产生捕获',
          lookahead: '先行断言：要求后面出现，但不消耗字符',
          negativeLookahead: '否定先行断言：要求后面不出现',
          lookbehind: '后行断言：要求前面出现，但不消耗字符',
          negativeLookbehind: '否定后行断言：要求前面不出现',
          group: '捕获组：括号内内容可被 $1 引用',
          anchorStart: '锚点 ^：行首或字符串开头',
          anchorEnd: '锚点 $：行尾或字符串结尾',
          alternation: '交替：| 分隔多个可选分支',
          any: '任意字符：除换行符外的任意字符',
          greedy: '贪婪量词：尽可能多地匹配',
          lazy: '懒惰量词：尽可能少地匹配',
          quantifier: '量词：{n,m} 指定重复次数范围',
        },
      },
    },
    en: {
      tools: { regex: 'Regex tester' },
      toolDesc: { regex: 'Live matches, capture groups, replace preview, snippets and explanation' },
      regex: {
        title: 'Regex tester',
        hint: 'Enter a pattern and test text to see matches, groups and replacement live.',
        sectionPattern: 'Pattern',
        sectionFlags: 'Flags',
        sectionTest: 'Test text',
        sectionMatches: 'Matches',
        sectionReplace: 'Replace',
        sectionSnippets: 'Snippets',
        sectionExplain: 'Explanation',
        patternPlaceholder: 'e.g. \\d{3}-\\d{4}',
        flagsPlaceholder: 'gim',
        flagsHint: 'g global · i ignore case · m multiline · s dotAll · u unicode · y sticky',
        flagsInvalid: 'Invalid flags: only g i m s u y are allowed, without duplicates',
        patternInvalid: 'Invalid pattern: {message}',
        testPlaceholder: 'Paste the text to test…',
        matchCount: '{count} match(es)',
        matchTruncated: 'showing first {limit} of {count}',
        noMatch: 'No match',
        matchIndex: 'Match {index}',
        matchPosition: 'line {line}, col {column}',
        groupLabel: 'Groups',
        replacePlaceholder: 'Replace with… ($1 $2 $<name> supported)',
        replaceHint: '$1 refers to group 1, $<name> to a named group, $& to the whole match, $$ to a literal $',
        previewEmpty: '(empty)',
        copy: 'Copy',
        copied: 'Copied',
        clear: 'Clear',
        snippetEmail: 'Email',
        snippetUrl: 'URL',
        snippetIpv4: 'IPv4',
        snippetHex: 'Hex',
        snippetNumber: 'Number',
        snippetChinese: 'Chinese',
        snippetDateTime: 'Date & time',
        snippetWhitespace: 'Whitespace',
        snippetWord: 'Word boundary',
        explainEmpty: 'Nothing to explain',
        explainHint: 'Heuristic scan of common constructs, not a full parser',
        flagG: 'Global: match every occurrence',
        flagI: 'Ignore case',
        flagM: 'Multiline: ^ and $ match each line',
        flagS: 'DotAll: . also matches newlines',
        flagU: 'Unicode: handle code points',
        flagY: 'Sticky: continue from the last end position',
        explain: {
          digit: 'Digit: equivalent to [0-9]',
          digitUpper: 'Non-digit: equivalent to [^0-9]',
          word: 'Word character: letter, digit or underscore',
          wordUpper: 'Non-word character',
          space: 'Whitespace: space, tab, newline, etc.',
          spaceUpper: 'Non-whitespace character',
          wordBoundary: 'Word boundary: between word and non-word characters',
          notWordBoundary: 'Not a word boundary',
          control: 'Control escape: \\n \\r \\t and friends',
          backref: 'Backreference: reuses an earlier capture',
          escape: 'Escape: matches a special character literally',
          charSet: 'Character class: matches any one character in the brackets',
          namedGroup: 'Named capture group: referenced via $<name>',
          nonCapture: 'Non-capturing group: groups without capturing',
          lookahead: 'Lookahead: must follow, but consumes nothing',
          negativeLookahead: 'Negative lookahead: must not follow',
          lookbehind: 'Lookbehind: must precede, but consumes nothing',
          negativeLookbehind: 'Negative lookbehind: must not precede',
          group: 'Capture group: referenced via $1',
          anchorStart: 'Anchor ^: start of line or string',
          anchorEnd: 'Anchor $: end of line or string',
          alternation: 'Alternation: | separates optional branches',
          any: 'Any character: anything but a newline',
          greedy: 'Greedy quantifier: matches as much as possible',
          lazy: 'Lazy quantifier: matches as little as possible',
          quantifier: 'Quantifier: {n,m} sets a repetition range',
        },
      },
    },
  });

  /* ===================== 纯逻辑区开始（供离线断言） ===================== */

  /* 可用的标志位（顺序即按钮顺序）。 */
  const FLAG_KEYS = ['g', 'i', 'm', 's', 'u', 'y'];

  /* 常用片段：点击后填入表达式输入框。 */
  const SNIPPETS = [
    { key: 'snippetEmail', pattern: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+' },
    { key: 'snippetUrl', pattern: 'https?:\\/\\/[^\\s]+' },
    { key: 'snippetIpv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b' },
    { key: 'snippetHex', pattern: '\\b0x[0-9a-fA-F]+\\b' },
    { key: 'snippetNumber', pattern: '-?\\d+(?:\\.\\d+)?' },
    { key: 'snippetChinese', pattern: '[\\u4e00-\\u9fa5]+' },
    { key: 'snippetDateTime', pattern: '\\d{4}-\\d{2}-\\d{2}(?:[ T]\\d{2}:\\d{2}(?::\\d{2})?)?' },
    { key: 'snippetWhitespace', pattern: '\\s+' },
    { key: 'snippetWord', pattern: '\\b\\w+\\b' },
  ];

  /* 规范化标志串：去掉空白与非法字符，重复出现视为非法。 */
  function sanitizeFlags(raw) {
    const text = String(raw == null ? '' : raw);
    const used = [];
    let invalid = false;
    for (const ch of text) {
      if (/\s/.test(ch)) continue;
      if (FLAG_KEYS.indexOf(ch) === -1 || used.indexOf(ch) !== -1) {
        invalid = true;
        continue;
      }
      used.push(ch);
    }
    return { flags: used.join(''), invalid };
  }

  /* 编译表达式：非法表达式只返回错误信息，绝不抛出异常。 */
  function compilePattern(pattern, flags) {
    try {
      return { regex: new RegExp(String(pattern == null ? '' : pattern), String(flags || '')), error: null };
    } catch (err) {
      return { regex: null, error: (err && err.message) ? String(err.message) : 'unknown error' };
    }
  }

  /* 预计算每行的起始下标，用于把匹配位置换算成行列。 */
  function buildLineIndex(text) {
    const src = String(text == null ? '' : text);
    const starts = [0];
    for (let i = 0; i < src.length; i += 1) {
      if (src[i] === '\n') starts.push(i + 1);
    }
    return starts;
  }

  /* 二分查找下标所在行 / 列（均从 1 开始）。 */
  function locatePosition(lineStarts, index) {
    const starts = lineStarts && lineStarts.length ? lineStarts : [0];
    const at = Math.max(0, index | 0);
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= at) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: at - starts[low] + 1 };
  }

  /* 提取捕获组：编号组显示为 $1、$2…，命名组显示为组名。 */
  function extractGroups(match) {
    const groups = [];
    if (!match) return groups;
    for (let i = 1; i < match.length; i += 1) {
      groups.push({ label: '$' + i, value: match[i] === undefined ? '' : String(match[i]) });
    }
    const named = match.groups || {};
    for (const name of Object.keys(named)) {
      groups.push({ label: name, value: named[name] === undefined ? '' : String(named[name]) });
    }
    return groups;
  }

  /* 截断过长文本（按码点截断，避免拆散代理对）。 */
  function truncateText(text, max) {
    const src = String(text == null ? '' : text);
    const limit = Number.isFinite(max) && max > 0 ? max : 120;
    const chars = Array.from(src);
    if (chars.length <= limit) return src;
    return chars.slice(0, limit).join('') + '…';
  }

  /* 取捕获组文本（未参与匹配的组视为空串）。 */
  function groupValue(match, index) {
    const value = match[index];
    return value === undefined ? '' : String(value);
  }

  /* 展开替换模板，语义与原生 String.replace 一致：
     $$ $& $` $' $<name> $1…$99（$0 与越界编号按字面量处理）。 */
  function expandReplacement(template, match, source) {
    const text = String(template == null ? '' : template);
    const origin = String(source == null ? '' : source);
    const groupCount = match.length - 1;
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch !== '$') {
        out += ch;
        continue;
      }
      const next = text[i + 1];
      if (next === undefined) {
        out += '$';
        continue;
      }
      if (next === '$') {
        out += '$';
        i += 1;
        continue;
      }
      if (next === '&') {
        out += match[0];
        i += 1;
        continue;
      }
      if (next === '`') {
        out += origin.slice(0, match.index);
        i += 1;
        continue;
      }
      if (next === "'") {
        out += origin.slice(match.index + match[0].length);
        i += 1;
        continue;
      }
      if (next === '<') {
        const close = text.indexOf('>', i + 2);
        if (close > 0) {
          const name = text.slice(i + 2, close);
          const groups = match.groups || {};
          if (Object.prototype.hasOwnProperty.call(groups, name)) {
            const value = groups[name];
            out += value === undefined ? '' : String(value);
          } else {
            /* 没有该命名组：原样保留 $<name>。 */
            out += text.slice(i, close + 1);
          }
          i = close;
          continue;
        }
        out += '$';
        continue;
      }
      if (next >= '0' && next <= '9') {
        const second = text[i + 2];
        if (second >= '0' && second <= '9') {
          const number = parseInt(next + second, 10);
          if (number !== 0 && number <= groupCount) {
            out += groupValue(match, number);
            i += 2;
            continue;
          }
          /* 两位数越界（含 $00）：退回按单个数字处理。 */
        }
        const number = parseInt(next, 10);
        if (number !== 0 && number <= groupCount) {
          out += groupValue(match, number);
          i += 1;
          continue;
        }
        out += '$' + next;
        continue;
      }
      out += '$';
    }
    return out;
  }

  /* 替换预览：是否全局替换取决于表达式自身的 g 标志。 */
  function replacePreview(text, regex, template) {
    const src = String(text == null ? '' : text);
    if (!regex) return '';
    return src.replace(regex, function replacer() {
      const args = Array.prototype.slice.call(arguments);
      let groups = null;
      const last = args[args.length - 1];
      if (last && typeof last === 'object') groups = args.pop();
      const whole = args.pop();
      const offset = args.pop();
      const match = args.slice();
      match.index = offset;
      match.input = whole;
      if (groups) match.groups = groups;
      return expandReplacement(String(template == null ? '' : template), match, src);
    });
  }

  /* 收集匹配：始终全局扫描（列表展示全部匹配），零长度匹配必须推进游标。 */
  function collectMatches(regex, text, options) {
    const opts = options || {};
    const limit = Number.isFinite(opts.limit) ? opts.limit : 200;
    const maxScan = Number.isFinite(opts.maxScan) ? opts.maxScan : 10000;
    const src = String(text == null ? '' : text);
    const result = { total: 0, items: [], truncated: false };
    if (!regex) return result;
    /* 扫描时强制开启 g 并去掉 y（粘性只影响替换预览），否则无法列出全部匹配。 */
    let flags = String(regex.flags || '');
    if (flags.indexOf('g') === -1) flags += 'g';
    flags = flags.replace(/y/g, '');
    let scanner;
    try {
      scanner = new RegExp(regex.source, flags);
    } catch (err) {
      return result;
    }
    const lineStarts = buildLineIndex(src);
    let match;
    let scanned = 0;
    while ((match = scanner.exec(src)) !== null) {
      scanned += 1;
      result.total += 1;
      if (result.items.length < limit) {
        const pos = locatePosition(lineStarts, match.index);
        result.items.push({
          index: match.index,
          text: match[0],
          line: pos.line,
          column: pos.column,
          groups: extractGroups(match),
        });
      }
      /* 零长度匹配：手动推进游标，避免死循环。 */
      if (match[0] === '') scanner.lastIndex += 1;
      if (scanned >= maxScan) {
        result.truncated = true;
        break;
      }
    }
    if (result.total > result.items.length) result.truncated = true;
    return result;
  }

  /* 模式解释：启发式扫描常见构造，非完整语法解析。 */
  function explainPattern(pattern) {
    const src = String(pattern == null ? '' : pattern);
    const found = [];
    const add = (id, token) => found.push({ id, token });
    let inClass = false;
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '\\') {
        const next = src[i + 1];
        i += 1;
        if (next === undefined) continue;
        if (next === 'd') add('digit', '\\d');
        else if (next === 'D') add('digitUpper', '\\D');
        else if (next === 'w') add('word', '\\w');
        else if (next === 'W') add('wordUpper', '\\W');
        else if (next === 's') add('space', '\\s');
        else if (next === 'S') add('spaceUpper', '\\S');
        else if (next === 'b') add('wordBoundary', '\\b');
        else if (next === 'B') add('notWordBoundary', '\\B');
        else if (next === 'n' || next === 'r' || next === 't' || next === 'f' || next === 'v' || next === '0') add('control', '\\' + next);
        else if (next >= '1' && next <= '9') add('backref', '\\' + next);
        else add('escape', '\\' + next);
        continue;
      }
      if (inClass) {
        if (ch === ']') inClass = false;
        continue;
      }
      if (ch === '[') {
        inClass = true;
        add('charSet', '[]');
        continue;
      }
      if (ch === '(') {
        const rest = src.slice(i);
        const named = /^\(\?<([^>]+)>/.exec(rest);
        if (named) {
          add('namedGroup', named[0]);
          i += named[0].length - 1;
          continue;
        }
        if (rest.indexOf('(?:') === 0) {
          add('nonCapture', '(?:');
          i += 2;
          continue;
        }
        if (rest.indexOf('(?=') === 0) {
          add('lookahead', '(?=');
          i += 2;
          continue;
        }
        if (rest.indexOf('(?!') === 0) {
          add('negativeLookahead', '(?!');
          i += 2;
          continue;
        }
        if (rest.indexOf('(?<=') === 0) {
          add('lookbehind', '(?<=');
          i += 3;
          continue;
        }
        if (rest.indexOf('(?<!') === 0) {
          add('negativeLookbehind', '(?<!');
          i += 3;
          continue;
        }
        add('group', '(');
        continue;
      }
      if (ch === '^') {
        add('anchorStart', '^');
        continue;
      }
      if (ch === '$') {
        add('anchorEnd', '$');
        continue;
      }
      if (ch === '|') {
        add('alternation', '|');
        continue;
      }
      if (ch === '.') {
        add('any', '.');
        continue;
      }
      if (ch === '*' || ch === '+' || ch === '?') {
        if (src[i + 1] === '?') {
          add('lazy', ch + '?');
          i += 1;
        } else {
          add('greedy', ch);
        }
        continue;
      }
      if (ch === '{') {
        const range = /^\{\d+(?:,\d*)?\}/.exec(src.slice(i));
        if (range) {
          if (src[i + range[0].length] === '?') {
            add('lazy', range[0] + '?');
            i += range[0].length;
          } else {
            add('quantifier', range[0]);
          }
          i += range[0].length - 1;
          continue;
        }
      }
    }
    return found;
  }

  /* ===================== 纯逻辑区结束 ===================== */

  /* 列表最多展示的匹配条数。 */
  const MAX_MATCH_ITEMS = 200;

  function mount(container) {
    /* ---------- 表达式 + 标志 ---------- */

    const patternInput = el('input', {
      class: 'field font-mono text-[13px]',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: i18n.t('regex.patternPlaceholder'),
    });
    const flagsInput = el('input', {
      class: 'field font-mono text-[13px]',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: i18n.t('regex.flagsPlaceholder'),
    });
    /* 错误提示紧贴各自输入框下方（红色小字），与进制转换工具的写法一致。 */
    const patternError = el('div', { class: 'mt-1 text-[10px] text-fg-muted' }, '');
    const flagsError = el('div', { class: 'mt-1 text-[10px] text-fg-muted' }, '');
    const flagsHelp = el('div', { class: 'text-[10px] text-fg-muted' }, i18n.t('regex.flagsHint'));

    const clearBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' });
    clearBtn.append(el('span', { class: 'inline-flex' }, Icons.trash(13)));
    clearBtn.append(el('span', {}, i18n.t('regex.clear')));

    const patternRow = el('div', { class: 'flex flex-wrap items-end gap-2' });
    const patternField = inputField(i18n.t('regex.sectionPattern'), patternInput);
    const flagsField = inputField(i18n.t('regex.sectionFlags'), flagsInput);
    patternField.classList.add('min-w-[220px]', 'flex-1');
    flagsField.classList.add('w-[92px]', 'shrink-0');
    patternField.appendChild(patternError);
    flagsField.appendChild(flagsError);
    patternRow.append(patternField, flagsField, clearBtn);

    const patternSection = section(i18n.t('regex.sectionPattern'));
    patternSection.append(
      el('div', { class: 'text-[11px] text-fg-muted' }, i18n.t('regex.hint')),
      patternRow
    );

    /* ---------- 标志开关 ---------- */

    const flagButtons = {};
    const flagRow = el('div', { class: 'flex flex-wrap gap-1.5' });
    for (const key of FLAG_KEYS) {
      const button = el('button', {
        class: 'btn shrink-0 px-2 py-1 text-[11px]',
        type: 'button',
        'data-tip': i18n.t('regex.flag' + key.toUpperCase()),
      }, key);
      button.addEventListener('click', () => toggleFlag(key));
      flagButtons[key] = button;
      flagRow.appendChild(button);
    }
    const flagsSection = section(i18n.t('regex.sectionFlags'));
    flagsSection.append(flagRow, flagsHelp);

    /* ---------- 测试文本 ---------- */

    const testInput = el('textarea', {
      class: 'field h-[180px] w-full resize-none font-mono text-[12px]',
      spellcheck: 'false',
      placeholder: i18n.t('regex.testPlaceholder'),
    });
    const testSection = section(i18n.t('regex.sectionTest'));
    testSection.appendChild(testInput);

    /* ---------- 匹配结果 ---------- */

    const countLabel = el('div', { class: 'text-[11px] text-fg-muted' }, '');
    const matchList = el('div', { class: 'flex max-h-[240px] flex-col gap-1.5 overflow-y-auto pr-1' });
    const matchesSection = section(i18n.t('regex.sectionMatches'));
    matchesSection.append(countLabel, matchList);

    /* ---------- 替换 ---------- */

    const replaceInput = el('input', {
      class: 'field font-mono text-[13px]',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: i18n.t('regex.replacePlaceholder'),
    });
    const previewBox = el('div', {
      class: 'field max-h-[160px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[12px]',
    }, '');
    const copyBtn = el('button', { class: 'btn shrink-0 px-2 py-1 text-[11px]', type: 'button' });
    copyBtn.append(el('span', { class: 'inline-flex' }, Icons.copy(13)));
    copyBtn.append(el('span', {}, i18n.t('regex.copy')));

    const replaceRow = el('div', { class: 'flex flex-wrap items-end gap-2' });
    const replaceField = inputField(i18n.t('regex.sectionReplace'), replaceInput);
    replaceField.classList.add('min-w-[220px]', 'flex-1');
    replaceRow.append(replaceField, copyBtn);
    const replaceSection = section(i18n.t('regex.sectionReplace'));
    replaceSection.append(
      replaceRow,
      el('div', { class: 'text-[10px] text-fg-muted' }, i18n.t('regex.replaceHint')),
      previewBox
    );

    /* ---------- 常用片段 ---------- */

    const snippetRow = el('div', { class: 'flex flex-wrap gap-1.5' });
    for (const snippet of SNIPPETS) {
      const button = el('button', {
        class: 'btn shrink-0 px-2 py-1 text-[11px]',
        type: 'button',
        'data-tip': snippet.pattern,
      }, i18n.t('regex.' + snippet.key));
      button.addEventListener('click', () => {
        patternInput.value = snippet.pattern;
        patternInput.focus();
        update();
      });
      snippetRow.appendChild(button);
    }
    const snippetSection = section(i18n.t('regex.sectionSnippets'));
    snippetSection.appendChild(snippetRow);

    /* ---------- 模式解释 ---------- */

    const explainList = el('div', { class: 'flex flex-col gap-1' });
    const explainSection = section(i18n.t('regex.sectionExplain'));
    explainSection.append(
      el('div', { class: 'text-[10px] text-fg-muted' }, i18n.t('regex.explainHint')),
      explainList
    );

    /* ---------- 交互与渲染 ---------- */

    function syncFlagButtons() {
      const parsed = sanitizeFlags(flagsInput.value);
      for (const key of FLAG_KEYS) {
        flagButtons[key].classList.toggle('btn-accent', parsed.flags.indexOf(key) !== -1);
      }
    }

    function toggleFlag(key) {
      const parsed = sanitizeFlags(flagsInput.value);
      const set = parsed.flags.split('');
      const at = set.indexOf(key);
      if (at === -1) set.push(key);
      else set.splice(at, 1);
      flagsInput.value = FLAG_KEYS.filter((item) => set.indexOf(item) !== -1).join('');
      syncFlagButtons();
      update();
    }

    function setError(input, hint, message) {
      input.style.borderColor = message ? 'var(--color-danger)' : '';
      hint.textContent = message || '';
      hint.style.color = message ? 'var(--color-danger)' : '';
    }

    function renderMatches(result) {
      matchList.innerHTML = '';
      if (!result.items.length) {
        matchList.appendChild(el('div', { class: 'text-[12px] text-fg-muted' }, i18n.t('regex.noMatch')));
        return;
      }
      result.items.forEach((item, index) => {
        const row = el('div', { class: 'rounded-card border border-border bg-surface px-2.5 py-1.5' });
        const head = el('div', { class: 'flex items-center justify-between gap-2' });
        head.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wide text-fg-muted' },
          i18n.t('regex.matchIndex', { index: index + 1 }) + ' · ' + i18n.t('regex.matchPosition', { line: item.line, column: item.column })));
        const copyMatch = el('button', {
          class: 'icon-btn h-6 w-6 shrink-0',
          type: 'button',
          'data-tip': i18n.t('regex.copy'),
        });
        copyMatch.innerHTML = Icons.copy(14);
        copyMatch.addEventListener('click', async () => {
          const ok = await copyText(item.text);
          if (!ok) return;
          copyMatch.innerHTML = Icons.check(14);
          copyMatch.style.color = 'var(--color-success)';
          setTimeout(() => {
            copyMatch.innerHTML = Icons.copy(14);
            copyMatch.style.color = '';
          }, 1200);
        });
        head.appendChild(copyMatch);
        row.appendChild(head);
        row.appendChild(el('div', { class: 'result-value text-[12px]' }, truncateText(item.text, 120)));
        if (item.groups.length) {
          const groupRow = el('div', { class: 'mt-1 flex flex-wrap gap-1' });
          for (const group of item.groups) {
            groupRow.appendChild(el('span', { class: 'chip font-mono text-[10px]' },
              group.label + ' → ' + truncateText(group.value, 40)));
          }
          row.appendChild(groupRow);
        }
        matchList.appendChild(row);
      });
    }

    function renderExplain(pattern) {
      explainList.innerHTML = '';
      const found = explainPattern(pattern);
      if (!found.length) {
        explainList.appendChild(el('div', { class: 'text-[11px] text-fg-muted' }, i18n.t('regex.explainEmpty')));
        return;
      }
      const grouped = new Map();
      for (const item of found) {
        if (!grouped.has(item.id)) grouped.set(item.id, []);
        grouped.get(item.id).push(item.token);
      }
      for (const [id, tokens] of grouped) {
        const row = el('div', { class: 'flex items-start gap-2' });
        row.appendChild(el('span', { class: 'chip shrink-0 font-mono' }, tokens.join(' ')));
        row.appendChild(el('span', { class: 'text-[11px] leading-snug text-fg-muted' }, i18n.t('regex.explain.' + id)));
        explainList.appendChild(row);
      }
    }

    function update() {
      const parsed = sanitizeFlags(flagsInput.value);
      setError(flagsInput, flagsError, parsed.invalid ? i18n.t('regex.flagsInvalid') : '');

      const compiled = compilePattern(patternInput.value, parsed.flags);
      setError(patternInput, patternError, compiled.error ? i18n.t('regex.patternInvalid', { message: compiled.error }) : '');

      renderExplain(patternInput.value);

      if (compiled.error) {
        countLabel.textContent = '';
        matchList.innerHTML = '';
        previewBox.textContent = '';
        return;
      }

      const result = collectMatches(compiled.regex, testInput.value, { limit: MAX_MATCH_ITEMS });
      countLabel.textContent = i18n.t('regex.matchCount', { count: result.total })
        + (result.truncated ? ' · ' + i18n.t('regex.matchTruncated', { limit: result.items.length, count: result.total }) : '');
      renderMatches(result);

      previewBox.textContent = replacePreview(testInput.value, compiled.regex, replaceInput.value)
        || i18n.t('regex.previewEmpty');
    }

    const scheduleUpdate = debounce(update, 180);

    patternInput.addEventListener('input', scheduleUpdate);
    flagsInput.addEventListener('input', () => {
      syncFlagButtons();
      scheduleUpdate();
    });
    testInput.addEventListener('input', scheduleUpdate);
    replaceInput.addEventListener('input', scheduleUpdate);

    clearBtn.addEventListener('click', () => {
      patternInput.value = '';
      flagsInput.value = '';
      testInput.value = '';
      replaceInput.value = '';
      syncFlagButtons();
      update();
    });

    copyBtn.addEventListener('click', async () => {
      const value = previewBox.textContent;
      if (!value || value === i18n.t('regex.previewEmpty')) {
        copyBtn.lastChild.textContent = i18n.t('regex.previewEmpty');
        setTimeout(() => {
          copyBtn.lastChild.textContent = i18n.t('regex.copy');
        }, 1200);
        return;
      }
      const ok = await copyText(value);
      copyBtn.lastChild.textContent = ok ? i18n.t('regex.copied') : i18n.t('regex.previewEmpty');
      setTimeout(() => {
        copyBtn.lastChild.textContent = i18n.t('regex.copy');
      }, 1200);
    });

    container.append(
      patternSection,
      flagsSection,
      testSection,
      matchesSection,
      replaceSection,
      snippetSection,
      explainSection
    );

    syncFlagButtons();
    update();
  }

  window.ShipsToolRegistry.register({ id: 'regex', icon: 'regex', mount });
})();
