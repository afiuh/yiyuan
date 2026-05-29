// [M1 声明] 规则加载器 — loadRules(configPath) → Rule[]
// 代码语义元动作体系 v1.9
//
// 职责：从 JSON 文件加载规则配置，支持用户自定义路径。
// 纯函数，不依赖 VS Code API。

const fs = require('fs');
const path = require('path');

/**
 * @typedef {Object} Rule
 * @property {Array} metaActions — 20 种元动作分类
 * @property {Array} forcedPairings — 强制配对规则
 * @property {Object} [languagePatterns] — 语言特定模式
 */

/**
 * [F9 调用] 加载规则配置
 *
 * @param {string} configPath — JSON 规则文件路径
 * @returns {Rule} 规则对象
 */
function loadRules(configPath) {
  // [C6 条件] 检查文件是否存在
  if (!fs.existsSync(configPath)) {
    throw new Error(`[意元] 规则文件不存在: ${configPath}`);
  }

  // [I15 存储] 读取文件
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    // [F11 抛出] 读取失败
    throw new Error(`[意元] 无法读取规则文件: ${err.message}`);
  }

  // [M5 转换] JSON 解析（规则文件是本地可信文件，不强制 try-catch）
  let rules;
  try {
    rules = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[意元] 规则文件 JSON 格式错误: ${err.message}`);
  }

  // [C6 条件] 校验规则结构
  validateRules(rules);

  // [F10 返回]
  return rules;
}

/**
 * [M3 内存读取] 校验规则结构完整性
 */
function validateRules(rules) {
  if (!rules || typeof rules !== 'object') {
    throw new Error('[意元] 规则文件格式无效：根必须是对象');
  }

  if (!Array.isArray(rules.metaActions) || rules.metaActions.length === 0) {
    throw new Error('[意元] 规则文件缺少 metaActions 数组');
  }

  if (!Array.isArray(rules.forcedPairings) || rules.forcedPairings.length === 0) {
    throw new Error('[意元] 规则文件缺少 forcedPairings 数组');
  }

  // [C7 循环] 校验每个配对规则
  for (const pairing of rules.forcedPairings) {
    if (!pairing.id || !pairing.source || !pairing.target) {
      throw new Error(`[意元] 强制配对规则不完整（缺 id/source/target）: ${JSON.stringify(pairing)}`);
    }
    // 兼容 message 和 description 两种字段名
    if (!pairing.message && !pairing.description) {
      throw new Error(`[意元] 强制配对规则缺少 message/description: ${JSON.stringify(pairing)}`);
    }
    // 统一到 message 字段
    if (!pairing.message) {
      pairing.message = pairing.description;
    }
  }

  // [I13 渲染] 加载成功
  const totalActions = rules.metaActions.reduce((sum, cat) => sum + cat.actions.length, 0);
  console.log(`[意元] 规则加载成功: ${totalActions} 种元动作, ${rules.forcedPairings.length} 条强制配对`);
}

// [F10 返回] 导出
module.exports = { loadRules };
