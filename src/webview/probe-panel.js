// [M1 声明] Probe 对话面板 — WebView 实现
// 代码语义元动作体系 v1.9
//
// 职责：管理 Probe 多轮对话的 WebView 面板，纯视觉层。
// 不调 LLM、不操作会话状态——只负责渲染和转发消息。
//
// 暴露给 extension.js 的接口：
//   new ProbePanel(extensionUri, onMessage)  — 构造函数
//   panel.open(requirement?)                — 打开/复用面板
//   panel.sendAssistantMessage(content)     — 推送 LLM 回复
//   panel.sendState(session)                — 推送会话状态（维度进度）
//   panel.sendBDDGenerated(path, content)   — 推送 BDD 生成结果
//   panel.sendError(message)                — 推送错误
//   panel.dispose()                         — 销毁面板

const vscode = require('vscode');

// ═══════════════════════════════════════════════
// 维度定义（与 session.js 同步）
// ═══════════════════════════════════════════════
const DIMENSION_NAMES = [
  { key: 'extract',      label: '信息提取' },
  { key: 'lifecycle',    label: '实体生命周期' },
  { key: 'roles',        label: '角色与权限' },
  { key: 'dataShape',    label: '数据形状' },
  { key: 'integration',  label: '外部集成面' },
  { key: 'nonFunctional',label: '非功能约束' },
  { key: 'assumptionReceipt', label: '假设回执' }
];

const DIM_ICONS = {
  pending:  '⬜',
  probing:  '⏳',
  done:     '✅'
};

// ═══════════════════════════════════════════════
// ProbePanel 类
// ═══════════════════════════════════════════════

class ProbePanel {

  /**
   * [M20 初始化]
   * @param {vscode.Uri} extensionUri — 插件根目录 URI（用于资源加载）
   * @param {function} onMessage      — panel→extension 消息回调
   */
  constructor(extensionUri, onMessage) {
    this._extensionUri = extensionUri;
    this._onMessage = onMessage;
    this._panel = null;
    this._disposables = [];
  }

  /**
   * [F9 调用] 打开面板（已打开则复用）
   * @param {string} [requirement] — 可选初始需求（扩展用）
   */
  open(initialMessage) {
    // [C6 条件] 已有面板 → 聚焦
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    // [M20 初始化] 创建 WebView 面板
    this._panel = vscode.window.createWebviewPanel(
      'yiyuanProbe',
      '意元 — 六维度探测',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    // [I13 渲染] 加载 HTML
    this._panel.webview.html = this._getHtml();

    // [R17 绑定] 监听 WebView 消息
    this._panel.webview.onDidReceiveMessage(
      msg => {
        if (this._onMessage) {
          this._onMessage(msg);
        }
      },
      null,
      this._disposables
    );

    // [R18 清理] 面板关闭时清理
    this._panel.onDidDispose(
      () => {
        this._panel = null;
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
      },
      null,
      this._disposables
    );

    // [I13 渲染] 面板就绪提示
    this._postMessage({ type: 'panelReady' });
  }

  // ═══════════════════════════════════════════
  // extension → panel 消息
  // ═══════════════════════════════════════════

  /**
   * [I13 渲染] 发送 LLM 回复到面板
   */
  sendAssistantMessage(content) {
    this._postMessage({ type: 'assistantMessage', content });
  }

  /**
   * [I13 渲染] 发送会话状态（更新维度进度条）
   */
  sendState(session) {
    const dims = {};
    for (const d of DIMENSION_NAMES) {
      if (session.dimensions && session.dimensions[d.key]) {
        dims[d.key] = session.dimensions[d.key].state;
      } else {
        dims[d.key] = 'pending';
      }
    }
    this._postMessage({
      type: 'state',
      currentDimension: session.currentDimension || 'extract',
      turnCount: session.turnCount || 0,
      dimensions: dims
    });
  }

  /**
   * [I13 渲染] BDD 生成完毕
   */
  sendBDDGenerated(path, content) {
    this._postMessage({ type: 'bddGenerated', path, content });
  }

  /**
   * [I13 渲染] 错误信息
   */
  sendError(message) {
    this._postMessage({ type: 'error', message });
  }

  sendStreamStart() {
    this._postMessage({ type: 'streamStart' });
  }

  sendStreamToken(token) {
    this._postMessage({ type: 'streamToken', token });
  }

  sendStreamEnd() {
    this._postMessage({ type: 'streamEnd' });
  }

  sendFileAttached(path, content) {
    this._postMessage({ type: 'fileAttached', path, content });
  }

  /**
   * [R18 清理] 销毁面板
   */
  dispose() {
    if (this._panel) {
      this._panel.dispose();
      this._panel = null;
    }
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }

  // ═══════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════

  /**
   * [I16 通信] 向 WebView 发送消息
   */
  _postMessage(msg) {
    if (this._panel && this._panel.webview) {
      this._panel.webview.postMessage(msg).catch(err => {
        console.warn('[ProbePanel] postMessage failed:', err);
      });
    }
  }

  /**
   * [I13 渲染] 生成 WebView HTML
   */
  _getHtml() {
    // 使用数组拼接避免嵌套模板字面量中的反引号转义问题
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>意元 — 六维度探测</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── 顶部进度条 ── */
    #progress {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBar-border);
      overflow-x: auto;
      flex-shrink: 0;
    }
    #progress .dim {
      white-space: nowrap;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      opacity: 0.5;
      transition: opacity 0.3s;
    }
    #progress .dim.active {
      opacity: 1;
      font-weight: bold;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #progress .dim.done {
      opacity: 0.8;
    }

    /* ── 消息区域 ── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .msg {
      display: flex;
      flex-direction: column;
      max-width: 85%;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .msg.assistant {
      align-self: flex-start;
    }
    .msg.user {
      align-self: flex-end;
    }
    .msg.error-msg {
      align-self: center;
    }

    .msg .role-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .msg.user .role-label {
      text-align: right;
    }

    .msg .bubble {
      padding: 10px 14px;
      border-radius: 12px;
      line-height: 1.55;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .msg.assistant .bubble {
      background: var(--vscode-textBlockQuote-background);
      border: 1px solid var(--vscode-textBlockQuote-border);
      border-top-left-radius: 4px;
    }
    .msg.user .bubble {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-top-right-radius: 4px;
    }
    .msg.error-msg .bubble {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 8px;
    }

    /* Markdown 简易渲染 */
    .msg .bubble code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .msg .bubble pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 6px 0;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .msg.user .bubble code,
    .msg.user .bubble pre {
      background: rgba(255,255,255,0.15);
    }

    /* ── 加载动画 ── */
    #loading {
      display: none;
      align-self: flex-start;
      padding: 10px 14px;
    }
    #loading .dots span {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--vscode-descriptionForeground);
      margin-right: 4px;
      animation: dotPulse 1.4s infinite ease-in-out both;
    }
    #loading .dots span:nth-child(1) { animation-delay: -0.32s; }
    #loading .dots span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes dotPulse {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    /* ── 输入区域 ── */
    #input-area {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--vscode-input-border);
      background: var(--vscode-editor-background);
      flex-shrink: 0;
    }
    #input {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      padding: 8px 12px;
      font-family: inherit;
      font-size: inherit;
      resize: none;
      min-height: 38px;
      max-height: 120px;
      outline: none;
    }
    #input:focus {
      border-color: var(--vscode-focusBorder);
    }
    #send {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      white-space: nowrap;
      align-self: flex-end;
    }
    #send:hover {
      background: var(--vscode-button-hoverBackground);
    }
    #send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ── 初始需求输入 ── */
    #requirement-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      text-align: center;
    }
    #requirement-area h2 {
      margin-bottom: 8px;
      color: var(--vscode-foreground);
    }
    #requirement-area p {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 20px;
      font-size: 13px;
    }
    #requirement-area textarea {
      width: 100%;
      max-width: 560px;
      min-height: 100px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      padding: 12px;
      font-family: inherit;
      font-size: inherit;
      resize: vertical;
      outline: none;
      margin-bottom: 12px;
    }
    #requirement-area textarea:focus {
      border-color: var(--vscode-focusBorder);
    }
    #requirement-area button {
      padding: 10px 32px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      font-size: 14px;
    }
    #requirement-area button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .hidden { display: none !important; }

    /* ── BDD 展示区 ── */
    #bdd-result {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: none;
    }
    #bdd-result h2 {
      color: var(--vscode-foreground);
      margin-bottom: 12px;
    }
    #bdd-result .meta {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin-bottom: 16px;
    }
    #bdd-content {
      line-height: 1.6;
    }
    #bdd-content h1 { font-size: 1.4em; margin: 16px 0 8px; }
    #bdd-content h2 { font-size: 1.2em; margin: 14px 0 6px; }
    #bdd-content h3 { font-size: 1.05em; margin: 12px 0 4px; }
    #bdd-content table {
      border-collapse: collapse;
      margin: 8px 0;
      width: 100%;
    }
    #bdd-content th, #bdd-content td {
      border: 1px solid var(--vscode-input-border);
      padding: 6px 10px;
      text-align: left;
      font-size: 12px;
    }
    #bdd-content th {
      background: var(--vscode-textBlockQuote-background);
    }
    #bdd-content code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 12px;
    }
    #bdd-content pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 12px;
    }

    /* ── 滚动条 ── */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <!-- 维度进度条 -->
  <div id="progress">
    ${DIMENSION_NAMES.map(d =>
      '<div class="dim" data-dim="' + d.key + '">' +
      DIM_ICONS.pending + ' ' + d.label +
      '</div>'
    ).join('\n    ')}
  </div>

  <!-- 初始需求输入 -->
  <div id="requirement-area">
    <h2>📋 六维度需求探测</h2>
    <p>描述你的功能需求——越具体越好。AI 将从六个维度逐层提问，帮你把模糊需求变成清晰的 BDD 规格。</p>
    <textarea id="req-input" placeholder="例如：做一个物品借还管理系统，支持借出、归还、续借、超期提醒..."></textarea>
    <button id="req-submit">开始探测</button>
  </div>

  <!-- 对话消息区 -->
  <div id="messages" class="hidden"></div>
  <div id="loading" class="hidden">
    <div class="dots"><span></span><span></span><span></span></div>
  </div>

  <!-- 输入区域 -->
  <div id="input-area" class="hidden">
    <button id="attach" title="引用文件" style="background:transparent;border:1px solid var(--vscode-input-border);border-radius:6px;cursor:pointer;font-size:16px;padding:6px 10px;line-height:1">📎</button>
    <textarea id="input" placeholder="输入你的回答...（Enter 发送，Shift+Enter 换行）" rows="1"></textarea>
    <button id="send">发送</button>
  </div>
  <div id="attached-files" style="display:none;padding:0 12px 8px;font-size:11px;color:var(--vscode-descriptionForeground)"></div>

  <!-- BDD 结果展示 -->
  <div id="bdd-result">
    <h2>✅ BDD 需求规格已生成</h2>
    <div class="meta" id="bdd-meta"></div>
    <div id="bdd-content"></div>
  </div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      let chatStarted = false;
      let bddDone = false;
      let attachedFiles = [];

      // ── DOM 引用 ──
      const $reqArea    = document.getElementById('requirement-area');
      const $reqInput   = document.getElementById('req-input');
      const $reqSubmit  = document.getElementById('req-submit');
      const $messages   = document.getElementById('messages');
      const $loading    = document.getElementById('loading');
      const $inputArea  = document.getElementById('input-area');
      const $input      = document.getElementById('input');
      const $sendBtn    = document.getElementById('send');
      const $attachBtn  = document.getElementById('attach');
      const $attached   = document.getElementById('attached-files');
      const $progress   = document.getElementById('progress');
      const $bddResult  = document.getElementById('bdd-result');
      const $bddMeta    = document.getElementById('bdd-meta');
      const $bddContent = document.getElementById('bdd-content');

      // ── 开始探测 ──
      $reqSubmit.addEventListener('click', () => {
        const requirement = $reqInput.value.trim();
        if (!requirement) return;
        chatStarted = true;
        $reqArea.classList.add('hidden');
        $messages.classList.remove('hidden');
        $inputArea.classList.remove('hidden');
        addMessage('user', requirement);
        showLoading(true);
        vscode.postMessage({ type: 'start', requirement: requirement });
      });

      $reqInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          $reqSubmit.click();
        }
      });

      // ── 发送消息 ──
      function sendMessage() {
        const text = $input.value.trim();
        if (!text || bddDone) return;
        addMessage('user', text);
        $input.value = '';
        autoResize();
        showLoading(true);
        vscode.postMessage({ type: 'userMessage', content: text, attachedFiles: attachedFiles });
        attachedFiles = [];
        $attached.style.display = 'none';
        $attached.innerHTML = '';
      }

      $sendBtn.addEventListener('click', sendMessage);
      $attachBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'pickFile' });
      });
      $input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      // ── 输入框自适应高度 ──
      function autoResize() {
        $input.style.height = 'auto';
        $input.style.height = Math.min($input.scrollHeight, 120) + 'px';
      }
      $input.addEventListener('input', autoResize);

      // ── 添加消息 ──
      function addMessage(role, content) {
        const div = document.createElement('div');
        div.className = 'msg ' + role;
        const label = role === 'user' ? '👤 你' : '🤖 意元';
        div.innerHTML =
          '<div class="role-label">' + label + '</div>' +
          '<div class="bubble">' + escapeHtml(renderMarkdown(content)) + '</div>';
        $messages.appendChild(div);
        scrollToBottom();

        return div;
      }

      function addErrorMessage(text) {
        const div = document.createElement('div');
        div.className = 'msg error-msg';
        div.innerHTML = '<div class="bubble">' + escapeHtml(text) + '</div>';
        $messages.appendChild(div);
        scrollToBottom();
      }

      // ── Markdown 渲染 ──
      function renderMarkdown(text) {
        var h = text;
        // 代码块先处理（避免内部内容被后续规则影响）
        h = h.replace(/\x60\x60\x60([\\s\\S]*?)\x60\x60\x60/g, function(m, code) {
          return '<pre>' + escapeHtml(code.trim()) + '</pre>';
        });
        // 内联代码
        h = h.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
        // 标题
        h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        // 粗体/斜体
        h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // 无序列表
        h = h.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
        h = h.replace(/((?:<li>.*<\\/li>\\n?)+)/g, '<ul>$1</ul>');
        // 有序列表
        h = h.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');
        // 引用
        h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
        // 水平线
        h = h.replace(/^---$/gm, '<hr>');
        // 表格
        h = h.replace(/^\\|(.+)\\|$/gm, function(line) {
          if (/^\\|?[\\s\\-:]+\\|?$/.test(line)) return '';
          var cells = line.split('|').filter(function(c) { return c.length > 0; });
          return '<tr>' + cells.map(function(c) { return '<td>' + c.trim() + '</td>'; }).join('') + '</tr>';
        });
        h = h.replace(/((?:<tr>.*?<\\/tr>\\n?)+)/g, function(m) {
          var rows = m;
          rows = rows.replace(/<tr>/, '<thead><tr>');
          rows = rows.replace(/<td>/g, '<th>');
          rows = rows.replace(/<\\/td>/g, '</th>');
          rows = rows.replace(/<\\/tr>/, '</tr></thead><tbody>');
          return '<table>' + rows + '</tbody></table>';
        });
        // 段落：双换行
        h = '<p>' + h.replace(/\\n\\n/g, '</p><p>') + '</p>';
        return h;
      }

      // ── HTML 转义 ──
      function escapeHtml(str) {
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      // ── 显示/隐藏加载动画 ──
      function showLoading(show) {
        $loading.classList.toggle('hidden', !show);
        $sendBtn.disabled = show;
        $input.disabled = show;
        if (show) {
          $loading.querySelector('.dots').style.display = 'block';
        }
        scrollToBottom();
      }

      // ── 滚动到底部 ──
      function scrollToBottom() {
        $messages.scrollTop = $messages.scrollHeight;
      }

      // ── 更新维度进度条 ──
      function updateProgress(dimensions, currentDim, turnCount) {
        var dims = $progress.querySelectorAll('.dim');
        dims.forEach(function(d) {
          var key = d.dataset.dim;
          var state = dimensions[key] || 'pending';
          var icon = state === 'done' ? '✅' : state === 'probing' ? '⏳' : '⬜';
          d.textContent = icon + ' ' + d.textContent.replace(/^[⬜⏳✅]\\s*/, '');
          d.className = 'dim';
          if (state === 'probing') d.classList.add('active');
          if (state === 'done') d.classList.add('done');
        });
      }

      // ── 显示 BDD 结果 ──
      function showBDDResult(path, content) {
        bddDone = true;
        $messages.classList.add('hidden');
        $inputArea.classList.add('hidden');
        $loading.classList.add('hidden');
        $bddResult.style.display = 'block';
        $bddMeta.textContent = '已保存到：' + path;
        $bddContent.innerHTML = renderFullMarkdown(content);
      }

      // ── 完整 Markdown 渲染（BDD 用） ──
      function renderFullMarkdown(text) {
        var html = escapeHtml(text);

        // 代码块
        html = html.replace(/\x60\x60\x60([\\s\\S]*?)\x60\x60\x60/g, '<pre>$1</pre>');
        // 内联代码
        html = html.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
        // 标题
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        // 粗体
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        // 表格
        html = html.replace(/^\\|(.+)\\|$/gm, function(line) {
          var cells = line.split('|').filter(function(c) { return c.trim(); });
          var isHeader = /^[-:\\s]+$/.test(cells[0] || '');
          if (isHeader) return '';
          var tag = line.indexOf('|---') > -1 || line.indexOf('| --') > 0 ? '' :
                    (line.replace(/^\\|(.+)\\|$/, '$1').indexOf('---') >= 0 ? '' :
                    '<tr>' + cells.map(function(c) {
                      var prevIsHeader = false;
                      return (prevIsHeader ? '<th>' : '<td>') + c.trim() + (prevIsHeader ? '</th>' : '</td>');
                    }).join('') + '</tr>');
          return tag;
        });
        // 处理表格（简化：将连续的 <tr> 包在 <table> 里）
        html = html.replace(/(<tr>[\\s\\S]*?<\\/tr>)\\s*(?=<tr>|[^<]|$)/g, function(m) {
          var rows = m;
          // 第一行做表头
          rows = rows.replace(/<tr>/, '<thead><tr>');
          rows = rows.replace(/<td>/g, '<th>');
          rows = rows.replace(/<\\/td>/g, '</th>');
          rows = rows.replace(/<\\/tr>/, '</tr></thead><tbody>');
          rows = rows.replace(/<tr>/g, '<tr>'); // 后续行保持 td
          return '<table>' + rows + '</tbody></table>';
        });

        // 保持换行
        html = html.replace(/\\n\\n/g, '</p><p>');
        html = '<p>' + html + '</p>';

        return html;
      }

      // ═══════════════════════════════════════
      // 接收 extension → panel 消息
      // ═══════════════════════════════════════
      var streamBuffer = '';
      var streamDiv = null;

      window.addEventListener('message', function(event) {
        var msg = event.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {
          case 'streamStart':
            showLoading(false);
            streamBuffer = '';
            streamDiv = addMessage('assistant', '');
            break;

          case 'streamToken':
            streamBuffer += msg.token;
            if (streamDiv) {
              streamDiv.querySelector('.bubble').innerHTML = renderMarkdown(streamBuffer);
              scrollToBottom();
            }
            break;

          case 'streamEnd':
            if (streamDiv) {
              streamDiv.querySelector('.bubble').innerHTML = renderMarkdown(streamBuffer);
            }
            streamBuffer = '';
            streamDiv = null;
            break;

          case 'assistantMessage':
            showLoading(false);
            addMessage('assistant', msg.content);
            break;

          case 'state':
            updateProgress(msg.dimensions, msg.currentDimension, msg.turnCount);
            break;

          case 'bddGenerated':
            showLoading(false);
            // 最后一条 assistant 消息展示 BDD 摘要提示
            addMessage('assistant', '✅ BDD 需求规格已生成，请查看下方完整文档。');
            showBDDResult(msg.path, msg.content);
            break;

          case 'error':
            showLoading(false);
            addErrorMessage('❌ ' + msg.message);
            break;

          case 'fileAttached':
            attachedFiles.push({ path: msg.path, content: msg.content });
            $attached.style.display = 'block';
            $attached.innerHTML = attachedFiles.map(function(f) {
              return '<span style="background:var(--vscode-badge-background);padding:2px 6px;border-radius:3px;margin-right:4px">📄 ' + f.path.split('/').pop() + '</span>';
            }).join('');
            break;

          case 'panelReady':
            // 面板就绪，extension 可开始发送初始数据
            break;
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}

// [F10 返回]
module.exports = { ProbePanel };
