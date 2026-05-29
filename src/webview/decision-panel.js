// [M1 声明] 决策暂停面板 — 多轮对话版
// 代码语义元动作体系 v1.9
//
// 职责：自动修正陷入死循环时，打开多轮对话面板。
//       LLM 先诊断问题 → 逐轮提问 → 确认方案 → 修正。

const vscode = require('vscode');

class DecisionPanel {
  constructor(extensionUri, onMessage) {
    this._extensionUri = extensionUri;
    this._onMessage = onMessage;
    this._panel = null;
    this._disposables = [];
  }

  open() {
    if (this._panel) { this._panel.reveal(vscode.ViewColumn.Two); return; }
    this._panel = vscode.window.createWebviewPanel('yiyuanDecision', '意元 — 决策暂停', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    this._panel.webview.html = this._getHtml();
    this._panel.webview.onDidReceiveMessage(msg => { if (this._onMessage) this._onMessage(msg); }, null, this._disposables);
    this._panel.onDidDispose(() => { this._panel = null; this._disposables.forEach(d => d.dispose()); this._disposables = []; }, null, this._disposables);
    this._postMessage({ type: 'panelReady' });
  }

  showDecision(data) {
    if (!this._panel) this.open();
    this._postMessage({ type: 'start', ...data });
  }

  sendAssistantMessage(content) { this._postMessage({ type: 'assistantMessage', content }); }
  sendFixGenerated(path, content) { this._postMessage({ type: 'fixGenerated', path, content }); }

  dispose() {
    if (this._panel) { this._panel.dispose(); this._panel = null; }
    this._disposables.forEach(d => d.dispose()); this._disposables = [];
  }

  _postMessage(msg) {
    if (this._panel && this._panel.webview) {
      this._panel.webview.postMessage(msg).catch(err => { console.warn('[DecisionPanel] postMessage failed:', err); });
    }
  }

  _getHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>意元 - 决策暂停</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);height:100vh;display:flex;flex-direction:column;overflow:hidden}
#messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}
.msg{display:flex;flex-direction:column;max-width:85%;animation:fadeIn .2s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.msg.assistant{align-self:flex-start}.msg.user{align-self:flex-end}
.msg .role-label{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px}
.msg.user .role-label{text-align:right}
.msg .bubble{padding:10px 14px;border-radius:12px;line-height:1.55;word-break:break-word;white-space:pre-wrap}
.msg.assistant .bubble{background:var(--vscode-textBlockQuote-background);border:1px solid var(--vscode-textBlockQuote-border);border-top-left-radius:4px}
.msg.user .bubble{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-top-right-radius:4px}
.msg .bubble code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:var(--vscode-editor-font-family);font-size:12px}
.msg .bubble pre{background:var(--vscode-textCodeBlock-background);padding:8px 12px;border-radius:6px;overflow-x:auto;margin:6px 0;font-family:var(--vscode-editor-font-family);font-size:12px}
#loading{display:none;align-self:flex-start;padding:10px 14px}
#loading .dots span{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--vscode-descriptionForeground);margin-right:4px;animation:dotPulse 1.4s infinite ease-in-out both}
#loading .dots span:nth-child(1){animation-delay:-.32s}#loading .dots span:nth-child(2){animation-delay:-.16s}
@keyframes dotPulse{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}
#input-area{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--vscode-input-border);background:var(--vscode-editor-background);flex-shrink:0}
#input{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:6px;padding:8px 12px;font-family:inherit;font-size:inherit;resize:none;min-height:38px;max-height:120px;outline:none}
#input:focus{border-color:var(--vscode-focusBorder)}
#send{padding:8px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:6px;cursor:pointer;font-size:inherit;white-space:nowrap;align-self:flex-end}
#send:hover{background:var(--vscode-button-hoverBackground)}#send:disabled{opacity:.5;cursor:not-allowed}
::-webkit-scrollbar{width:8px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background);border-radius:4px}
</style></head>
<body>
<div id="messages"></div>
<div id="loading" class="hidden"><div class="dots"><span></span><span></span><span></span></div></div>
<div id="input-area">
  <textarea id="input" placeholder="描述你的想法...（Enter 发送，Shift+Enter 换行）" rows="1"></textarea>
  <button id="send">发送</button>
</div>
<script>
(function(){
var vsc=acquireVsCodeApi(),$msgs=document.getElementById('messages'),$loading=document.getElementById('loading'),$input=document.getElementById('input'),$send=document.getElementById('send'),conversationStarted=false;
function addMsg(role,content){var d=document.createElement('div');d.className='msg '+role;d.innerHTML='<div class=role-label>'+(role==='user'?'👤 你':'🤖 意元')+'</div><div class=bubble>'+esc(content)+'</div>';$msgs.appendChild(d);$msgs.scrollTop=$msgs.scrollHeight;}
function showLoading(s){$loading.style.display=s?'flex':'none';$send.disabled=s;$input.disabled=s;if(s)$msgs.scrollTop=$msgs.scrollHeight;}
function sendMsg(){var t=$input.value.trim();if(!t)return;addMsg('user',t);$input.value='';showLoading(true);vsc.postMessage({type:'userMessage',content:t});}
$send.addEventListener('click',sendMsg);
$input.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});
window.addEventListener('message',function(e){var d=e.data;if(!d||!d.type)return;
  switch(d.type){
    case'start':addMsg('assistant','⚠️ **自动化暂停**\n\n位置：'+esc(d.file)+'\n阶段：'+esc(d.stage)+'\n原因：'+esc(d.reason)+'\n\n'+(d.description||''));break;
    case'assistantMessage':showLoading(false);addMsg('assistant',d.content);break;
    case'fixGenerated':showLoading(false);addMsg('assistant','✅ 修正方案已应用：「'+esc(d.path)+'」\n管线继续...');break;
  }
});
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
})();
</script></body></html>`;
  }
}

module.exports = { DecisionPanel };
