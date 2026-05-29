// [M1 声明] 强制模式匹配器 — check(annotations, rules, strictness) → Violation[]
// 代码语义元动作体系 v1.9
//
// 职责：逐项检查强制配对。按 rules.json 中 forcedPairings 的 checkMethod 分发检查策略。
// 纯函数，不依赖 VS Code API。

/**
 * @typedef {Object} Violation
 * @property {number} line          — 违规行号
 * @property {number} column        — 违规列号
 * @property {string} message       — 违规描述
 * @property {string} severity      — error / warning / info
 * @property {string} metaActionId  — 违规的元动作编号
 * @property {string} rule          — 违反的规则 ID
 * @property {string} suggestion    — 修复建议
 */

/**
 * [F9 调用] 强制模式检查
 *
 * @param {Annotation[]} annotations — 语义标注结果
 * @param {Object} rules             — 规则配置（来自 rules.json）
 * @param {string} strictness        — 'strict' | 'moderate' | 'relaxed'
 * @returns {Violation[]}
 */
function check(annotations, rules, strictness) {
  const violations = [];

  // [C6 条件] 按严格度过滤配对规则
  const pairings = filterPairingsByStrictness(rules.forcedPairings, strictness);

  // [C7 循环] 逐条配对规则检查
  for (const pairing of pairings) {
    const sourceAnnotations = annotations.filter(a => a.metaActionId === pairing.source);

    for (const src of sourceAnnotations) {
      // [C6 条件] 按 checkMethod 分发检查策略
      const result = dispatchCheck(src, annotations, pairing);

      if (!result.satisfied) {
        violations.push({
          line: src.line,
          column: src.column,
          message: pairing.message || pairing.description,
          severity: pairing.severity || 'error',
          metaActionId: src.metaActionId,
          rule: pairing.id,
          suggestion: result.suggestion || buildDefaultSuggestion(pairing)
        });
      }
    }
  }

  // [M4 计算] 独立后处理：C7 forEach+async + I13 innerHTML XSS
  violations.push(...checkForEachAsync(annotations));
  violations.push(...checkInnerHTML(annotations));

  // [F10 返回]
  return violations;
}

/**
 * [C6 条件] 按 checkMethod 分发到对应检查函数
 */
function dispatchCheck(src, annotations, pairing) {
  switch (pairing.checkMethod) {

    // ═══════════════════════
    // scope: 在源码行范围内查找 target 元动作
    // 适用：I15→F12、M5→F12、C8→F12
    // ═══════════════════════
    case 'scope':
      return checkScopeProximity(src, annotations, pairing);

    // ═══════════════════════
    // scope_and_config: scope 查找 + 代码配置检查
    // 适用：I16→F12（需要 F12 + timeout + retry）
    // ═══════════════════════
    case 'scope_and_config':
      return checkScopeAndConfig(src, annotations, pairing);

    // ═══════════════════════
    // file: 文件级配对计数检查
    // 适用：R17→R18
    // ═══════════════════════
    case 'file':
      return checkFilePairing(annotations, pairing);

    // ═══════════════════════
    // call_proximity: 查找 requiredCalls 是否在附近出现
    // 适用：I14→validate+sanitize
    // ═══════════════════════
    case 'call_proximity':
      return checkRequiredCalls(src, annotations, pairing);

    // ═══════════════════════
    // self: 自检（F12 catch非空、F11 继承Error）
    // ═══════════════════════
    case 'self':
      return checkSelf(src, pairing);

    // ═══════════════════════
    // combined + 其他：由独立的 checkForEachAsync/checkInnerHTML 处理
    // ═══════════════════════
    default:
      return { satisfied: true };
  }
}

// ═══════════════════════════════════════════════
// 检查策略实现
// ═══════════════════════════════════════════════

/**
 * [F9 调用] scope: 检查 target 元动作是否在 src 附近
 */
function checkScopeProximity(src, annotations, pairing) {
  const range = pairing.scopeRange || 20;
  const hasTarget = annotations.some(a =>
    a.metaActionId === pairing.target &&
    Math.abs(a.line - src.line) <= range
  );

  if (hasTarget) {
    return { satisfied: true };
  }

  // 生成可操作的修复建议
  const sourceName = pairing.sourceName || pairing.source;
  const targetName = pairing.targetName || pairing.target;
  return {
    satisfied: false,
    suggestion: `将 [${sourceName}] 操作包裹在 try-catch 中（配对 [${targetName}]），确保异常被捕获`
  };
}

/**
 * [F9 调用] scope_and_config: 检查 target 元动作 + 代码配置项
 */
function checkScopeAndConfig(src, annotations, pairing) {
  const range = pairing.scopeRange || 30;

  // 检查 F12 捕获
  const hasTryCatch = annotations.some(a =>
    a.metaActionId === pairing.target &&
    Math.abs(a.line - src.line) <= range
  );

  // 检查代码片段中的配置项
  const code = src.code || '';
  const missingConfigs = [];

  if (pairing.requiredConfig) {
    for (const cfg of pairing.requiredConfig) {
      const found = checkConfigInCode(code, cfg);
      if (!found) missingConfigs.push(cfg);
    }
  }

  const missing = [];
  if (!hasTryCatch) missing.push('异常处理 (try-catch)');
  for (const c of missingConfigs) missing.push(`${c} 配置`);

  if (missing.length === 0) {
    return { satisfied: true };
  }

  return {
    satisfied: false,
    suggestion: `通信操作缺少: ${missing.join('、')}`
  };
}

/**
 * [M3 内存读取] 检查代码片段中是否包含指定配置项
 */
function checkConfigInCode(code, configName) {
  const patterns = {
    'timeout': /\btimeout\b/i,
    'retry': /\bretry\b|\bretries\b/i,
    'signal': /\bsignal\b|\bAbortController\b/i
  };
  const pattern = patterns[configName];
  if (!pattern) return false;
  return pattern.test(code);
}

/**
 * [F9 调用] file: 文件级配对计数（R17→R18）
 */
function checkFilePairing(annotations, pairing) {
  const sourceCount = annotations.filter(a => a.metaActionId === pairing.source).length;
  const targetCount = annotations.filter(a => a.metaActionId === pairing.target).length;

  if (sourceCount > targetCount) {
    return {
      satisfied: false,
      suggestion: `文件中有 ${sourceCount} 个 [${pairing.source}] 但只有 ${targetCount} 个 [${pairing.target}]，缺少 ${sourceCount - targetCount} 个配对`
    };
  }
  return { satisfied: true };
}

/**
 * [F9 调用] call_proximity: 检查 requiredCalls 是否在附近
 */
function checkRequiredCalls(src, annotations, pairing) {
  const range = pairing.scopeRange || 30;
  const nearby = annotations.filter(a =>
    Math.abs(a.line - src.line) <= range
  );

  const requiredCalls = pairing.requiredCalls || ['validate', 'sanitize'];
  const missing = [];

  for (const callName of requiredCalls) {
    const found = nearby.some(a => {
      const code = a.code || '';
      return code.toLowerCase().includes(callName.toLowerCase());
    });
    if (!found) missing.push(`${callName}()`);
  }

  if (missing.length === 0) {
    return { satisfied: true };
  }

  return {
    satisfied: false,
    suggestion: `用户输入缺少: ${missing.join('、')}`
  };
}

/**
 * [F9 调用] self: 自检
 */
function checkSelf(src, pairing) {
  // F12→non-empty-catch: AST级分析，正则无法准确判断，标记通过
  if (pairing.source === 'F12') {
    return { satisfied: true };
  }
  // F11→ERROR: throw 必须继承 Error
  if (pairing.source === 'F11') {
    const code = src.code || '';
    if (/\bthrow\s+(new\s+)?\w+/.test(code) && !/\bthrow\s+new\s+Error\b/.test(code) && !/\bthrow\s+new\s+\w+Error\b/.test(code)) {
      return {
        satisfied: false,
        suggestion: 'throw 语句应使用 Error 类（throw new Error(...)）或继承 Error 的自定义类'
      };
    }
    return { satisfied: true };
  }
  return { satisfied: true };
}

// ═══════════════════════════════════════════════
// 独立检查（不依赖 forcedPairings 配置）
// ═══════════════════════════════════════════════

/**
 * [C7 循环] forEach + async 组合禁止
 * 由 I13-XSS 和 C7-ASYNC 配对规则触发，也在 check 末尾统一执行
 */
function checkForEachAsync(annotations) {
  const violations = [];
  const forEachAnnotations = annotations.filter(a =>
    a.metaActionId === 'C7' && a.code && a.code.includes('forEach')
  );

  for (const fe of forEachAnnotations) {
    const nearbyAsync = annotations.some(a =>
      a.metaActionId === 'C8' &&
      Math.abs(a.line - fe.line) <= 3
    );

    if (nearbyAsync) {
      violations.push({
        line: fe.line,
        column: fe.column,
        message: '禁止 forEach + async 组合，请使用 for...of + await',
        severity: 'error',
        metaActionId: 'C7',
        rule: 'C7-ASYNC',
        suggestion: '将 forEach(async () => {...}) 替换为 for (const item of items) { await ... }'
      });
    }
  }
  return violations;
}

/**
 * [I13 渲染] innerHTML 使用 → XSS 风险
 */
function checkInnerHTML(annotations) {
  const violations = [];
  const innerHTMLAnnotations = annotations.filter(a =>
    a.metaActionId === 'I13' && a.code && (
      a.code.includes('innerHTML') ||
      a.code.includes('outerHTML') ||
      a.code.includes('insertAdjacentHTML')
    )
  );

  for (const ann of innerHTMLAnnotations) {
    violations.push({
      line: ann.line,
      column: ann.column,
      message: '直接使用 innerHTML 存在 XSS 风险，请使用 textContent 或 DOM API',
      severity: 'warning',
      metaActionId: 'I13',
      rule: 'I13-XSS',
      suggestion: '使用 textContent 替代 innerHTML，或使用 DOMPurify.sanitize() 清洗后再赋值'
    });
  }
  return violations;
}

// ═══════════════════════════════════════════════
// 严格度过滤
// ═══════════════════════════════════════════════

/**
 * [C6 条件] 按严格度过滤配对规则
 */
function filterPairingsByStrictness(forcedPairings, strictness) {
  // 使用 rules.json 的 strictnessLevels 配置（如果存在）
  // 否则使用启发式过滤

  // relaxed: 仅 I14（用户输入）和 I16（通信）强制
  if (strictness === 'relaxed') {
    return forcedPairings.filter(p => p.source === 'I14' || p.source === 'I16');
  }

  // moderate: I 流 + R 流强制
  if (strictness === 'moderate') {
    return forcedPairings.filter(p =>
      p.source.startsWith('I') || p.source.startsWith('R')
    );
  }

  // strict: 全部强制（排除 combined 类型，由独立检查处理）
  return forcedPairings.filter(p => p.checkMethod !== 'combined');
}

/**
 * [M5 转换] 根据配对规则生成默认修复建议
 */
function buildDefaultSuggestion(pairing) {
  const sourceName = pairing.sourceName || pairing.source;
  const targetName = pairing.targetName || pairing.target;

  switch (pairing.checkMethod) {
    case 'scope':
      return `将 [${sourceName}] 操作包裹在 try-catch 中，确保异常被捕获`;
    case 'scope_and_config':
      return `为 [${sourceName}] 添加 timeout 超时配置 + retry 重试机制 + try-catch 异常处理`;
    case 'file':
      return `为每个 [${sourceName}] 添加对应的 [${targetName}] 清理操作`;
    case 'call_proximity':
      return `在 [${sourceName}] 附近调用 validate() 和 sanitize() 函数`;
    case 'self':
      return `检查 [${sourceName}] 的实现是否符合强制模式要求`;
    default:
      return `[${sourceName}] 需要配对 [${targetName}]`;
  }
}

// [F10 返回] 导出
module.exports = { check, checkForEachAsync, checkInnerHTML };
