// [M1 声明] Probe 会话状态管理器
// 代码语义元动作体系 v1.9
//
// 职责：管理 probe 多轮对话的会话状态。
// 纯函数，不依赖 VS Code API，不调 LLM。
//
// 暴露给对话二的接口：
//   createSession(requirement) → Session
//   addMessage(session, role, content) → Session
//   advanceDimension(session, userMessage) → Session
//   isComplete(session) → boolean
//   getSessionSummary(session) → string（供 LLM 上下文使用）

const DIMENSIONS = [
  { key: 'extract',     name: '信息提取',    order: 0 },
  { key: 'lifecycle',   name: '实体生命周期',  order: 1 },
  { key: 'roles',       name: '角色与权限',    order: 2 },
  { key: 'dataShape',   name: '数据形状',      order: 3 },
  { key: 'integration', name: '外部集成面',    order: 4 },
  { key: 'nonFunctional', name: '非功能约束',  order: 5 },
  { key: 'assumptionReceipt', name: '假设回执', order: 6 }
];

const STATE = {
  PENDING:  'pending',
  PROBING:  'probing',
  DONE:     'done'
};

/**
 * [M20 初始化] 创建新的 probe 会话
 *
 * @param {string} requirement — 用户原始需求
 * @returns {Object} Session
 */
function createSession(requirement) {
  const now = new Date();
  const id = 'probe-' + formatTimestamp(now);

  return {
    id,
    createdAt: now.toISOString(),
    requirement,
    status: 'probing',           // 'probing' | 'complete'
    dimensions: initDimensions(),
    currentDimension: 'extract',
    entities: [],                // [{name, states: []}]
    currentEntity: null,
    history: [],                 // [{role, content, timestamp}]
    confirmedFacts: [],          // 用户已确认的事实
    assumptions: [],             // AI 默认假设
    turnCount: 0,
    consecutiveNoMore: 0         // 用户连续说"没了"的次数
  };
}

/**
 * [M20 初始化] 初始化所有维度状态
 */
function initDimensions() {
  const dims = {};
  for (const d of DIMENSIONS) {
    dims[d.key] = { ...d, state: STATE.PENDING, startedAt: null, doneAt: null };
  }
  // 第零步自动完成
  dims.extract.state = STATE.DONE;
  dims.extract.doneAt = new Date().toISOString();
  return dims;
}

/**
 * [M2 赋值] 向会话历史添加一条消息
 */
function addMessage(session, role, content) {
  session.history.push({
    role,
    content,
    timestamp: new Date().toISOString()
  });
  if (role === 'user') {
    session.turnCount++;
  }
  return session;
}

/**
 * [F9 调用] 根据用户回复推进探测维度
 *
 * 判断逻辑：
 *   1. 如果当前维度是 probing → 检查用户是否回答充分
 *   2. 用户说"没了/可以/就这些/确认" → 当前维度标记 done，推进到下一个
 *   3. 否则继续当前维度
 */
function advanceDimension(session, userMessage) {
  const msg = userMessage.trim().toLowerCase();

  // [C6 条件] 检测"终止信号"（用户表示当前维度无更多内容）
  const stopSignals = /^(没了|没有了|就这些|可以|确认|对|是|嗯|好|ok|yes|done|next|下一个|继续|差不多|暂时没有).*$/;
  const isStopSignal = stopSignals.test(msg) || msg.length <= 3;

  if (isStopSignal && session.currentDimension !== 'assumptionReceipt') {
    session.consecutiveNoMore++;

    // [C6 条件] 连续两次"没了" → 当前维度完成
    if (session.consecutiveNoMore >= 2 || msg.includes('下一个') || msg.includes('继续')) {
      markDimensionDone(session, session.currentDimension);
      moveToNextDimension(session);
      session.consecutiveNoMore = 0;
    }
  } else {
    session.consecutiveNoMore = 0;

    // [C6 条件] 非终止信号且维度是 pending → 开始探测
    if (session.dimensions[session.currentDimension].state === STATE.PENDING) {
      session.dimensions[session.currentDimension].state = STATE.PROBING;
      session.dimensions[session.currentDimension].startedAt = new Date().toISOString();
    }
  }

  return session;
}

/**
 * [M2 赋值] 标记维度完成
 */
function markDimensionDone(session, dimKey) {
  if (session.dimensions[dimKey]) {
    session.dimensions[dimKey].state = STATE.DONE;
    session.dimensions[dimKey].doneAt = new Date().toISOString();
  }
}

/**
 * [C6 条件] 推进到下一个维度
 */
function moveToNextDimension(session) {
  const ordered = DIMENSIONS.filter(d => d.order > 0); // 跳过第零步 extract

  // [C6 条件] 找到当前维度在 ordered 中的位置
  let startIdx = -1;
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].key === session.currentDimension) {
      startIdx = i;
      break;
    }
  }

  // [C6 条件] 如果当前维度不在 ordered 中（比如是 extract），从第一个开始
  if (startIdx === -1) {
    startIdx = -1; // 从 0 开始
  }

  // 找下一个 pending 的维度
  for (let j = startIdx + 1; j < ordered.length; j++) {
    if (session.dimensions[ordered[j].key].state === STATE.PENDING) {
      session.currentDimension = ordered[j].key;
      session.dimensions[ordered[j].key].state = STATE.PROBING;
      session.dimensions[ordered[j].key].startedAt = new Date().toISOString();
      return;
    }
  }

  // 所有维度完成 → 进入假设回执
  session.currentDimension = 'assumptionReceipt';
  session.dimensions.assumptionReceipt.state = STATE.PROBING;
  session.dimensions.assumptionReceipt.startedAt = new Date().toISOString();
}

/**
 * [C6 条件] 检查是否所有维度完成
 */
function isComplete(session) {
  return DIMENSIONS.every(d =>
    session.dimensions[d.key].state === STATE.DONE
  );
}

/**
 * [M5 转换] 检查是否应该触发 BDD 生成
 * 条件：假设回执维度也完成了
 */
function isReadyForBDD(session) {
  return session.dimensions.assumptionReceipt.state === STATE.DONE;
}

/**
 * [M5 转换] 生成会话状态摘要（供 LLM 上下文和 AI_STATE 使用）
 */
function getSessionSummary(session) {
  const dims = DIMENSIONS.map(d => {
    const s = session.dimensions[d.key];
    const icon = s.state === STATE.DONE ? '✅' : s.state === STATE.PROBING ? '⏳' : '⬜';
    return `${icon} ${d.name}`;
  }).join('\n');

  return [
    `会话 ID: ${session.id}`,
    `状态: ${session.status}`,
    `轮次: ${session.turnCount}`,
    `当前维度: ${session.currentDimension}`,
    '',
    '维度进度:',
    dims,
    '',
    `已确认事实: ${session.confirmedFacts.length} 条`,
    `默认假设: ${session.assumptions.length} 条`
  ].join('\n');
}

/**
 * [M5 转换] 获取下一个问题的引导提示（供 LLM 使用）
 */
function getNextPromptHint(session) {
  const dim = session.dimensions[session.currentDimension];
  if (!dim) return '请继续探测需求';

  const hints = {
    extract: '请从用户需求中提取已明确的信息，整理后告诉用户你理解了什么',
    lifecycle: '请向用户确认核心实体的状态机：有哪些状态、如何流转、哪些不可逆、并发如何处理',
    roles: '请确认是否需要区分角色（普通用户/管理员/创建者），如果需要，画权限矩阵让用户确认',
    dataShape: '请逐字段确认：类型、枚举值、约束、默认值、唯一性、关联来源',
    integration: '请确认是否与外部系统交互（数据库/第三方API/支付/短信/邮件），没有就说没有',
    nonFunctional: '请确认数据规模、并发用户数、使用环境（桌面/手机/内网/公网）',
    assumptionReceipt: '所有维度已扫完。请汇总所有默认假设，逐条列出让用户确认。用户连续两次确认后，输出完整 BDD 规格文档。'
  };

  return hints[session.currentDimension] || hints.extract;
}

/**
 * [M5 转换] 时间戳格式化
 */
function formatTimestamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${h}${min}${s}`;
}

// [F10 返回] 导出
module.exports = {
  DIMENSIONS,
  STATE,
  createSession,
  addMessage,
  advanceDimension,
  isComplete,
  isReadyForBDD,
  getSessionSummary,
  getNextPromptHint,
  markDimensionDone
};
