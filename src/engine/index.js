// [M1 声明] 合规引擎统一导出
// 代码语义元动作体系 v1.9
//
// 对外接口：
//   annotate(code, language)    → Annotation[]
//   check(annotations, rules, strictness) → Violation[]
//   loadRules(configPath)       → Rule[]

const { annotate } = require('./annotator');
const { check } = require('./checker');
const { loadRules } = require('./loader');

module.exports = {
  annotate,
  check,
  loadRules
};
