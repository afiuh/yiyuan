// [M1 声明] 意元 VS Code 插件入口
// 代码语义元动作体系 v1.9
//
// 职责：
//   activate  — 注册命令 + onDidSaveTextDocument → 合规链
//   deactivate — 清理资源
//
// MADD 数据流（v0.1）：
//   用户输入 → probe（LLM探测）→ BDD规格 → 人类审查
//   → blueprint（LLM蓝图）→ 语义蓝图 → 人类审查
//   → 手写代码 → 保存触发 → 合规引擎 → PROBLEMS面板

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// ─── 合规引擎（纯函数，不依赖 VS Code API） ───
const { annotate, check, loadRules } = require('./src/engine');
const { toDiagnostics } = require('./src/diagnostics');

// ─── LLM 适配器（纯函数） ───
const { chat, getAvailableModels } = require('./src/llm');

// ─── 提示词模板（纯函数） ───
const { loadProbeTemplate, loadBlueprintTemplate, loadTestTemplate, loadCodeTemplate } = require('./src/templates');

// ─── Probe 对话引擎（多轮会话管理） ───
const {
  createSession, addMessage, advanceDimension,
  isReadyForBDD, getNextPromptHint, getSessionSummary
} = require('./src/probe');

// ─── WebView 面板（对话二实现） ───
const { ProbePanel } = require('./src/webview/probe-panel');
const { BlueprintPanel } = require('./src/webview/blueprint-panel');
const { EditorPanel } = require('./src/webview/editor-panel');
const { CompliancePanel } = require('./src/webview/compliance-panel');
const { DecisionPanel } = require('./src/webview/decision-panel');

// ─── 诊断集合 + 面板实例 + 阶段状态 ───
let diagnosticCollection;
let probePanel, blueprintPanel, editorPanel, compliancePanel, decisionPanel;
let complianceDebounceTimer = null;
let statusBarItem = null;

const MADD_STAGES = [
  { id: 'init',       label: '初始化',       icon: '⚪', nextCmd: 'yiyuan.probe',     nextLabel: '开始六维度探测需求' },
  { id: 'probe',      label: '需求探测',      icon: '🔵', nextCmd: 'yiyuan.probe',     nextLabel: '六维度探测需求' },
  { id: 'bdd_ready',  label: 'BDD 就绪',      icon: '🟡', nextCmd: 'yiyuan.blueprint', nextLabel: '生成语义蓝图' },
  { id: 'blueprint',  label: '蓝图就绪',      icon: '🟠', nextCmd: 'yiyuan.genTest',   nextLabel: '生成测试' },
  { id: 'test_ready', label: '测试就绪',      icon: '🟣', nextCmd: 'yiyuan.genTest',   nextLabel: '生成测试（进入管线）' },
  { id: 'done',       label: '管线完成',      icon: '🟢', nextCmd: 'yiyuan.compliancePanel', nextLabel: '查看合规面板' }
];

/**
 * [M20 初始化] activate — 插件激活入口
 */
function activate(context) {
  // [M1 声明] 创建诊断集合
  diagnosticCollection = vscode.languages.createDiagnosticCollection('yiyuan');
  context.subscriptions.push(diagnosticCollection);

  // [M20 初始化] 确保输出目录存在
  ensureDir(path.join(getWorkspaceRoot(), 'docs', 'blueprints'));
  ensureDir(path.join(getWorkspaceRoot(), 'docs', 'experience', '00-seed'));
  ensureDir(path.join(getWorkspaceRoot(), 'docs', 'experience', '01-runtime'));

  // ═══════════════════════════════════════════════
  // 【最高优先级】阶段感知 — 状态栏常驻 + AI_STATE 指令
  // ═══════════════════════════════════════════════
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  statusBarItem.command = 'yiyuan.probe';
  statusBarItem.tooltip = 'MADD 阶段感知 — 点击执行下一步';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  context.subscriptions.push(statusBarItem);
  updateStage();
  updateAIState();

  // ═══════════════════════════════════════════════
  // 命令注册（对话二：全部切换到 WebView 面板）
  // ═══════════════════════════════════════════════

  // [M20 初始化] 创建面板实例
  probePanel = new ProbePanel(context.extensionUri, (msg) => handleProbeMessage(msg));
  blueprintPanel = new BlueprintPanel(context.extensionUri, (msg) => handleBlueprintMessage(msg));
  editorPanel = new EditorPanel(context.extensionUri, (msg) => handleEditorMessage(msg));
  compliancePanel = new CompliancePanel(context.extensionUri, (msg) => handleComplianceMessage(msg));
  decisionPanel = new DecisionPanel(context.extensionUri, (msg) => handleDecisionMessage(msg));

  // [C6 条件] 命令：手动触发合规审查（PROBLEMS 面板，保留原有行为）
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.compliance', () => {
      runComplianceOnActiveEditor();
    })
  );

  // [C6 条件] 命令：六维度探测需求 → WebView 对话面板
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.probe', () => {
      probePanel.open();
    })
  );

  // [C6 条件] 命令：生成语义蓝图 → WebView 蓝图浏览面板
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.blueprint', () => {
      blueprintPanel.open();
    })
  );

  // [C6 条件] 命令：打开元动作编辑器面板
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.editor', () => {
      runEditorPanel();
    })
  );

  // [C6 条件] 命令：打开合规审查面板
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.compliancePanel', () => {
      runCompliancePanel();
    })
  );

  // [C6 条件] 命令：生成测试（基于蓝图）
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.genTest', async () => {
      await runGenTest();
    })
  );

  // [C6 条件] 命令：生成代码（基于蓝图）
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.genCode', async () => {
      await runGenCode();
    })
  );

  // [C6 条件] 命令：环境就绪检查
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.envCheck', async () => {
      await runEnvCheck();
    })
  );

  // [C6 条件] 命令：集成验证
  context.subscriptions.push(
    vscode.commands.registerCommand('yiyuan.integrate', async () => {
      await runIntegrate();
    })
  );

  // ═══════════════════════════════════════════════
  // 保存文件 → 自动合规审查
  // ═══════════════════════════════════════════════

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      // [C6 条件] 只对 JS/TS 文件触发
      const lang = document.languageId;
      if (lang === 'javascript' || lang === 'typescript' ||
          lang === 'javascriptreact' || lang === 'typescriptreact') {
        runCompliance(document);
      }
    })
  );

  // [C7 循环] 实时编辑监听 → debounce 1s → 推送合规面板
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const lang = event.document.languageId;
      if (lang === 'javascript' || lang === 'typescript' ||
          lang === 'javascriptreact' || lang === 'typescriptreact') {
        clearTimeout(complianceDebounceTimer);
        complianceDebounceTimer = setTimeout(() => {
          pushComplianceToPanel(event.document);
        }, 1000);
      }
    })
  );

  // [I13 渲染] 激活提示
  vscode.window.showInformationMessage('意元 v0.1 — 代码语义元动作体系已激活');
}

// ═══════════════════════════════════════════════
// 合规审查
// ═══════════════════════════════════════════════

/**
 * [F9 调用] 对当前活动编辑器运行合规审查
 */
async function runComplianceOnActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('没有打开的编辑器');
    return;
  }
  await runCompliance(editor.document);
}

/**
 * [F9 调用] 核心合规链：annotate → check → toDiagnostics → PROBLEMS 面板
 */
async function runCompliance(document) {
  try {
    const code = document.getText();
    const language = document.languageId;

    const config = vscode.workspace.getConfiguration('yiyuan');
    let rulesPath = config.get('rulesPath', '');
    if (!rulesPath) {
      rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
    }

    const rules = loadRules(rulesPath);
    const annotations = annotate(code, language);
    const strictness = config.get('reviewStrictness', 'strict');
    const violations = check(annotations, rules, strictness);
    const diagnostics = toDiagnostics(violations, document);

    diagnosticCollection.set(document.uri, diagnostics);

    if (violations.length === 0) {
      vscode.window.setStatusBarMessage('意元：✅ 合规审查通过', 5000);
    } else {
      vscode.window.setStatusBarMessage(
        `意元：❌ ${violations.length} 项违规`, 10000
      );
    }
  } catch (err) {
    console.error('[意元] 合规审查异常:', err);
    vscode.window.showErrorMessage(`意元审查异常: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════
// 阶段一：probe → BDD 规格（WebView 对话面板）
// ═══════════════════════════════════════════════

let probeSession = null;

/**
 * [F9 调用] 处理 probe 面板消息
 */
async function handleProbeMessage(msg) {
  try {
    switch (msg.type) {
      case 'start':
        await startProbeSession(msg.requirement);
        break;
      case 'userMessage':
        await handleProbeUserMessage(msg.content);
        break;
    }
  } catch (err) {
    console.error('[意元] 探测失败:', err);
    probePanel.sendError(err.message);
  }
}

/**
 * [M20 初始化] 启动 probe 会话：创建会话 → 调 LLM 第一轮
 */
async function startProbeSession(requirement) {
  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);

  if (!apiKey) {
    probePanel.sendError(`未配置 ${model} 的 API Key，请在 VS Code 设置中配置`);
    return;
  }

  // [M20 初始化] 加载元动作定义
  const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
  const rules = loadRules(rulesPath);
  const metaActionDefs = summarizeMetaActions(rules);

  // [M20 初始化] 创建 probe 会话
  probeSession = createSession(requirement);

  // [M20 初始化] 构建系统提示词
  const sessionState = getSessionSummary(probeSession);
  const systemPrompt = loadProbeTemplate({
    requirement: probeSession.requirement,
    sessionState,
    metaActionDefs
  });

  // [I16 通信] 调 LLM 第一轮
  const response = await chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: requirement }
  ], model, false, apiKey);

  // [M2 赋值] 记录 LLM 回复
  addMessage(probeSession, 'assistant', response);

  // [I13 渲染] 推送到面板
  probePanel.sendState(probeSession);
  probePanel.sendAssistantMessage(response);
}

/**
 * [F9 调用] 处理用户回复：记录 → 推进维度 → 调 LLM 或生成 BDD
 */
async function handleProbeUserMessage(userMessage) {
  if (!probeSession) return;

  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);

  // [M2 赋值] 记录用户回复 + 推进维度
  addMessage(probeSession, 'user', userMessage);
  advanceDimension(probeSession, userMessage);
  probePanel.sendState(probeSession);

  // [C6 条件] 检查是否应该生成 BDD
  if (isReadyForBDD(probeSession)) {
    await generateBDD(model, apiKey);
    return;
  }

  // 继续对话：调 LLM
  const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
  const rules = loadRules(rulesPath);
  const metaActionDefs = summarizeMetaActions(rules);
  const sessionState = getSessionSummary(probeSession);
  const systemPrompt = loadProbeTemplate({
    requirement: probeSession.requirement,
    sessionState,
    metaActionDefs
  });

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const msg of probeSession.history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  const response = await chat(messages, model, false, apiKey);
  addMessage(probeSession, 'assistant', response);

  probePanel.sendState(probeSession);
  probePanel.sendAssistantMessage(response);
}

/**
 * [F9 调用] 生成最终 BDD
 */
async function generateBDD(model, apiKey) {
  const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
  const rules = loadRules(rulesPath);
  const metaActionDefs = summarizeMetaActions(rules);

  const bddPrompt = loadProbeTemplate({
    requirement: probeSession.requirement,
    sessionState: getSessionSummary(probeSession),
    metaActionDefs
  });

  const bddMessages = [
    { role: 'system', content: bddPrompt },
    ...probeSession.history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: '请基于以上所有对话历史，生成完整的 BDD 需求规格文档。' }
  ];

  const bddContent = await chat(bddMessages, model, false, apiKey);

  // [I15 存储] 保存 BDD
  const timestamp = formatTimestamp(new Date());
  const bddPath = saveToBlueprints(`bdd-${timestamp}.md`, bddContent);

  // [I13 渲染] 推送到面板
  probePanel.sendBDDGenerated(bddPath, bddContent);
  probeSession = null;
  // 阶段推进
  updateStage('bdd_ready');
}

// ═══════════════════════════════════════════════
// 阶段二/三：blueprint → 语义蓝图（WebView 浏览面板）
// ═══════════════════════════════════════════════

/**
 * [F9 调用] 处理蓝图面板消息
 */
function handleBlueprintMessage(msg) {
  try {
    switch (msg.type) {
      case 'loadFileList':
        sendBlueprintFileList();
        break;
      case 'loadFile':
        sendBlueprintFileContent(msg.path);
        break;
      case 'generate':
        generateBlueprint();
        break;
    }
  } catch (err) {
    console.error('[意元] 蓝图浏览失败:', err);
    blueprintPanel.sendError(err.message);
  }
}

/**
 * [I15 存储] 发送蓝图文件列表
 */
function sendBlueprintFileList() {
  const dir = path.join(getWorkspaceRoot(), 'docs', 'blueprints');
  if (!fs.existsSync(dir)) {
    blueprintPanel.sendFileList([]);
    return;
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      return {
        name: f,
        path: filePath,
        type: f.startsWith('bdd-') ? 'bdd' : 'blueprint',
        mtime: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));

  blueprintPanel.sendFileList(files);
}

/**
 * [I15 存储] 发送蓝图文件内容
 */
function sendBlueprintFileContent(filePath) {
  if (!fs.existsSync(filePath)) {
    blueprintPanel.sendError(`文件不存在: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  blueprintPanel.sendFileContent(filePath, content);
}

/**
 * [F9 调用] 蓝图生成 — 读取最新 BDD → 调 LLM → 落盘
 */
async function generateBlueprint() {
  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);

  if (!apiKey) {
    blueprintPanel.sendError(`未配置 ${model} 的 API Key`);
    return;
  }

  // [I15 存储] 读取最新 BDD
  const bddContent = loadLatestBDD();
  if (!bddContent) {
    blueprintPanel.sendError('未找到 BDD 规格文件。请先运行"六维度探测需求"。');
    return;
  }

  // [M20 初始化] 加载元动作 + 模板（BDD → 文件架构 → 逐文件蓝图）
  const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
  const rules = loadRules(rulesPath);
  const metaActionDefs = summarizeMetaActions(rules);

  const systemPrompt = loadBlueprintTemplate({ bdd: bddContent, metaActionDefs });

  try {
    // [I16 通信] 调 LLM
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '请基于以上 BDD 规格，输出完整的文件架构清单和逐文件语义蓝图。' }
    ], model, false, apiKey);

    // [I15 存储] 落盘
    const timestamp = formatTimestamp(new Date());
    const blueprintPath = saveToBlueprints(`architecture-${timestamp}.md`, response);

    // [I13 渲染] 刷新列表 + 展示新蓝图
    sendBlueprintFileList();
    blueprintPanel.sendFileContent(blueprintPath, response);

    vscode.window.showInformationMessage('✅ 文件架构与语义蓝图已生成');
    updateStage('blueprint');
  } catch (err) {
    console.error('[意元] 蓝图生成失败:', err);
    blueprintPanel.sendError(`蓝图生成失败: ${err.message}`);
  }
}

/**
 * [F9 调用] 测试生成 — 读取蓝图 → 调 LLM 生成测试 → Red 验证
 */
async function runGenTest() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('请先打开 JS/TS 源文件');
    return;
  }

  const sourcePath = editor.document.fileName;
  const sourceName = path.basename(sourcePath);
  const lang = editor.document.languageId;
  if (lang !== 'javascript' && lang !== 'typescript' &&
      lang !== 'javascriptreact' && lang !== 'typescriptreact') {
    vscode.window.showWarningMessage('仅支持 JS/TS 文件');
    return;
  }

  // [M3 内存读取] 查找对应的蓝图
  const bp = findBlueprintForFile(sourcePath);
  if (!bp) {
    vscode.window.showWarningMessage('未找到对应蓝图。请先生成蓝图。');
    return;
  }

  // [M5 转换] 提取该文件的蓝图片段
  const bpLines = bp.content.split('\n');
  let blueprintSection = '';
  let inTarget = false;
  for (const line of bpLines) {
    if (line.includes('# 模块：') && line.includes(sourceName)) { inTarget = true; continue; }
    if (line.startsWith('# 模块：') && inTarget) break;
    if (inTarget) blueprintSection += line + '\n';
  }

  if (!blueprintSection.trim()) {
    vscode.window.showWarningMessage('蓝图中未找到此文件的元动作定义');
    return;
  }

  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);
  if (!apiKey) { vscode.window.showErrorMessage(`未配置 ${model} 的 API Key`); return; }

  // [M20 初始化] 加载元动作 + 模板
  const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
  const rules = loadRules(rulesPath);
  const metaActionDefs = summarizeMetaActions(rules);

  vscode.window.showInformationMessage('意元：正在生成测试...');

  try {
    const systemPrompt = loadTestTemplate({
      blueprint: blueprintSection,
      metaActionDefs,
      testFramework: 'jest',
      sourceFile: sourcePath
    });

    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `为 ${sourceName} 生成测试代码` }
    ], model, false, apiKey);

    // [M5 转换] 提取代码块
    const codeMatch = response.match(/\x60\x60\x60(?:javascript|js)?\n([\s\S]*?)\n\x60\x60\x60/);
    const testCode = codeMatch ? codeMatch[1] : response;

    // [I15 存储] 保存测试文件
    const srcDir = path.dirname(sourcePath);
    const testDir = path.join(getWorkspaceRoot(), '__tests__');
    ensureDir(testDir);
    const testFileName = sourceName.replace(/\.(js|ts|jsx|tsx)$/, '.test.$1');
    const testPath = path.join(testDir, testFileName);
    fs.writeFileSync(testPath, testCode, 'utf-8');

    // [I13 渲染] 打开测试文件
    const testDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(testPath));
    await vscode.window.showTextDocument(testDoc, vscode.ViewColumn.Beside);

    vscode.window.showInformationMessage(
      '✅ 测试文件已生成。自动运行测试...'
    );

    // 管线：自动跑测试 → RED → 触发 genCode
    await pipeAfterGenTest(testPath, sourcePath, bp, metaActionDefs);
  } catch (err) {
    console.error('[意元] 测试生成失败:', err);
    vscode.window.showErrorMessage(`测试生成失败: ${err.message}`);
  }
}

/**
 * [F9 调用] 代码生成 — 读取蓝图 → 调 LLM 生成源代码 → 保存
 */
async function runGenCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('请先打开 JS/TS 源文件'); return; }

  const sourcePath = editor.document.fileName;
  const sourceName = path.basename(sourcePath);
  const lang = editor.document.languageId;
  if (lang !== 'javascript' && lang !== 'typescript' &&
      lang !== 'javascriptreact' && lang !== 'typescriptreact') {
    vscode.window.showWarningMessage('仅支持 JS/TS 文件'); return;
  }

  // [M3 内存读取] 查找蓝图
  const bp = findBlueprintForFile(sourcePath);
  if (!bp) { vscode.window.showWarningMessage('未找到对应蓝图。请先生成蓝图。'); return; }

  // [M5 转换] 提取蓝图片段
  const bpLines = bp.content.split('\n');
  let blueprintSection = '';
  let inTarget = false;
  for (const line of bpLines) {
    if (line.includes('# 模块：') && line.includes(sourceName)) { inTarget = true; continue; }
    if (line.startsWith('# 模块：') && inTarget) break;
    if (inTarget) blueprintSection += line + '\n';
  }
  if (!blueprintSection.trim()) { vscode.window.showWarningMessage('蓝图中未找到此文件'); return; }

  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);
  if (!apiKey) { vscode.window.showErrorMessage(`未配置 API Key`); return; }

  const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
  const rules = loadRules(rulesPath);
  const metaActionDefs = summarizeMetaActions(rules);

  vscode.window.showInformationMessage('意元：正在生成代码...');

  try {
    const systemPrompt = loadCodeTemplate({ blueprint: blueprintSection, metaActionDefs, sourceFile: sourcePath });
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `为 ${sourceName} 生成完整源代码` }
    ], model, false, apiKey);

    // [M5 转换] 提取代码（去掉可能的 markdown 代码块包裹）
    const codeMatch = response.match(/\x60\x60\x60(?:javascript|js)?\n([\s\S]*?)\n\x60\x60\x60/);
    const code = codeMatch ? codeMatch[1] : response;

    // [I15 存储] 写入源文件
    fs.writeFileSync(sourcePath, code, 'utf-8');

    // [I13 渲染] 打开更新后的文件
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      '✅ 代码已生成。自动运行测试...'
    );

    // 管线：自动跑测试 → GREEN → 合规
    await pipeAfterGenCode(sourcePath, bp, metaActionDefs);
  } catch (err) {
    console.error('[意元] 代码生成失败:', err);
    vscode.window.showErrorMessage(`代码生成失败: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════
// MADD 管线：测试 → RED → 代码 → GREEN → 合规
// ═══════════════════════════════════════════════

let _currentSourcePath = null;
let _currentTestPath = null;
let _autoFixRounds = {};
let _lastError = {};
let _pauseContext = null;  // 决策暂停断点
let _decisionHistory = [];

function findTestFile(sourcePath) {
  const sourceName = path.basename(sourcePath);
  const testName = sourceName.replace(/\.(js|ts|jsx|tsx)$/, '.test.$1');
  const testDir = path.join(getWorkspaceRoot(), '__tests__');
  const testPath = path.join(testDir, testName);
  if (fs.existsSync(testPath)) return testPath;

  // 也检查同目录
  const sidePath = path.join(path.dirname(sourcePath), testName);
  if (fs.existsSync(sidePath)) return sidePath;
  return null;
}

function runTest(testPath) {
  return new Promise((resolve) => {
    const wsRoot = getWorkspaceRoot();
    const relPath = path.relative(wsRoot, testPath);
    exec(`npx jest "${relPath}" --no-coverage 2>&1`, { cwd: wsRoot, timeout: 60000 }, (err, stdout) => {
      resolve({ exitCode: err ? err.code || 1 : 0, output: stdout || '' });
    });
  });
}

function analyzeTestResult(result) {
  const out = result.output;
  if (out.includes('Tests:') && /\b0\s+failed\b/.test(out)) {
    return { status: 'green' };
  }
  if (out.includes('Cannot find module')) {
    return { status: 'red', reason: 'module_not_found' };
  }
  const failMatch = out.match(/(\d+)\s+failed/);
  const failCount = failMatch ? parseInt(failMatch[1]) : 0;
  return { status: 'fail', failCount, errors: out };
}

/**
 * 管线入口：生成测试后自动跑
 */
async function pipeAfterGenTest(testPath, sourcePath, bp, metaActionDefs) {
  _currentSourcePath = sourcePath;
  _currentTestPath = testPath;
  _autoFixRounds = {};

  const result = await runTest(testPath);
  const analysis = analyzeTestResult(result);

  if (analysis.status === 'red' && analysis.reason === 'module_not_found') {
    vscode.window.showInformationMessage('✅ 测试 RED 合理（模块未实现）→ 自动生成代码...');
    updateStage('test_ready');
    await pipeToGenCode(sourcePath, bp, metaActionDefs);
    return;
  }

  if (analysis.status === 'green') {
    vscode.window.showWarningMessage('⚠️ 测试全部 GREEN——源代码可能已存在。请检查。');
    return;
  }

  // 测试有错误 → 自动修正
  vscode.window.showWarningMessage(`测试 RED 但非预期原因 → 自动修正测试（最多 3 轮）`);
  await autoFixLoop('test', testPath, sourcePath, bp, metaActionDefs, result, 3);
}

/**
 * 管线：生成代码后自动跑测试 → GREEN → 合规
 */
async function pipeAfterGenCode(sourcePath, bp, metaActionDefs) {
  const testPath = findTestFile(sourcePath);
  if (!testPath) {
    vscode.window.showWarningMessage('未找到测试文件，请先生成测试');
    return;
  }
  _currentSourcePath = sourcePath;
  _currentTestPath = testPath;
  _autoFixRounds = {};

  const result = await runTest(testPath);
  const analysis = analyzeTestResult(result);

  if (analysis.status === 'green') {
    vscode.window.showInformationMessage('✅ 测试全部 GREEN → 自动合规审查...');
    await pipeToCompliance(sourcePath, bp, metaActionDefs);
    return;
  }

  vscode.window.showWarningMessage(`测试 FAIL → 自动修正代码（最多 5 轮）`);
  await autoFixLoop('code', sourcePath, sourcePath, bp, metaActionDefs, result, 5);
}

/**
 * 管线：genCode（从 RED 自动触发）
 */
async function pipeToGenCode(sourcePath, bp, metaActionDefs) {
  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);
  if (!apiKey) { vscode.window.showErrorMessage('未配置 API Key'); return; }

  const sourceName = path.basename(sourcePath);
  const bpLines = bp.content.split('\n');
  let bpSection = '';
  let inTarget = false;
  for (const l of bpLines) {
    if (l.includes('# 模块：') && l.includes(sourceName)) { inTarget = true; continue; }
    if (l.startsWith('# 模块：') && inTarget) break;
    if (inTarget) bpSection += l + '\n';
  }

  vscode.window.showInformationMessage('意元：自动生成代码...');
  try {
    const systemPrompt = loadCodeTemplate({ blueprint: bpSection, metaActionDefs, sourceFile: sourcePath });
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `为 ${sourceName} 生成完整源代码` }
    ], model, false, apiKey);
    const m = response.match(/\x60\x60\x60(?:javascript|js)?\n([\s\S]*?)\n\x60\x60\x60/);
    const code = m ? m[1] : response;
    fs.writeFileSync(sourcePath, code, 'utf-8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
    await vscode.window.showTextDocument(doc);

    await pipeAfterGenCode(sourcePath, bp, metaActionDefs);
  } catch (err) {
    console.error('[意元] 自动代码生成失败:', err);
    vscode.window.showErrorMessage(`自动代码生成失败: ${err.message}`);
  }
}

/**
 * 管线：合规审查（从 GREEN 自动触发）
 */
async function pipeToCompliance(sourcePath, bp, metaActionDefs) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
  const code = doc.getText();
  const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
  const rules = loadRules(rulesPath);
  const config = vscode.workspace.getConfiguration('yiyuan');
  const annotations = annotate(code, doc.languageId);
  const strictness = config.get('reviewStrictness', 'strict');
  const violations = check(annotations, rules, strictness);

  if (violations.length === 0) {
    vscode.window.showInformationMessage('✅ 合规审查通过！');
    updateStage('done');
    return;
  }

  vscode.window.showWarningMessage(`合规审查发现 ${violations.length} 项违规 → 自动修正（最多 3 轮）`);
  _autoFixRounds = {};
  await autoFixComplianceLoop(sourcePath, bp, metaActionDefs, violations, 3);
}

/**
 * 自动修正循环（测试/代码）
 */
async function autoFixLoop(type, targetPath, sourcePath, bp, metaActionDefs, testResult, maxRounds) {
  const roundKey = `fix_${type}`;
  _autoFixRounds[roundKey] = (_autoFixRounds[roundKey] || 0) + 1;

  if (_autoFixRounds[roundKey] > maxRounds) {
    vscode.window.showWarningMessage(`自动修正已达 ${maxRounds} 轮上限`);
    return;
  }

  const errors = testResult.output;
  if (_lastError[roundKey] === errors) {
    // 同一错误连续 2 轮
    triggerDecisionPause(type, targetPath, _autoFixRounds[roundKey], maxRounds, errors);
    return;
  }
  _lastError[roundKey] = errors;

  vscode.window.showInformationMessage(`自动修正 ${type}（第 ${_autoFixRounds[roundKey]}/${maxRounds} 轮）...`);

  const sourceName = path.basename(sourcePath);
  const bpSection = extractBlueprintSection(bp, sourceName);

  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);
  if (!apiKey) return;

  try {
    const fixTargetPath = type === 'test' ? targetPath : sourcePath;
    const currentCode = fs.readFileSync(fixTargetPath, 'utf-8');
    const prompt = type === 'test'
      ? `你是测试修正器。当前测试代码有错误，请修正。\n\n蓝图：\n${bpSection}\n\n当前测试代码：\n${currentCode}\n\n测试错误：\n${errors}\n\n请输出修正后的完整测试代码。`
      : `你是代码修正器。源代码未通过测试，请修正。\n\n蓝图：\n${bpSection}\n\n当前源代码：\n${currentCode}\n\n测试错误：\n${errors}\n\n请输出修正后的完整源代码。`;

    const response = await chat([
      { role: 'system', content: prompt },
      { role: 'user', content: `修正后输出完整代码` }
    ], model, false, apiKey);

    const m = response.match(/\x60\x60\x60(?:javascript|js)?\n([\s\S]*?)\n\x60\x60\x60/);
    const fixed = m ? m[1] : response;
    fs.writeFileSync(targetPath, fixed, 'utf-8');

    const result2 = await runTest(_currentTestPath);
    const analysis2 = analyzeTestResult(result2);

    if (analysis2.status === 'green' && type === 'code') {
      vscode.window.showInformationMessage('✅ 修正成功，测试 GREEN → 自动合规审查...');
      await pipeToCompliance(sourcePath, bp, metaActionDefs);
      return;
    }
    if (analysis2.status === 'green' && type === 'test') {
      vscode.window.showInformationMessage('✅ 测试修正成功');
      return;
    }

    // 继续修正
    await autoFixLoop(type, targetPath, sourcePath, bp, metaActionDefs, result2, maxRounds);
  } catch (err) {
    console.error(`[意元] 自动修正失败:`, err);
  }
}

/**
 * 合规自动修正循环
 */
async function autoFixComplianceLoop(sourcePath, bp, metaActionDefs, violations, maxRounds) {
  const roundKey = 'fix_compliance';
  _autoFixRounds[roundKey] = (_autoFixRounds[roundKey] || 0) + 1;

  if (_autoFixRounds[roundKey] > maxRounds) return;

  const violationSnapshot = JSON.stringify(violations.map(v => ({ line: v.line, message: v.message, metaActionId: v.metaActionId })));
  if (_lastError[roundKey] === violationSnapshot) {
    triggerDecisionPause('compliance', sourcePath, _autoFixRounds[roundKey], maxRounds, JSON.stringify(violations, null, 2));
    return;
  }
  _lastError[roundKey] = violationSnapshot;

  const sourceName = path.basename(sourcePath);
  const bpSection = extractBlueprintSection(bp, sourceName);
  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);
  if (!apiKey) return;

  try {
    const currentCode = fs.readFileSync(sourcePath, 'utf-8');
    const prompt = `你是合规修正器。代码存在元动作违规，请修正。\n\n蓝图：\n${bpSection}\n\n当前代码：\n${currentCode}\n\n违规列表：\n${JSON.stringify(violations, null, 2)}\n\n修复规则：I15存储类必须try-catch、I16通信必须timeout+retry+catch、R17绑定必须配对R18清理、I14用户输入必须validate+sanitize。\n\n请输出修正后的完整代码。`;

    const response = await chat([{ role: 'system', content: prompt }, { role: 'user', content: '修正后输出完整代码' }], model, false, apiKey);
    const m = response.match(/\x60\x60\x60(?:javascript|js)?\n([\s\S]*?)\n\x60\x60\x60/);
    const fixed = m ? m[1] : response;
    fs.writeFileSync(sourcePath, fixed, 'utf-8');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
    const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
    const rules = loadRules(rulesPath);
    const annotations = annotate(fixed, doc.languageId);
    const newViolations = check(annotations, rules, config.get('reviewStrictness', 'strict'));

    if (newViolations.length === 0) {
      vscode.window.showInformationMessage('✅ 合规修正成功！');
      updateStage('done');
      generateExperienceCard(sourcePath, violations, bpSection);
      return;
    }

    await autoFixComplianceLoop(sourcePath, bp, metaActionDefs, newViolations, maxRounds);
  } catch (err) {
    console.error('[意元] 合规修正失败:', err);
  }
}

function extractBlueprintSection(bp, sourceName) {
  const lines = bp.content.split('\n');
  let section = '';
  let inT = false;
  for (const l of lines) {
    if (l.includes('# 模块：') && l.includes(sourceName)) { inT = true; continue; }
    if (l.startsWith('# 模块：') && inT) break;
    if (inT) section += l + '\n';
  }
  return section;
}

function detectStage() {
  const wsRoot = getWorkspaceRoot();
  const bpDir = path.join(wsRoot, 'docs', 'blueprints');
  const hasBDD = fs.existsSync(bpDir) && fs.readdirSync(bpDir).some(f => f.startsWith('bdd-'));
  const hasArch = fs.existsSync(bpDir) && fs.readdirSync(bpDir).some(f => f.startsWith('architecture-'));
  const testDir = path.join(wsRoot, '__tests__');
  const hasTests = fs.existsSync(testDir) && fs.readdirSync(testDir).length > 0;

  if (hasArch && hasTests) return 'test_ready';
  if (hasArch) return 'blueprint';
  if (hasBDD) return 'bdd_ready';
  return 'init';
}

function updateStage(stageId) {
  const stage = MADD_STAGES.find(s => s.id === (stageId || detectStage())) || MADD_STAGES[0];
  statusBarItem.text = `${stage.icon} MADD: ${stage.label} → 下一步: ${stage.nextLabel}`;
  statusBarItem.command = stage.nextCmd;
  if (stage.id === 'done') {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
  } else {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
  // [I13 渲染] 每次阶段变更，立即更新 AI_STATE.md 确保 AI 读到最新指令
  updateAIState(stage);
}

async function triggerDecisionPause(type, sourcePath, round, max, errors) {
  _pauseContext = { type, sourcePath, round, max, errors, testPath: _currentTestPath };
  _decisionHistory = [];
  const stageLabel = type === 'test' ? '阶段三·测试修正' : type === 'code' ? '阶段四·代码修正' : '阶段四·合规修正';
  decisionPanel.showDecision({
    file: sourcePath,
    stage: `${stageLabel}（第 ${round}/${max} 轮）`,
    reason: '同一问题连续 2 轮自动修正无变化',
    description: errors.slice(0, 1000)
  });

  // [M20 初始化] 加载上下文 → LLM 诊断问题
  const bp = findBlueprintForFile(sourcePath);
  const sourceName = path.basename(sourcePath);
  const bpSection = bp ? extractBlueprintSection(bp, sourceName) : '(无蓝图)';
  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);
  if (!apiKey) return;

  const systemPrompt = `你是问题诊断助手。自动修正引擎遇到了无法解决的问题，需要你通过多轮对话来理解用户的期望，然后生成正确的修正方案。

**上下文：**
- 文件：${sourcePath}
- 阶段：${stageLabel}（第 ${round}/${max} 轮）
- 问题类型：${type === 'compliance' ? '合规违规' : type === 'test' ? '测试错误' : '代码/测试不匹配'}

**蓝图（预期行为）：**
${bpSection}

**当前报错/违规：**
${errors.slice(0, 2000)}

**你的任务：**
1. 先向用户简要说明你看到的问题
2. 通过提问逐步确认用户的期望（每次只问一个点）
3. 直到你完全理解用户想要的修正方案
4. 说「我理解了」然后输出修正后的完整代码（用 \x60\x60\x60 包裹）

**禁止：**
- 不要一次问多个问题
- 不要在没理解清楚之前就输出代码
- 不要用选项列表，用自然语言提问`;

  try {
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '请开始诊断问题。' }
    ], model, false, apiKey);

    _decisionHistory.push({ role: 'assistant', content: response });
    decisionPanel.sendAssistantMessage(response);
  } catch (err) {
    console.error('[意元] 决策对话启动失败:', err);
  }
}

async function handleDecisionMessage(msg) {
  if (!_pauseContext) return;

  if (msg.type === 'userMessage') {
    // [M2 赋值] 多轮对话：用户回复 → LLM 追问或输出修正
    const config = vscode.workspace.getConfiguration('yiyuan');
    const model = config.get('defaultModel', 'deepseek-chat');
    const apiKey = getApiKey(config, model);
    if (!apiKey) return;

    _decisionHistory.push({ role: 'user', content: msg.content });

    // 构建已有的系统提示词 + 完整对话
    const ctx = _pauseContext;
    const bp = findBlueprintForFile(ctx.sourcePath);
    const sourceName = path.basename(ctx.sourcePath);
    const bpSection = bp ? extractBlueprintSection(bp, sourceName) : '(无蓝图)';
    const stageLabel = ctx.type === 'test' ? '阶段三·测试修正' : ctx.type === 'code' ? '阶段四·代码修正' : '阶段四·合规修正';

    const systemPrompt = `你是问题诊断助手。通过多轮对话理解用户期望，然后生成修正方案。当你完全理解了，输出修正后的完整代码（用 \x60\x60\x60 包裹）。如果还没理解，继续追问。

上下文：文件=${ctx.sourcePath} | 阶段=${stageLabel} | 蓝图=${bpSection.slice(0, 1000)} | 原始错误=${ctx.errors.slice(0, 1000)}`;

    try {
      const messages = [{ role: 'system', content: systemPrompt }, ..._decisionHistory];
      const response = await chat(messages, model, false, apiKey);
      _decisionHistory.push({ role: 'assistant', content: response });

      // [C6 条件] 检查 LLM 是否输出了修正代码
      const codeMatch = response.match(/\x60\x60\x60(?:javascript|js)?\n([\s\S]*?)\n\x60\x60\x60/);
      if (codeMatch) {
        // LLM 理解了问题，给出了修正代码
        const fixCode = codeMatch[1];
        const fixTargetPath = ctx.type === 'test' ? (ctx.testPath || ctx.sourcePath) : ctx.sourcePath;
        fs.writeFileSync(fixTargetPath, fixCode, 'utf-8');
        decisionPanel.sendAssistantMessage(response);

        // 清空暂停状态，继续管线
        _pauseContext = null;
        _decisionHistory = [];
        _lastError = {};
        _autoFixRounds = {};

        // 跑测试验证 + 继续管线
        const bp2 = findBlueprintForFile(ctx.sourcePath);
        if (!bp2) return;
        const rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
        const rules = loadRules(rulesPath);
        const metaActionDefs = summarizeMetaActions(rules);
        const result = await runTest(ctx.testPath || findTestFile(ctx.sourcePath));
        const analysis = analyzeTestResult(result);
        if (analysis.status === 'green' && ctx.type !== 'test') {
          await pipeToCompliance(ctx.sourcePath, bp2, metaActionDefs);
        } else if (analysis.status === 'green') {
          vscode.window.showInformationMessage('✅ 决策后修正成功');
        } else {
          await autoFixLoop(ctx.type, fixTargetPath, ctx.sourcePath, bp2, metaActionDefs, result, ctx.max);
        }
      } else {
        // LLM 还在追问 → 继续对话
        decisionPanel.sendAssistantMessage(response);
      }
    } catch (err) {
      console.error('[意元] 决策对话失败:', err);
    }
  }
}

async function generateExperienceCard(sourcePath, violations, bpSection) {
  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);
  if (!apiKey) return;

  try {
    const systemPrompt = loadExpCardTemplate({
      sourceFile: sourcePath,
      fixedViolations: JSON.stringify(violations),
      blueprintSection: bpSection
    });
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '生成经验卡片' }
    ], model, false, apiKey);

    const date = formatTimestamp(new Date());
    const cardName = `runtime-${date}.md`;
    const cardDir = path.join(getWorkspaceRoot(), 'docs', 'experience', '01-runtime');
    ensureDir(cardDir);
    fs.writeFileSync(path.join(cardDir, cardName), response, 'utf-8');
    vscode.window.showInformationMessage('✅ 经验卡片已生成: ' + cardName);
  } catch (err) {
    console.error('[意元] 经验卡片生成失败:', err);
  }
}

async function runEnvCheck() {
  const wsRoot = getWorkspaceRoot();
  const pkgPath = path.join(wsRoot, 'package.json');
  let pkg = {};
  if (fs.existsSync(pkgPath)) { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); }

  const results = [];

  // 检查 jest
  const hasJest = (pkg.devDependencies && pkg.devDependencies.jest) || (pkg.dependencies && pkg.dependencies.jest);
  if (!hasJest) {
    results.push('安装 jest...');
    await new Promise((resolve) => {
      exec('npm install --save-dev jest', { cwd: wsRoot }, () => resolve());
    });
    results.push('✅ jest 已安装');
  } else { results.push('✅ jest 已存在'); }

  // 检查 test script
  if (!pkg.scripts || !pkg.scripts.test) {
    if (!pkg.scripts) pkg.scripts = {};
    pkg.scripts.test = 'jest';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
    results.push('✅ test script 已添加');
  } else { results.push('✅ test script 已存在'); }

  // 检查测试目录
  const testDir = path.join(wsRoot, '__tests__');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
    results.push('✅ __tests__/ 目录已创建');
  } else { results.push('✅ __tests__/ 目录已存在'); }

  vscode.window.showInformationMessage(results.join(' | '));
}

async function runIntegrate() {
  const wsRoot = getWorkspaceRoot();
  const blueprintsDir = path.join(wsRoot, 'docs', 'blueprints');
  if (!fs.existsSync(blueprintsDir)) { vscode.window.showWarningMessage('无蓝图目录'); return; }

  // 读取最新 BDD
  const bddFiles = fs.readdirSync(blueprintsDir).filter(f => f.startsWith('bdd-')).sort().reverse();
  const archFiles = fs.readdirSync(blueprintsDir).filter(f => f.startsWith('architecture-')).sort().reverse();
  if (bddFiles.length === 0 || archFiles.length === 0) { vscode.window.showWarningMessage('缺少 BDD 或蓝图文件'); return; }

  const bdd = fs.readFileSync(path.join(blueprintsDir, bddFiles[0]), 'utf-8');
  const arch = fs.readFileSync(path.join(blueprintsDir, archFiles[0]), 'utf-8');

  const config = vscode.workspace.getConfiguration('yiyuan');
  const model = config.get('defaultModel', 'deepseek-chat');
  const apiKey = getApiKey(config, model);
  if (!apiKey) return;

  vscode.window.showInformationMessage('意元：正在集成验证...');
  try {
    const systemPrompt = loadIntegrateTemplate({ bdd, fileManifest: arch, sourceFiles: '(略，见蓝图)' });
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '执行集成验证' }
    ], model, false, apiKey);

    const timestamp = formatTimestamp(new Date());
    const reportPath = saveToBlueprints(`integrate-${timestamp}.md`, response);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(reportPath));
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('✅ 集成验证报告已生成');
  } catch (err) {
    console.error('[意元] 集成验证失败:', err);
    vscode.window.showErrorMessage(`集成验证失败: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════
// 编辑器面板
// ═══════════════════════════════════════════════

/**
 * [F9 调用] 打开编辑器面板
 */
function runEditorPanel() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('请先打开 JS/TS 文件');
    return;
  }
  const lang = editor.document.languageId;
  if (lang !== 'javascript' && lang !== 'typescript' &&
      lang !== 'javascriptreact' && lang !== 'typescriptreact') {
    vscode.window.showWarningMessage('仅支持 JS/TS 文件');
    return;
  }
  editorPanel.open();
  editorPanel.sendInit(editor.document.getText(), lang);
}

/**
 * [F9 调用] 处理编辑器面板消息
 */
function handleEditorMessage(msg) {
  try {
    switch (msg.type) {
      case 'ready':
        // Monaco 已加载 → 重新发送当前代码
        runEditorPanel();
        break;
      case 'contentChanged':
        // 用户编辑 → 实时标注
        const annotations = annotate(msg.content, 'javascript');
        editorPanel.sendAnnotations(annotations);
        break;
    }
  } catch (err) {
    console.error('[意元] 编辑器异常:', err);
    editorPanel.sendError(err.message);
  }
}

// ═══════════════════════════════════════════════
// 合规审查面板
// ═══════════════════════════════════════════════

/**
 * [F9 调用] 打开合规面板
 */
function runCompliancePanel() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('请先打开 JS/TS 文件');
    return;
  }
  compliancePanel.open();
  pushComplianceToPanel(editor.document);
}

/**
 * [F9 调用] 处理合规面板消息
 */
function handleComplianceMessage(msg) {
  switch (msg.type) {
    case 'gotoLine':
      // [I13 渲染] 跳转到指定行
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const line = Math.max(0, msg.line - 1);
        const range = new vscode.Range(line, 0, line, 0);
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      }
      break;
  }
}

/**
 * [M3 内存读取] 查找当前文件对应的蓝图
 */
function findBlueprintForFile(sourceFile) {
  const dir = path.join(getWorkspaceRoot(), 'docs', 'blueprints');
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f.startsWith('architecture-'));
  const sourceName = path.basename(sourceFile);

  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf-8');
    if (content.includes(sourceName)) {
      return { path: path.join(dir, f), content };
    }
  }
  return null;
}

/**
 * [M5 转换] 从蓝图中提取指定文件的预期元动作序列
 */
function parseBlueprintMetaActions(blueprintContent, sourceFile) {
  const sourceName = path.basename(sourceFile);
  const lines = blueprintContent.split('\n');
  const actions = [];
  let inTarget = false;

  for (const line of lines) {
    if (line.includes('# 模块：') && line.includes(sourceName)) {
      inTarget = true; continue;
    }
    if (line.startsWith('# 模块：') && inTarget) {
      inTarget = false; break;
    }
    if (inTarget) {
      const m = line.match(/- \[(\w+)\s+[^\]]+\]/);
      if (m) actions.push(m[1]);
    }
  }
  return actions;
}

/**
 * [F9 调用] 运行合规审查并推送到面板
 */
function pushComplianceToPanel(document) {
  try {
    const code = document.getText();
    const language = document.languageId;

    const config = vscode.workspace.getConfiguration('yiyuan');
    let rulesPath = config.get('rulesPath', '');
    if (!rulesPath) {
      rulesPath = path.join(__dirname, 'src', 'engine', 'rules.json');
    }

    const rules = loadRules(rulesPath);
    const annotations = annotate(code, language);
    const strictness = config.get('reviewStrictness', 'strict');
    const violations = check(annotations, rules, strictness);

    const stats = {
      total: violations.length,
      error: violations.filter(v => v.severity === 'error').length,
      warning: violations.filter(v => v.severity === 'warning').length,
      info: violations.filter(v => v.severity === 'info').length
    };

    // [M3 内存读取] 蓝图对齐检查
    const bp = findBlueprintForFile(document.fileName);
    let alignment = null;
    if (bp) {
      const expected = parseBlueprintMetaActions(bp.content, document.fileName);
      const actual = [...new Set(annotations.map(a => a.metaActionId))];
      alignment = {
        blueprintPath: bp.path,
        expected,
        actual,
        missing: expected.filter(e => !actual.includes(e)),
        extra: actual.filter(a => !expected.includes(a))
      };
    }

    compliancePanel.sendReport(violations, document.fileName, stats, alignment);
  } catch (err) {
    console.error('[意元] 合规审查异常:', err);
    compliancePanel.sendError(err.message);
  }
}

// ═══════════════════════════════════════════════
// 文件管理辅助函数
// ═══════════════════════════════════════════════

/**
 * [I15 存储] 保存内容到 docs/blueprints/ 目录
 * @returns {string} 文件的绝对路径
 */
function saveToBlueprints(filename, content) {
  // [I15 存储]
  try {
    const dir = path.join(getWorkspaceRoot(), 'docs', 'blueprints');
    ensureDir(dir);
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[意元] 已保存: ${filePath}`);
    return filePath;
  } catch (err) {
    // [F12 捕获]
    console.error(`[意元] 保存蓝图文件失败: ${err.message}`);
    throw err; // [F11 抛出] 让调用方处理
  }
}

/**
 * [I15 存储] 加载最新的 BDD 规格文件
 * @returns {string|null} BDD 文件内容，如果不存在返回 null
 */
function loadLatestBDD() {
  const dir = path.join(getWorkspaceRoot(), 'docs', 'blueprints');
  if (!fs.existsSync(dir)) return null;

  // [M3 内存读取] 找到所有 BDD 文件
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('bdd-') && f.endsWith('.md'))
    .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime); // 最新的排前面

  if (files.length === 0) return null;

  const latest = files[0];
  console.log(`[意元] 加载 BDD: ${latest.name}`);
  return fs.readFileSync(latest.path, 'utf-8');
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

/**
 * [M20 初始化] 获取工作区根目录
 */
function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  // 回退到插件所在目录
  return __dirname;
}

/**
 * [I15 存储] 确保目录存在
 */
function ensureDir(dir) {
  // [I15 存储]
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    // [F12 捕获]
    console.error(`[意元] 创建目录失败 ${dir}: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════

/**
 * [M3 内存读取] 根据模型名称从 VS Code 配置读取对应的 API Key
 */
function getApiKey(config, model) {
  const keyMap = {
    'deepseek-chat': 'deepseekApiKey',
    'qwen-turbo': 'qwenApiKey',
    'glm-4': 'glmApiKey'
  };
  const configKey = keyMap[model];
  if (!configKey) return '';
  return config.get(configKey, '');
}

/**
 * [M5 转换] 从规则中提取元动作摘要（供提示词模板使用）
 */
function summarizeMetaActions(rules) {
  if (!rules || !rules.metaActions) {
    return '（元动作定义加载失败）';
  }
  let summary = '';
  for (const cat of rules.metaActions) {
    summary += `\n### ${cat.name}\n`;
    for (const action of cat.actions) {
      summary += `- [${action.id}] ${action.name}：${action.definition}\n`;
    }
  }
  return summary;
}

/**
 * [R18 清理] deactivate — 插件停用
 */
function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
  }
  // [R18 清理] WebView 面板
  if (probePanel) probePanel.dispose();
  if (blueprintPanel) blueprintPanel.dispose();
  if (editorPanel) editorPanel.dispose();
  if (compliancePanel) compliancePanel.dispose();
  if (decisionPanel) decisionPanel.dispose();
  clearTimeout(complianceDebounceTimer);

  // [I15 存储] 自动更新 AI_STATE.md
  updateAIState();
}

function updateAIState(stage) {
  try {
    const wsRoot = getWorkspaceRoot();
    const statePath = path.join(wsRoot, 'AI_STATE.md');
    const now = new Date().toISOString();
    const s = stage || MADD_STAGES.find(s => s.id === detectStage()) || MADD_STAGES[0];

    // ═══════════════════════════════════════════
    // 【最高优先级】NEXT STEP — AI 读取此文件时第一眼看到
    // ═══════════════════════════════════════════
    let content = `# ⚠️ MADD 当前阶段：${s.icon} ${s.label}\n\n`;
    content += `> **下一步：执行「${s.nextLabel}」命令（\`${s.nextCmd}\`）**\n`;
    content += `> 体系：代码语义元动作体系 v1.9 | 更新：${now}\n`;
    content += `> \n`;
    content += `> ⛔ **禁止跳步。** 不要直接写代码、不要 submit_plan。\n`;
    content += `> ⛔ **先执行下一步命令。** 打开命令面板 (Ctrl+Shift+P) → 输入「${s.nextLabel}」。\n`;
    content += `> ⛔ **如果没有 BDD → 必须先探测需求。** 不要假设用户需求。\n\n`;
    content += `---\n\n`;

    const files = [];
    function scanDir(dir, prefix) {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir).forEach(f => {
        const fp = path.join(dir, f);
        if (fs.statSync(fp).isDirectory()) { scanDir(fp, prefix + f + '/'); }
        else { files.push({ name: prefix + f, path: fp }); }
      });
    }
    scanDir(path.join(wsRoot, 'src'), 'src/');
    scanDir(path.join(wsRoot, 'templates'), 'templates/');

    content += `## 文件清单\n\n`;
    content += `| 文件 | 大小 |\n|------|------|\n`;
    content += `| extension.js | ${fs.existsSync(path.join(wsRoot, 'extension.js')) ? fs.statSync(path.join(wsRoot, 'extension.js')).size : 0} |\n`;
    content += `| package.json | ${fs.statSync(path.join(wsRoot, 'package.json')).size} |\n`;
    files.forEach(f => { content += `| ${f.name} | ${fs.statSync(f.path).size} |\n`; });
    content += `\n## 当前进度\n\n`;
    content += `- ✅ 核心引擎（20种元动作 + 强制配对）\n- ✅ LLM 适配器\n- ✅ Probe 六维度探测 + BDD 生成\n- ✅ 蓝图生成（BDD → 文件架构 → 逐文件蓝图）\n- ✅ 测试生成 + 代码生成\n- ✅ MADD 管线自动化（RED→GREEN→合规→自动修正→决策暂停）\n- ✅ 环境就绪检查 + 集成验证 + 经验卡片\n`;
    content += `\n## MADD 阶段流转\n\n`;
    MADD_STAGES.forEach(st => {
      const mark = st.id === s.id ? '← 当前' : '';
      content += `- ${st.icon} ${st.label} → ${st.nextLabel} ${mark}\n`;
    });

    fs.writeFileSync(statePath, content, 'utf-8');
    console.log('[意元] AI_STATE.md 已更新 →', s.label);
  } catch (err) {
    console.error('[意元] AI_STATE.md 更新失败:', err);
  }
}

// [F10 返回] 导出给 VS Code
module.exports = { activate, deactivate };
