【上下文包 — 对话一 → 对话二交接】

1. 功能目标：意元 VS Code 插件 v0.1 — 对话二负责四个 WebView 面板（纯视觉层）。
   对话一已完成全部核心逻辑（合规引擎、LLM适配器、提示词模板、Probe多轮对话引擎、集成连线）。
   对话二只做 WebView UI，不碰业务逻辑。

2. 当前项目状态：所有纯函数模块已通过 10 场景验证（0 误报），Probe 多轮状态机链路正确。
   AI_STATE.md 在项目根目录，包含完整文件地图和接口契约。

3. 相关经验：seed-001/002/003（三张种子经验卡片在 docs/experience/00-seed/）

4. 已生成代码：
   - package.json（插件清单，已含 contributes.commands + configuration）
   - extension.js（入口，已注册三个命令：yiyuan.compliance / yiyuan.probe / yiyuan.blueprint）
   - src/engine/*（合规引擎完整实现）
   - src/diagnostics.js（违规→Diagnostic 转换）
   - src/llm/*（三个 LLM 适配器）
   - src/templates.js（模板加载+变量替换）
   - src/probe/*（多轮对话引擎：session.js + engine.js + index.js）
   - templates/probe.md + templates/blueprint.md
   - docs/experience/00-seed/（3 张种子卡片）
   - AI_STATE.md

5. 当前任务：实现四个 WebView 面板。具体要求如下——

═══════════════════════════════════════
对话二任务说明
═══════════════════════════════════════

## 你要做的：四个 WebView 面板

### 面板一：Probe 对话面板
- 替换 extension.js 中 runProbe() 当前的 input box 循环
- WebView 内显示对话历史（用户消息 + LLM 回复），底部输入框
- 调用 probe 引擎的 API 管理会话状态
- 对话流程：用户输入需求 → LLM 逐维度提问 → 用户回答 → 循环 → 全部扫完 → LLM 生成 BDD

### 面板二：蓝图查看面板
- 读取 docs/blueprints/ 下的 BDD 和蓝图文件
- 左侧文件列表 + 右侧 Markdown 预览
- 支持 BDD → 蓝图的对照查看

### 面板三：代码编辑器面板
- 嵌入 Monaco Editor（VS Code 自带，通过 WebView 加载）
- 编辑代码时实时显示对应行的元动作标注（调用 annotate()）
- 标注以装饰器或 gutter icon 形式显示

### 面板四：合规面板
- 显示当前文件的合规审查结果
- 调用 check() + toDiagnostics() 获取违规列表
- 列表形式展示：违规行号、元动作、严重级别、修复建议
- 点击跳转到对应代码位置

## 你可以调用的函数（对话一暴露的接口）

```javascript
// ─── 合规引擎（require('./src/engine')） ───
annotate(code, language) → Annotation[]
  // Annotation: { line, column, metaActionId, metaActionName, code, riskLevel, flow }

check(annotations, rules, strictness) → Violation[]
  // Violation: { line, column, message, severity, metaActionId, rule, suggestion }

loadRules(configPath) → Rule[]

toDiagnostics(violations, document) → vscode.Diagnostic[]
  // require('./src/diagnostics')

// ─── LLM 适配器（require('./src/llm')） ───
chat(messages, model, stream, apiKey) → Promise<string>
  // messages: [{role, content}, ...]
  // model: 'deepseek-chat' | 'qwen-turbo' | 'glm-4'
  // apiKey 从 VS Code 配置读取：config.get('yiyuan.deepseekApiKey') 等

getAvailableModels() → string[]

// ─── 提示词模板（require('./src/templates')） ───
loadProbeTemplate({ requirement, sessionState, metaActionDefs }) → string
loadBlueprintTemplate({ scope, decomposition, bdd, metaActionDefs }) → string

// ─── Probe 会话管理（require('./src/probe')） ───
createSession(requirement) → Session
addMessage(session, role, content) → Session
advanceDimension(session, userMessage) → Session
isReadyForBDD(session) → boolean
getSessionSummary(session) → string
getNextPromptHint(session) → string
// Session 结构见 src/probe/session.js 的 createSession()
```

## 技术约束

- 语言：JavaScript（不是 TypeScript）
- WebView 通过 `vscode.window.createWebviewPanel()` 创建
- WebView 内容用 HTML + CSS + JS（可内联，不引入额外构建工具）
- 与 extension.js 通信用 `webview.postMessage()` / `webview.onDidReceiveMessage()`
- Monaco Editor 通过 WebView 加载 CDN 或 VS Code 内置资源
- 对话二不修改任何 src/ 下的业务逻辑文件，只新增 WebView 相关文件和修改 extension.js 的命令注册部分

## 新增文件建议

```
src/webview/
  probe-panel.js      # Probe 对话面板 WebView 实现
  blueprint-panel.js  # 蓝图查看面板 WebView 实现
  editor-panel.js     # 代码编辑器面板（Monaco）WebView 实现
  compliance-panel.js # 合规审查面板 WebView 实现
```

## 验证标准

1. 运行"意元：六维度探测需求" → 打开对话面板 → 多轮对话正常 → 生成 BDD
2. 运行"意元：生成语义蓝图" → 蓝图面板显示 BDD + 蓝图对照
3. 打开 JS/TS 文件 → 编辑器面板显示元动作标注
4. 保存文件 → 合规面板显示违规列表 → 点击跳转到代码

6. 体系版本：代码语义元动作体系 v1.9
