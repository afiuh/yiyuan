// [M1 声明] 语义标注器 — annotate(code, language) → Annotation[]
// 代码语义元动作体系 v1.9
//
// 职责：逐行扫描代码，通过正则+模式匹配识别 20 种元动作。
// 纯函数，不依赖 VS Code API。

/**
 * @typedef {Object} Annotation
 * @property {number} line        — 1-indexed 行号
 * @property {number} column      — 1-indexed 列号
 * @property {string} metaActionId — 元动作编号（M1~M5, M20, C6~C8, F9~F12, F19, I13~I16, R17~R18）
 * @property {string} metaActionName — 元动作中文名称
 * @property {string} code        — 匹配到的代码片段
 * @property {string} riskLevel   — high / medium / low
 * @property {string} flow        — Memory / Control / Function / IO / Resource
 */

// ═══════════════════════════════════════════════
// 20 种元动作检测规则（按优先级排列）
// ═══════════════════════════════════════════════

/**
 * [M5 转换] 剥离注释，避免在注释和字符串中误匹配
 */
function stripComments(code) {
  // 移除行注释
  let result = code.replace(/\/\/.*$/gm, ' ');
  // 移除块注释
  result = result.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return result;
}

/**
 * [M4 计算] 在剥离注释的代码中检测元动作
 * 
 * @param {string} code — 源代码
 * @param {string} language — 'javascript' | 'typescript' | 'javascriptreact' | 'typescriptreact'
 * @returns {Annotation[]}
 */
function annotate(code, language) {
  // [M5 转换] 剥离注释
  const cleanCode = stripComments(code);
  const lines = cleanCode.split('\n');
  const annotations = [];

  // [M20 初始化] 跨行状态追踪
  let inTryBlock = false;
  let tryBlockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-indexed
    const trimmed = line.trim();

    // 跳过空行和纯注释行
    if (!trimmed) continue;

    // ═══════════════════════════════
    // 多行结构检测（优先级最高）
    // ═══════════════════════════════

    // [F12 捕获] try 块开始
    if (/^try\s*\{/.test(trimmed) || trimmed === 'try' || /^try\s*$/.test(trimmed)) {
      addAnnotation(annotations, lineNum, 1, 'F12', '捕获', trimmed.slice(0, 40), 'medium', 'Function');
      inTryBlock = true;
      tryBlockStart = lineNum;
    }

    // [F12 捕获] catch 块
    if (/\bcatch\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, 1, 'F12', '捕获', trimmed.slice(0, 40), 'medium', 'Function');
    }

    // [F12 捕获] finally 块
    if (/\bfinally\s*\{/.test(trimmed)) {
      addAnnotation(annotations, lineNum, 1, 'F12', '捕获', 'finally', 'medium', 'Function');
    }

    // [F12 捕获] .catch(
    if (/\.catch\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.catch'), 'F12', '捕获', '.catch(...)', 'medium', 'Function');
    }

    // ═══════════════════════════════
    // 资源流 (Resource Flow) — 高优先级
    // ═══════════════════════════════

    // [R17 绑定] addEventListener / .on('xxx', / watch / observe / MutationObserver / IntersectionObserver
    if (/\baddEventListener\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('addEventListener'), 'R17', '绑定', 'addEventListener', 'high', 'Resource');
    }
    if (/\.on\s*\(\s*['"][\w:-]+['"]/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.on'), 'R17', '绑定', trimmed.match(/\.on\s*\(\s*['"][\w:-]+['"]/)[0], 'high', 'Resource');
    }
    if (/\bnew\s+(MutationObserver|IntersectionObserver|ResizeObserver)\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('new'), 'R17', '绑定', trimmed.match(/new\s+(MutationObserver|IntersectionObserver|ResizeObserver)/)[0], 'high', 'Resource');
    }

    // [R18 清理] removeEventListener / clearTimeout / clearInterval / dispose / .off(
    if (/\bremoveEventListener\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('removeEventListener'), 'R18', '清理', 'removeEventListener', 'medium', 'Resource');
    }
    if (/\bclearTimeout\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('clearTimeout'), 'R18', '清理', 'clearTimeout', 'medium', 'Resource');
    }
    if (/\bclearInterval\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('clearInterval'), 'R18', '清理', 'clearInterval', 'medium', 'Resource');
    }
    if (/\.dispose\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.dispose'), 'R18', '清理', '.dispose()', 'medium', 'Resource');
    }
    if (/\.off\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.off'), 'R18', '清理', '.off()', 'medium', 'Resource');
    }
    if (/\bAbortController\b/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('AbortController'), 'R18', '清理', 'AbortController', 'medium', 'Resource');
    }

    // ═══════════════════════════════
    // 交互流 (IO Flow) — 高风险
    // ═══════════════════════════════

    // [I16 通信] fetch / axios / XMLHttpRequest / WebSocket
    if (/\bfetch\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('fetch'), 'I16', '通信', 'fetch()', 'high', 'IO');
    }
    if (/\baxios\.(get|post|put|delete|patch|request)\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('axios'), 'I16', '通信', trimmed.match(/axios\.(get|post|put|delete|patch|request)/)[0], 'high', 'IO');
    }
    if (/\bnew\s+XMLHttpRequest\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('new'), 'I16', '通信', 'XMLHttpRequest', 'high', 'IO');
    }
    if (/\bnew\s+WebSocket\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('new'), 'I16', '通信', 'WebSocket', 'high', 'IO');
    }

    // [I15 存储] localStorage / sessionStorage / IndexedDB / fs.write
    if (/\blocalStorage\.(setItem|getItem|removeItem|clear)\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('localStorage'), 'I15', '存储', trimmed.match(/localStorage\.(setItem|getItem|removeItem|clear)/)[0], 'high', 'IO');
    }
    if (/\bsessionStorage\.(setItem|getItem|removeItem|clear)\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('sessionStorage'), 'I15', '存储', trimmed.match(/sessionStorage\.(setItem|getItem|removeItem|clear)/)[0], 'high', 'IO');
    }
    if (/\bIndexedDB\b/.test(trimmed) || /\bindexedDB\b/.test(trimmed)) {
      addAnnotation(annotations, lineNum, 1, 'I15', '存储', 'IndexedDB', 'high', 'IO');
    }
    if (/\bfs\.write(File|FileSync)?\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('fs'), 'I15', '存储', trimmed.match(/fs\.write(File|FileSync)?/)[0], 'high', 'IO');
    }

    // [I14 用户输入] DOM值读取 / URL参数 / 表单 / Express请求 / 命令行参数
    // 模式1：DOM元素值读取（getElementById/querySelector + .value）
    if (/\.value\b/.test(trimmed) &&
        (/\b(input|textarea|select|FormData)\b/i.test(trimmed) ||
         /\b(getElementById|querySelector|querySelectorAll|getElementsBy\w+)\s*\(/.test(trimmed) ||
         /\w+\.value\s*$/.test(trimmed) || /\w+\.value\s*[;)]/.test(trimmed))) {
      addAnnotation(annotations, lineNum, 1, 'I14', '用户输入', trimmed.slice(0, 50), 'high', 'IO');
    }
    // 模式2：URL 查询参数
    if (/\bnew\s+URLSearchParams\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('URLSearchParams'), 'I14', '用户输入', 'URLSearchParams', 'high', 'IO');
    }
    if (/\blocation\.search\b/.test(trimmed) || /\blocation\.hash\b/.test(trimmed)) {
      addAnnotation(annotations, lineNum, 1, 'I14', '用户输入', 'location.search/hash', 'high', 'IO');
    }
    // 模式3：表单数据
    if (/\bnew\s+FormData\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('FormData'), 'I14', '用户输入', 'FormData', 'high', 'IO');
    }
    // 模式4：浏览器 prompt
    if (/\bprompt\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('prompt'), 'I14', '用户输入', 'prompt()', 'high', 'IO');
    }
    // 模式5：Node.js 命令行参数
    if (/\bprocess\.argv\b/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('process'), 'I14', '用户输入', 'process.argv', 'high', 'IO');
    }
    // 模式6：Express/Node HTTP 请求体
    if (/\breq\.(body|query|params|param)\b/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('req.'), 'I14', '用户输入', trimmed.match(/req\.(body|query|params|param)/)[0], 'high', 'IO');
    }

    // [I13 渲染] innerHTML / outerHTML / document.write / console.log / textContent
    if (/\.innerHTML\s*=/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.innerHTML'), 'I13', '渲染', '.innerHTML =', 'high', 'IO');
    }
    if (/\.outerHTML\s*=/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.outerHTML'), 'I13', '渲染', '.outerHTML =', 'high', 'IO');
    }
    if (/\bdocument\.write\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('document'), 'I13', '渲染', 'document.write()', 'high', 'IO');
    }
    if (/\.insertAdjacentHTML\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.insertAdjacentHTML'), 'I13', '渲染', '.insertAdjacentHTML()', 'high', 'IO');
    }
    if (/\bconsole\.(log|warn|error|info|debug)\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('console'), 'I13', '渲染', trimmed.match(/console\.(log|warn|error|info|debug)/)[0], 'low', 'IO');
    }

    // ═══════════════════════════════
    // 函数流 (Function Flow)
    // ═══════════════════════════════

    // [F11 抛出] throw
    if (/\bthrow\s+(new\s+)?/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('throw'), 'F11', '抛出', trimmed.slice(0, 40), 'medium', 'Function');
    }

    // [F10 返回] return（排除注释中的 return）
    if (/\breturn\b/.test(trimmed) && !/^\s*\/\//.test(line)) {
      // 检查是否真的是 return 语句（非字符串中的）
      if (/\breturn\s*[;{]/.test(trimmed) || /\breturn\s+\S/.test(trimmed) || /^\s*return\s*$/.test(trimmed)) {
        addAnnotation(annotations, lineNum, trimmed.indexOf('return'), 'F10', '返回', trimmed.slice(0, 40), 'low', 'Function');
      }
    }

    // [F9 调用] 函数调用（排除关键字和已知元动作）
    const funcCallMatch = trimmed.match(/(\w[\w.]*)\s*\(/g);
    if (funcCallMatch) {
      for (const m of funcCallMatch) {
        const name = m.replace(/\s*\($/, '');
        // 排除 JS 关键字和已检测的特殊函数
        const excluded = /^(if|for|while|switch|catch|return|throw|new|typeof|instanceof|delete|void|import|export|class|function|const|let|var|async|await|yield|super|this|try|finally|else|do|in|of)$/;
        const alreadyDetected = /^(fetch|addEventListener|removeEventListener|clearTimeout|clearInterval|console\.log|console\.warn|console\.error|console\.info|console\.debug|JSON\.parse|JSON\.stringify|localStorage\.(setItem|getItem|removeItem|clear)|sessionStorage\.(setItem|getItem|removeItem|clear)|setTimeout|setInterval)$/;
        if (!excluded.test(name) && !alreadyDetected.test(name)) {
          addAnnotation(annotations, lineNum, m.index + 1, 'F9', '调用', name + '()', 'low', 'Function');
        }
      }
    }

    // [F19 副作用] 全局变量修改 / 参数属性修改
    // 检测 window.X = ... / global.X = ... / 入参对象属性赋值
    if (/\bwindow\.\w+\s*=/.test(trimmed)) {
      addAnnotation(annotations, lineNum, 1, 'F19', '副作用', 'window.X = ...', 'medium', 'Function');
    }
    if (/\bglobal\.\w+\s*=/.test(trimmed)) {
      addAnnotation(annotations, lineNum, 1, 'F19', '副作用', 'global.X = ...', 'medium', 'Function');
    }

    // ═══════════════════════════════
    // 控制流 (Control Flow)
    // ═══════════════════════════════

    // [C6 条件] if / else if / switch / case / 三元 ?:
    if (/\bif\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('if'), 'C6', '条件', 'if', 'medium', 'Control');
    }
    if (/^\s*else\s*if\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('else'), 'C6', '条件', 'else if', 'medium', 'Control');
    }
    if (/^\s*else\s*\{/.test(trimmed) || /^\s*else\s*$/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('else'), 'C6', '条件', 'else', 'medium', 'Control');
    }
    if (/\bswitch\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('switch'), 'C6', '条件', 'switch', 'medium', 'Control');
    }
    if (/\?\s*[^:]+:/.test(trimmed) && !/\?\./.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('?'), 'C6', '条件', '?: ternary', 'medium', 'Control');
    }

    // [C7 循环] for / while / do-while / .forEach / .map / .filter / .reduce
    if (/\bfor\s*\(/.test(trimmed) || /\bfor\s+await\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('for'), 'C7', '循环', 'for', 'medium', 'Control');
    }
    if (/\bwhile\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('while'), 'C7', '循环', 'while', 'medium', 'Control');
    }
    if (/\bdo\s*\{/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('do'), 'C7', '循环', 'do-while', 'medium', 'Control');
    }
    if (/\.forEach\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.forEach'), 'C7', '循环', '.forEach()', 'medium', 'Control');
    }
    if (/\.map\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.map'), 'C7', '循环', '.map()', 'medium', 'Control');
    }
    if (/\.filter\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.filter'), 'C7', '循环', '.filter()', 'medium', 'Control');
    }
    if (/\.reduce\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.reduce'), 'C7', '循环', '.reduce()', 'medium', 'Control');
    }

    // [C8 异步] await / .then( / setTimeout / setInterval / new Promise
    if (/\bawait\b/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('await'), 'C8', '异步', 'await', 'high', 'Control');
    }
    if (/\.then\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.then'), 'C8', '异步', '.then()', 'high', 'Control');
    }
    if (/\bsetTimeout\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('setTimeout'), 'C8', '异步', 'setTimeout()', 'high', 'Control');
    }
    if (/\bsetInterval\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('setInterval'), 'C8', '异步', 'setInterval()', 'high', 'Control');
    }
    if (/\bnew\s+Promise\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('Promise'), 'C8', '异步', 'new Promise()', 'high', 'Control');
    }

    // ═══════════════════════════════
    // 内存流 (Memory Flow)
    // ═══════════════════════════════

    // [M1 声明] const / let / var / class / function / import / export
    if (/\bconst\s+\w/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('const'), 'M1', '声明', 'const', 'low', 'Memory');
    }
    if (/\blet\s+\w/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('let'), 'M1', '声明', 'let', 'low', 'Memory');
    }
    if (/\bvar\s+\w/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('var'), 'M1', '声明', 'var', 'low', 'Memory');
    }
    if (/\bclass\s+\w/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('class'), 'M1', '声明', 'class', 'low', 'Memory');
    }
    if (/\bfunction\s+\w/.test(trimmed) || /\bfunction\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('function'), 'M1', '声明', 'function', 'low', 'Memory');
    }
    if (/\b(import|export)\b/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('import') !== -1 ? trimmed.indexOf('import') : trimmed.indexOf('export'), 'M1', '声明', 'import/export', 'low', 'Memory');
    }

    // [M2 赋值] = 赋值（排除声明、比较、箭头函数）
    if (/[^=!<>]=[^=]/.test(trimmed) || /[^=!<>]=$/.test(trimmed)) {
      // 排除 const/let/var/function 声明中的 =
      if (!/^\s*(const|let|var|function)\s/.test(trimmed)) {
        const eqIdx = trimmed.indexOf('=');
        // 确保不是 == 或 ===
        if (trimmed[eqIdx + 1] !== '=' && trimmed[eqIdx - 1] !== '!' &&
            trimmed[eqIdx - 1] !== '<' && trimmed[eqIdx - 1] !== '>' &&
            trimmed[eqIdx - 1] !== '=') {
          addAnnotation(annotations, lineNum, eqIdx + 1, 'M2', '赋值', '=', 'low', 'Memory');
        }
      }
    }

    // [M5 转换] JSON.parse / JSON.stringify / Number() / String() / toString() / parseInt / parseFloat / Date methods
    if (/\bJSON\.parse\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('JSON.parse'), 'M5', '转换', 'JSON.parse()', 'high', 'Memory');
    }
    if (/\bJSON\.stringify\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('JSON.stringify'), 'M5', '转换', 'JSON.stringify()', 'low', 'Memory');
    }
    if (/\bparseInt\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('parseInt'), 'M5', '转换', 'parseInt()', 'medium', 'Memory');
    }
    if (/\bparseFloat\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('parseFloat'), 'M5', '转换', 'parseFloat()', 'medium', 'Memory');
    }
    if (/\bNumber\s*\(/.test(trimmed) && !/\bNumber\./.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('Number'), 'M5', '转换', 'Number()', 'medium', 'Memory');
    }
    if (/\bString\s*\(/.test(trimmed) && !/\bString\./.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('String'), 'M5', '转换', 'String()', 'low', 'Memory');
    }
    if (/\.toString\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('.toString'), 'M5', '转换', '.toString()', 'low', 'Memory');
    }
    if (/\.getTime\s*\(/.test(trimmed) || /\.toISOString\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, 1, 'M5', '转换', trimmed.match(/\.(getTime|toISOString)/)[0], 'low', 'Memory');
    }

    // [M3 内存读取] 可选链 ?. 和空值合并 ??
    if (/\?\./.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('?.'), 'M3', '内存读取', '?.', 'low', 'Memory');
    }
    if (/\?\?/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('??'), 'M3', '内存读取', '??', 'low', 'Memory');
    }

    // [M4 计算] 算术和逻辑运算
    if (/[+\-*/%]\s/.test(trimmed) && !/^\s*\/\//.test(line)) {
      addAnnotation(annotations, lineNum, 1, 'M4', '计算', 'arithmetic op', 'low', 'Memory');
    }

    // [M20 初始化] init / config.load / getInstance / 启动逻辑
    if (/\binit\s*\(/.test(trimmed) && !/\binit\w+/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('init'), 'M20', '初始化', 'init()', 'low', 'Memory');
    }
    if (/\bconfig\.load\b/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('config'), 'M20', '初始化', 'config.load()', 'low', 'Memory');
    }
    if (/\bgetInstance\s*\(/.test(trimmed)) {
      addAnnotation(annotations, lineNum, trimmed.indexOf('getInstance'), 'M20', '初始化', 'getInstance()', 'low', 'Memory');
    }
  }

  // [M4 计算] 去重：同一行同一元动作只保留一个
  return deduplicate(annotations);
}

// ═══════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════

/**
 * [M2 赋值] 添加标注到数组
 */
function addAnnotation(list, line, column, id, name, code, riskLevel, flow) {
  list.push({
    line,
    column: column + 1, // 转为 1-indexed
    metaActionId: id,
    metaActionName: name,
    code,
    riskLevel,
    flow
  });
}

/**
 * [M4 计算] 去重：同一行同一元动作只保留第一个
 */
function deduplicate(annotations) {
  const seen = new Set();
  return annotations.filter(a => {
    const key = `${a.line}:${a.metaActionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// [F10 返回] 导出
module.exports = { annotate };
