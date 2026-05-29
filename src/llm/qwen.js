// [M1 声明] 通义千问 API 适配器
// 代码语义元动作体系 v1.9
//
// 职责：封装通义千问 API（qwen-turbo）调用。
// 纯函数，不依赖 VS Code API。

const https = require('https');

const QWEN_API_URL = 'dashscope.aliyuncs.com';
const QWEN_API_PATH = '/compatible-mode/v1/chat/completions';

/**
 * [F9 调用] 通义千问 chat 请求
 *
 * @param {Array} messages — [{role, content}, ...]
 * @param {string} apiKey — API Key
 * @param {boolean} stream — 是否流式输出
 * @param {number} retries — 剩余重试次数
 * @returns {Promise<string>} 模型回复文本
 */
async function qwenChat(messages, apiKey, stream, retries = 2) {
  // [M20 初始化] 请求体
  const body = JSON.stringify({
    model: 'qwen-turbo',
    messages,
    stream: stream || false,
    temperature: 0.7,
    max_tokens: 4096
  });

  // [M20 初始化] 请求选项
  const options = {
    hostname: QWEN_API_URL,
    path: QWEN_API_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept': stream ? 'text/event-stream' : 'application/json'
    },
    timeout: 30000
  };

  // [I16 通信] 发送请求
  try {
    if (stream) {
      return await streamRequest(options, body);
    } else {
      return await normalRequest(options, body);
    }
  } catch (err) {
    // [F12 捕获] 重试
    if (retries > 0) {
      console.warn(`[意元] 通义千问请求失败，剩余重试 ${retries} 次: ${err.message}`);
      await sleep(1000);
      return qwenChat(messages, apiKey, stream, retries - 1);
    }
    throw new Error(`通义千问 API 请求失败（已重试 2 次）: ${err.message}`);
  }
}

/**
 * [I16 通信] 普通请求
 */
function normalRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let errMsg = `HTTP ${res.statusCode}`;
          try {
            const err = JSON.parse(data);
            errMsg = err.message || err.msg || errMsg;
          } catch (_) {}
          reject(new Error(errMsg));
          return;
        }

        try {
          const json = JSON.parse(data);
          // [M3 内存读取] 通义千问响应格式
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
function streamRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)));
        return;
      }

      let fullContent = '';
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) fullContent += delta;
            } catch (_) {}
          }
        }
      });

      res.on('end', () => {
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { qwenChat };
