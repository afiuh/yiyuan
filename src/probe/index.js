// [M1 声明] probe 模块统一导出
const sessionManager = require('./session');
const engine = require('./engine');

module.exports = {
  // 会话管理（纯状态机）
  ...sessionManager,
  // 对话引擎（编排器）
  ...engine
};
