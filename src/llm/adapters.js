// [M1 声明] LLM 统一适配器
// 代码语义元动作体系 v1.9
//
// 职责：统一 chat(messages, model, stream, apiKey) 接口，
//       路由到 DeepSeek / 通义千问 / GLM 三个适配器。
// 纯函数，不依赖 VS Code API。

const { deepseekChat } = require('./deepseek');
const { qwenChat } = require('./qwen');
const { glmChat } = require('./glm');

/**
 * [F9 调用] 统一 LLM 调用接口
 *
 * @param {Array} messages   — [{role: 'system'|'user'|'assistant', content: '...'}, ...]
 * @param {string} model     — 'deepseek-chat' | 'qwen-turbo' | 'glm-4'
 * @param {boolean} stream   — 是否流式输出
 * @param {string} apiKey    — API Key（由调用方从 VS Code 配置中读取并传入）
 * @returns {Promise<string>} 模型回复文本
 */
async function chat(messages, model, stream, apiKey, onToken) {
  // [C6 条件] 校验 apiKey
  if (!apiKey) {
    throw new Error(`未配置 ${model} 的 API Key，请在 VS Code 设置中配置 yiyuan.${modelToConfigKey(model)}`);
  }

  // [C6 条件] 校验 messages
  if (!messages || messages.length === 0) {
    throw new Error('消息列表不能为空');
  }

  // [C6 条件] 路由到对应适配器
  switch (model) {
    case 'deepseek-chat':
      // [I16 通信]
      return await deepseekChat(messages, apiKey, stream, onToken);

    case 'qwen-turbo':
      return await qwenChat(messages, apiKey, stream, onToken);

    case 'glm-4':
      return await glmChat(messages, apiKey, stream, onToken);

    default:
      throw new Error(
        `不支持的模型: ${model}。可用模型: ${getAvailableModels().join(', ')}`
      );
  }
}

/**
 * [F9 调用] 获取可用模型列表
 *
 * @returns {string[]}
 */
function getAvailableModels() {
  return ['deepseek-chat', 'qwen-turbo', 'glm-4'];
}

/**
 * [M5 转换] model 名称 → VS Code 配置 key
 */
function modelToConfigKey(model) {
  const map = {
    'deepseek-chat': 'deepseekApiKey',
    'qwen-turbo': 'qwenApiKey',
    'glm-4': 'glmApiKey'
  };
  return map[model] || 'defaultModel';
}

// [F10 返回] 导出
module.exports = { chat, getAvailableModels };
