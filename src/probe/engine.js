// [M1 声明] Probe 对话引擎
// 代码语义元动作体系 v1.9
//
// 职责：编排 probe 多轮对话 —— 接收用户消息，更新会话状态，
//       决定下一步动作（继续提问 or 输出 BDD）。
// 纯函数，不调 LLM（LLM 调用由 extension.js 或对话二 WebView 完成）。
//
// 暴露给对话二的接口：
//   startProbe(requirement) → { session, systemPrompt }
//   continueProbe(session, userMessage) → { session, action }

const sessionManager = require('./session');

/**
 * [M20 初始化] 启动 probe 对话
 *
 * @param {string} requirement — 用户原始需求
 * @returns {{ session: Object, action: Object }}
 *   action = { type: 'ask', systemPrompt: string, promptHint: string }
 */
function startProbe(requirement) {
  const session = sessionManager.createSession(requirement);

  // [M4 计算] 构建系统提示词上下文
  const systemPrompt = buildSystemContext(session);

  return {
    session,
    action: {
      type: 'ask',
      systemPrompt,
      promptHint: sessionManager.getNextPromptHint(session)
    }
  };
}

/**
 * [F9 调用] 处理用户回复，继续对话
 *
 * @param {Object} session — 当前会话状态
 * @param {string} userMessage — 用户回复
 * @returns {{ session: Object, action: Object }}
 *   action = { type: 'ask', ... } 继续提问
 *          | { type: 'bdd', systemPrompt: string } 生成 BDD
 *          | { type: 'complete', bddContent: string } BDD 已生成
 */
function continueProbe(session, userMessage) {
  // [M2 赋值] 记录用户回复
  sessionManager.addMessage(session, 'user', userMessage);

  // [C6 条件] 推进维度
  sessionManager.advanceDimension(session, userMessage);

  // [C6 条件] 判断下一步
  if (sessionManager.isReadyForBDD(session)) {
    // 所有维度完成 → 要求 LLM 生成最终 BDD
    return {
      session,
      action: {
        type: 'bdd',
        systemPrompt: buildBDDSystemContext(session)
      }
    };
  }

  // 继续提问
  return {
    session,
    action: {
      type: 'ask',
      systemPrompt: buildSystemContext(session),
      promptHint: sessionManager.getNextPromptHint(session)
    }
  };
}

/**
 * [F9 调用] BDD 生成完成，标记会话结束
 */
function completeProbe(session, bddContent) {
  session.status = 'complete';
  sessionManager.markDimensionDone(session, 'assumptionReceipt');
  return {
    session,
    bddContent
  };
}

/**
 * [M5 转换] 构建探测阶段的系统提示词上下文
 */
function buildSystemContext(session) {
  const dims = sessionManager.DIMENSIONS.map(d => {
    const s = session.dimensions[d.key];
    const icon = s.state === sessionManager.STATE.DONE ? '✅' :
                 s.state === sessionManager.STATE.PROBING ? '⏳ 当前' : '⬜';
    return `${icon} ${d.name}`;
  }).join('\n');

  return [
    `会话状态：`,
    `  当前维度：${session.dimensions[session.currentDimension].name}`,
    `  已进行 ${session.turnCount} 轮对话`,
    '',
    '维度进度：',
    dims,
    '',
    '对话历史（最近 10 轮）：',
    ...session.history.slice(-10).map(m =>
      `  ${m.role === 'user' ? '👤 用户' : '🤖 AI'}：${m.content.slice(0, 200)}`
    )
  ].join('\n');
}

/**
 * [M5 转换] 构建 BDD 生成阶段的系统提示词上下文
 */
function buildBDDSystemContext(session) {
  return [
    '所有六个维度已探测完毕。请基于以下对话历史，生成完整的 BDD 需求规格文档。',
    '',
    '对话历史：',
    ...session.history.map(m =>
      `  ${m.role === 'user' ? '👤 用户' : '🤖 AI'}：${m.content}`
    ),
    '',
    '请按以下结构输出 BDD：',
    '一、功能概述',
    '二、实体生命周期（表格）',
    '三、角色与权限（表格）',
    '四、数据形状（表格）',
    '五、外部集成',
    '六、非功能约束',
    '七、BDD 场景（每个子功能 Happy Path + Borderline + Error Path）',
    '八、元动作风险预览',
    '九、假设回执（✅ 用户已确认 + ⚠️ AI 默认假设）'
  ].join('\n');
}

// [F10 返回] 导出
module.exports = {
  startProbe,
  continueProbe,
  completeProbe
};
