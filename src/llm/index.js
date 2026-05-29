// [M1 声明] LLM 适配器统一导出
// 代码语义元动作体系 v1.9

const { chat, getAvailableModels } = require('./adapters');

module.exports = {
  chat,
  getAvailableModels
};
