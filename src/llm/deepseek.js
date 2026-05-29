// [M1 声明] DeepSeek API 适配器
// 代码语义元动作体系 v1.9
//
// 职责：封装 DeepSeek Chat API（deepseek-chat）调用。
// 纯函数，不依赖 VS Code API。

const https = require('https');
const http = require('http');

const DEEPSEEK_API_URL = 'api.deepseek.com';
const DEEPSEEK_API_PATH = '/chat/completions';

/**
 * [F9 调用] DeepSeek chat 请求
 *
 * @param {Array} messages — [{role, content}, ...]
 * @param {string} apiKey — API Key
 * @param {boolean} stream — 是否流式输出
 * @param {number} retries — 剩余重试次数
 * @returns {Promise<string>} 模型回复文本
 */
async function deepseekChat(messages, apiKey, stream, onToken, retries = 2) {
  // [M20 初始化] 请求体
  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages,
    stream: stream || false,
    temperature: 0.7,
    max_tokens: 4096
  });

  // [M20 初始化] 请求选项
  const options = {
    hostname: DEEPSEEK_API_URL,
    path: DEEPSEEK_API_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept': stream ? 'text/event-stream' : 'application/json'
    },
    timeout: 30000 // 30 秒超时
  };

  // [I16 通信] 发送请求
  try {
    if (stream) {
      return await streamRequest(options, body, onToken);
    } else {
      return await normalRequest(options, body);
    }
  } catch (err) {
    // [F12 捕获] 网络错误自动重试
    if (retries > 0) {
      console.warn(`[意元] DeepSeek 请求失败，剩余重试 ${retries} 次: ${err.message}`);
      // [C8 异步] 等待后重试
      await sleep(1000);
      return deepseekChat(messages, apiKey, stream, onToken, retries - 1);
    }
    // [F11 抛出] 重试耗尽
    throw new Error(`DeepSeek API 请求失败（已重试 2 次）: ${err.message}`);
  }
}

/**
 * [I16 通信] 普通请求（非流式）
 */
function normalRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        // [C6 条件] 检查 HTTP 状态码
        if (res.statusCode !== 200) {
          let errMsg = `HTTP ${res.statusCode}`;
          try {
            const err = JSON.parse(data);
            errMsg = err.error?.message || errMsg;
          } catch (_) {}
          reject(new Error(errMsg));
          return;
        }

        // [M5 转换] 解析 JSON 响应
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.message?.content || '';
          resolve(content);
        } catch (err) {
          reject(new Error(`响应解析失败: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时（30 秒）'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * [I16 通信] SSE 流式请求
 */
function streamRequest(options, body, onToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      // [C6 条件] 检查 HTTP 状态码
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        });
        return;
      }

      let fullContent = '';
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();

        // [C7 循环] 解析 SSE 事件
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的行

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                if (onToken) onToken(delta);
              }
            } catch (_) {
              // 跳过无法解析的数据块
            }
          }
        }
      });

      res.on('end', () => {
        // [C6 条件] 处理缓冲区残留
        if (buffer.startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
          try {
            const json = JSON.parse(buffer.slice(6).trim());
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) fullContent += delta;
          } catch (_) {}
        }
        resolve(fullContent);
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('流式请求超时（30 秒）'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * [C8 异步] 延迟工具函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// [F10 返回]
module.exports = { deepseekChat };
