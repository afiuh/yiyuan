// [M1 声明] 合规审查面板 — WebView 实现
// 代码语义元动作体系 v1.9
//
// 职责：显示当前文件的合规审查结果——违规列表 + 统计 + 点击跳转。
//
// 暴露给 extension.js 的接口：
//   new CompliancePanel(extensionUri, onMessage)
//   panel.open()                    — 打开/复用面板
//   panel.sendReport(violations, fileName, stats) — 推送合规报告
//   panel.dispose()                 — 销毁

const vscode = require('vscode');

class CompliancePanel {
  constructor(extensionUri, onMessage) {
    this._extensionUri = extensionUri;
    this._onMessage = onMessage;
    this._panel = null;
    this._disposables = [];
  }

  open() {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'yiyuanCompliance',
      '意元 — 合规审查',
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this._panel.webview.html = this._getHtml();

    this._panel.webview.onDidReceiveMessage(
      msg => { if (this._onMessage) this._onMessage(msg); },
      null, this._disposables
    );

    this._panel.onDidDispose(() => {
      this._panel = null;
      this._disposables.forEach(d => d.dispose());
      this._disposables = [];
    }, null, this._disposables);

    this._postMessage({ type: 'panelReady' });
  }

  sendReport(violations, fileName, stats, alignment) {
    this._postMessage({ type: 'report', violations, fileName, stats, alignment });
  }

  sendError(message) {
    this._postMessage({ type: 'error', message });
  }

  dispose() {
    if (this._panel) { this._panel.dispose(); this._panel = null; }
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }

  _postMessage(msg) {
    if (this._panel && this._panel.webview) {
      this._panel.webview.postMessage(msg).catch(err => {
        console.warn('[CompliancePanel] postMessage failed:', err);
      });
    }
  }

  _getHtml() {
    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>意元 - 合规审查</title>\n<style>\n*{box-sizing:border-box;margin:0;padding:0}\nbody{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);height:100vh;display:flex;flex-direction:column;overflow:hidden}\n#stats{display:flex;gap:16px;padding:10px 14px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-sideBar-border);flex-shrink:0;align-items:center}\n.stat{display:flex;align-items:center;gap:4px;font-size:12px}\n.stat .num{font-size:18px;font-weight:700}\n.stat.error .num{color:#F44747}\n.stat.warning .num{color:#CCA700}\n.stat.info .num{color:#3794FF}\n.stat.total .num{color:var(--vscode-foreground)}\n.stat .label{font-size:11px;color:var(--vscode-descriptionForeground)}\n#file-name{font-size:12px;color:var(--vscode-descriptionForeground);margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n#alignment{display:none;padding:8px 14px;border-bottom:1px solid var(--vscode-input-border);background:var(--vscode-textBlockQuote-background);font-size:11px;flex-shrink:0}\n#alignment.show{display:flex;gap:16px;align-items:center;flex-wrap:wrap}\n#alignment .al-title{font-weight:600;white-space:nowrap}\n#alignment .al-stat{padding:2px 8px;border-radius:3px;font-size:10px}\n#alignment .al-stat.ok{background:rgba(106,153,85,.15);color:#6A9955}\n#alignment .al-stat.warn{background:rgba(204,167,0,.15);color:#CCA700}\n#alignment .al-stat.err{background:rgba(244,71,71,.15);color:#F44747}\n#list-header{display:flex;padding:6px 14px;border-bottom:1px solid var(--vscode-input-border);font-size:11px;color:var(--vscode-descriptionForeground);font-weight:600;flex-shrink:0}\n#list-header .col-sev{width:40px}\n#list-header .col-line{width:50px}\n#list-header .col-ma{width:70px}\n#list-header .col-msg{flex:1}\n#list{flex:1;overflow-y:auto}\n.v-item{display:flex;padding:8px 14px;border-bottom:1px solid var(--vscode-input-border);cursor:pointer;transition:background .15s;align-items:flex-start;font-size:12px}\n.v-item:hover{background:var(--vscode-list-hoverBackground)}\n.v-item.error{border-left:3px solid #F44747}\n.v-item.warning{border-left:3px solid #CCA700}\n.v-item.info{border-left:3px solid #3794FF}\n.v-item .col-sev{width:40px;flex-shrink:0;font-weight:700}\n.v-item .col-sev .badge{padding:1px 6px;border-radius:3px;font-size:10px;text-transform:uppercase}\n.v-item.error .badge{background:rgba(244,71,71,.15);color:#F44747}\n.v-item.warning .badge{background:rgba(204,167,0,.15);color:#CCA700}\n.v-item.info .badge{background:rgba(55,148,255,.15);color:#3794FF}\n.v-item .col-line{width:50px;flex-shrink:0;font-family:var(--vscode-editor-font-family);opacity:.7}\n.v-item .col-ma{width:70px;flex-shrink:0;font-family:var(--vscode-editor-font-family);font-size:11px;opacity:.8}\n.v-item .col-msg{flex:1;min-width:0}\n.v-item .col-msg .msg-text{line-height:1.4;word-break:break-word}\n.v-item .col-msg .suggestion{margin-top:4px;font-size:11px;color:var(--vscode-descriptionForeground)}\n#empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground);font-size:13px;flex-direction:column;gap:8px}\n#empty.pass{color:#6A9955}\n#empty .icon{font-size:40px;opacity:.7}\n::-webkit-scrollbar{width:8px}\n::-webkit-scrollbar-track{background:transparent}\n::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background);border-radius:4px}\n</style>\n</head>\n<body>\n<div id="stats">\n  <div class="stat total"><span class="num" id="num-total">-</span><span class="label">总计</span></div>\n  <div class="stat error"><span class="num" id="num-error">-</span><span class="label">错误</span></div>\n  <div class="stat warning"><span class="num" id="num-warn">-</span><span class="label">警告</span></div>\n  <div class="stat info"><span class="num" id="num-info">-</span><span class="label">提示</span></div>\n  <span id="file-name"></span>\n</div>\n<div id="alignment"></div>\n<div id="list-header">\n  <span class="col-sev">级别</span>\n  <span class="col-line">行号</span>\n  <span class="col-ma">元动作</span>\n  <span class="col-msg">违规描述 / 修复建议</span>\n</div>\n<div id="list"></div>\n<div id="empty"><span class="icon">📋</span><span>等待合规审查结果...</span></div>\n<script>\n(function(){\nvar vscode=acquireVsCodeApi();\n\nvar $list=document.getElementById("list");\nvar $empty=document.getElementById("empty");\nvar $numTotal=document.getElementById("num-total");\nvar $numError=document.getElementById("num-error");\nvar $numWarn=document.getElementById("num-warn");\nvar $numInfo=document.getElementById("num-info");\nvar $fileName=document.getElementById("file-name");\n\nfunction renderReport(violations,fileName,stats,alignment){\n  $fileName.textContent=fileName||"";\n  $numTotal.textContent=stats.total;\n  $numError.textContent=stats.error;\n  $numWarn.textContent=stats.warning;\n  $numInfo.textContent=stats.info;\n  renderAlignment(alignment);\n\n  if(!violations||violations.length===0){\n    $list.style.display="none";\n    $empty.style.display="flex";\n    $empty.className="pass";\n    $empty.innerHTML="<span class=icon>\\u2705</span><span>合规审查通过 — 未发现违规</span>";\n    return;\n  }\n\n  $list.style.display="";\n  $empty.style.display="none";\n  $list.innerHTML="";\n\n  violations.forEach(function(v){\n    var div=document.createElement("div");\n    div.className="v-item "+v.severity;\n    div.addEventListener("click",function(){\n      vscode.postMessage({type:"gotoLine",line:v.line});\n    });\n\n    var sevLabel=v.severity==="error"?"错误":v.severity==="warning"?"警告":"提示";\n    var suggestion=v.suggestion?"<div class=suggestion>\\uD83D\\uDCA1 "+escHtml(v.suggestion)+"</div>":"";\n\n    div.innerHTML=\n      "<div class=col-sev><span class=badge>"+sevLabel+"</span></div>"+\n      "<div class=col-line>"+v.line+"</div>"+\n      "<div class=col-ma>"+escHtml(v.metaActionId)+"</div>"+\n      "<div class=col-msg><div class=msg-text>"+escHtml(v.message)+"</div>"+suggestion+"</div>";\n    $list.appendChild(div);\n  });\n}\n\nfunction renderAlignment(al){\n  var $al=document.getElementById("alignment");\n  if(!al||!al.expected||al.expected.length===0){$al.className="";return;}\n  $al.className="show";\n  var ok=al.missing.length===0&&al.extra.length===0;\n  var cls=ok?"ok":"warn";\n  var icon=ok?"\\u2705":"\\u26A0\\uFE0F";\n  var txt=ok?"蓝图对齐":"蓝图偏离";\n  if(al.missing.length>0)txt+=" | 缺失: "+al.missing.join(",");\n  if(al.extra.length>0)txt+=" | 多余: "+al.extra.join(",");\n  $al.innerHTML="<span class=al-title>"+icon+" "+txt+"</span><span class=\\"al-stat "+cls+"\\">"+al.expected.length+" 预期 / "+al.actual.length+" 实际</span>";\n}\n\nfunction escHtml(s){\n  return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");\n}\n\nwindow.addEventListener("message",function(e){\n  var msg=e.data;\n  if(!msg||!msg.type)return;\n  switch(msg.type){\n    case"report":\n      renderReport(msg.violations,msg.fileName,msg.stats,msg.alignment);\n      break;\n    case"error":\n      $list.style.display="none";\n      $empty.style.display="flex";\n      $empty.className="";\n      $empty.innerHTML="<span class=icon>\\u26A0\\uFE0F</span><span>"+escHtml(msg.message)+"</span>";\n      break;\n  }\n});\n})();\n</script>\n</body>\n</html>';
  }
}

module.exports = { CompliancePanel };
