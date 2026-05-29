// [M1 声明] 蓝图浏览面板 — WebView 实现
// 代码语义元动作体系 v1.9
//
// 职责：浏览 + 生成 docs/blueprints/ 下的 BDD 和蓝图文件。

const vscode = require('vscode');

class BlueprintPanel {
  constructor(extensionUri, onMessage) {
    this._extensionUri = extensionUri;
    this._onMessage = onMessage;
    this._panel = null;
    this._disposables = [];
  }

  // [F9 调用] 打开面板
  open() {
    if (this._panel) { this._panel.reveal(vscode.ViewColumn.Two); return; }
    this._panel = vscode.window.createWebviewPanel('yiyuanBlueprint', '意元 — 蓝图浏览', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
    this._panel.webview.html = this._getHtml();
    this._panel.webview.onDidReceiveMessage(msg => { if (this._onMessage) this._onMessage(msg); }, null, this._disposables);
    this._panel.onDidDispose(() => { this._panel = null; this._disposables.forEach(d => d.dispose()); this._disposables = []; }, null, this._disposables);
    this._postMessage({ type: 'panelReady' });
  }

  // [I16 通信] 发送消息
  sendFileList(files)    { this._postMessage({ type: 'fileList', files }); }
  sendFileContent(p, c)  { this._postMessage({ type: 'fileContent', path: p, content: c }); }
  sendError(message)     { this._postMessage({ type: 'error', message }); }
  dispose()              { if (this._panel) { this._panel.dispose(); this._panel = null; } this._disposables.forEach(d => d.dispose()); this._disposables = []; }

  _postMessage(msg) {
    if (this._panel && this._panel.webview) {
      this._panel.webview.postMessage(msg).catch(err => { console.warn('[BlueprintPanel] postMessage failed:', err); });
    }
  }

  _getHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>意元 - 蓝图浏览</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);height:100vh;display:flex;overflow:hidden}
#sidebar{width:220px;min-width:160px;background:var(--vscode-sideBar-background);border-right:1px solid var(--vscode-sideBar-border);display:flex;flex-direction:column;overflow:hidden}
#sidebar h3{padding:12px;font-size:12px;color:var(--vscode-sideBarTitle-foreground);border-bottom:1px solid var(--vscode-sideBar-border);flex-shrink:0}
#file-list{flex:1;overflow-y:auto;padding:4px 0}
.file-item{padding:8px 12px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;transition:background .15s}
.file-item:hover{background:var(--vscode-list-hoverBackground)}
.file-item.active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.file-item .icon{font-size:14px;flex-shrink:0}
.file-item .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-item .tag{font-size:10px;padding:1px 4px;border-radius:3px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);flex-shrink:0}
#main{flex:1;display:flex;flex-direction:column;overflow:hidden}
#toolbar{display:flex;gap:8px;padding:6px 12px;border-bottom:1px solid var(--vscode-input-border);background:var(--vscode-editor-background);flex-shrink:0;align-items:center}
#toolbar button{padding:4px 10px;font-size:11px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer}
#toolbar button:hover{background:var(--vscode-button-secondaryHoverBackground)}
#toolbar button.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
#toolbar button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
#toolbar .path-display{font-size:12px;color:var(--vscode-descriptionForeground);margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

#preview{flex:1;overflow-y:auto;padding:20px}
#preview.split{display:flex;gap:0}
#preview.split .pane{flex:1;overflow-y:auto;padding:16px;border-right:1px solid var(--vscode-input-border)}
#preview.split .pane:last-child{border-right:none}
#preview h1{font-size:1.5em;margin:16px 0 8px;color:var(--vscode-foreground)}
#preview h2{font-size:1.25em;margin:14px 0 6px}
#preview h3{font-size:1.1em;margin:12px 0 4px}
#preview p{margin:6px 0;line-height:1.6}
#preview code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:var(--vscode-editor-font-family);font-size:12px}
#preview pre{background:var(--vscode-textCodeBlock-background);padding:10px 14px;border-radius:6px;overflow-x:auto;margin:8px 0;font-family:var(--vscode-editor-font-family);font-size:12px;line-height:1.4}
#preview table{border-collapse:collapse;margin:8px 0;width:100%}
#preview th,#preview td{border:1px solid var(--vscode-input-border);padding:6px 10px;text-align:left;font-size:12px}
#preview th{background:var(--vscode-textBlockQuote-background);font-weight:600}
#preview ul,#preview ol{padding-left:20px;margin:6px 0}
#preview li{line-height:1.6}
#preview blockquote{border-left:3px solid var(--vscode-textBlockQuote-border);padding:6px 12px;margin:8px 0;background:var(--vscode-textBlockQuote-background);color:var(--vscode-descriptionForeground)}
#preview hr{border:none;border-top:1px solid var(--vscode-input-border);margin:16px 0}
#empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground);font-size:13px;flex-direction:column;gap:8px}
#empty .icon{font-size:40px;opacity:.5}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background);border-radius:4px}
</style>
</head>
<body>
<div id="sidebar">
  <h3>蓝图文件</h3>
  <div id="file-list"></div>
</div>
<div id="main">
  <div id="toolbar">
    <button id="btn-single" title="单文件查看">单文件</button>
    <button id="btn-compare" title="对照查看">对照</button>
    <button class="primary" id="btn-generate" title="基于最新 BDD 生成蓝图">生成蓝图</button>
    <span class="path-display" id="path-display"></span>
  </div>
  <div id="preview"></div>
  <div id="empty"><span class="icon">📂</span><span>选择左侧文件预览，或点击「生成蓝图」</span></div>
</div>
<script>
(function(){
var vscode=acquireVsCodeApi();
var files=[],selected={},compareMode=false,fileContents={};
var $list=document.getElementById("file-list"),$preview=document.getElementById("preview"),$empty=document.getElementById("empty");
var $path=document.getElementById("path-display"),$btnSingle=document.getElementById("btn-single"),$btnCompare=document.getElementById("btn-compare");
var $btnGen=document.getElementById("btn-generate");

function md2html(text){
  var h=text;
  h=h.replace(/\x60\x60\x60([\\s\\S]*?)\x60\x60\x60/g,function(m,c){return"<pre>"+escHtml(c.trim())+"</pre>";});
  h=h.replace(/\x60([^\x60]+)\x60/g,"<code>$1</code>");
  h=h.replace(/^#### (.+)$/gm,"<h4>$1</h4>");
  h=h.replace(/^### (.+)$/gm,"<h3>$1</h3>");
  h=h.replace(/^## (.+)$/gm,"<h2>$1</h2>");
  h=h.replace(/^# (.+)$/gm,"<h1>$1</h1>");
  h=h.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>");
  h=h.replace(/\*(.+?)\*/g,"<em>$1</em>");
  h=h.replace(/^\|(.+)\|$/gm,function(line){if(/^\|?[\s\-:]+\|?$/.test(line))return"";var cells=line.split("|").filter(function(c){return c.length>0;});return"<tr>"+cells.map(function(c){return"<td>"+c.trim()+"</td>";}).join("")+"</tr>";});
  h=h.replace(/((?:<tr>.*<\/tr>\n?)+)/g,function(m){var r=m;r=r.replace(/<tr>/,"<thead><tr>");r=r.replace(/<td>/g,"<th>");r=r.replace(/<\/td>/g,"</th>");r=r.replace(/<\/tr>/,"</tr></thead><tbody>");return"<table>"+r+"</tbody></table>";});
  h=h.replace(/^[\-\*] (.+)$/gm,"<li>$1</li>");h=h.replace(/((?:<li>.*<\/li>\n?)+)/g,"<ul>$1</ul>");
  h=h.replace(/^\d+\. (.+)$/gm,"<li>$1</li>");
  h=h.replace(/^> (.+)$/gm,"<blockquote>$1</blockquote>");
  h=h.replace(/^---$/gm,"<hr>");h=h.replace(/\n\n/g,"</p><p>");return"<p>"+h+"</p>";
}
function escHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function fileType(name){return name.indexOf("bdd-")===0?"bdd":"blueprint";}
function typeIcon(t){return t==="bdd"?"📋":"📐";}
function typeLabel(t){return t==="bdd"?"BDD":"蓝图";}

function renderList(){
  $list.innerHTML="";
  if(files.length===0){$list.innerHTML="<div style=padding:12px;color:var(--vscode-descriptionForeground);font-size:12px>暂无文件</div>";return;}
  files.forEach(function(f){
    var div=document.createElement("div");div.className="file-item";
    if(selected[f.path])div.classList.add("active");
    div.innerHTML="<span class=icon>"+typeIcon(fileType(f.name))+"</span><span class=name>"+escHtml(f.name)+"</span><span class=tag>"+typeLabel(fileType(f.name))+"</span>";
    div.addEventListener("click",function(){
      if(compareMode){if(selected[f.path]){delete selected[f.path];}else{var keys=Object.keys(selected);if(keys.length>=2)delete selected[keys[0]];selected[f.path]=true;}}
      else{selected={};selected[f.path]=true;}
      renderList();loadSelected();
    });$list.appendChild(div);
  });
}

function loadSelected(){
  var keys=Object.keys(selected);$path.textContent=keys.join(" | ");
  if(keys.length===0){$preview.style.display="none";$empty.style.display="flex";return;}
  keys.forEach(function(p){if(!fileContents[p])vscode.postMessage({type:"loadFile",path:p});});renderPreview();
}

function renderPreview(){
  var keys=Object.keys(selected);if(keys.length===0)return;$empty.style.display="none";$preview.style.display="flex";
  if(keys.length===2&&compareMode){$preview.className="split";$preview.innerHTML="<div class=pane>"+renderPane(keys[0])+"</div><div class=pane>"+renderPane(keys[1])+"</div>";}
  else if(keys.length===1){$preview.className="";$preview.innerHTML=renderPane(keys[0]);}
  else{$preview.className="";$preview.innerHTML="<div style=padding:16px;color:var(--vscode-descriptionForeground)>对照模式请选择 2 个文件</div>";}
}

function renderPane(path){
  var f=null;for(var i=0;i<files.length;i++){if(files[i].path===path){f=files[i];break;}}
  var name=f?f.name:path,content=fileContents[path]||"加载中...";
  return"<h2>"+escHtml(name)+"</h2>"+(content==="加载中..."?"<p style=color:var(--vscode-descriptionForeground)>加载中...</p>":md2html(content));
}

// 工具栏
$btnSingle.addEventListener("click",function(){compareMode=false;$btnSingle.classList.add("active");$btnCompare.classList.remove("active");var keys=Object.keys(selected);if(keys.length>1){selected={};selected[keys[0]]=true;renderList();}renderPreview();});
$btnCompare.addEventListener("click",function(){compareMode=true;$btnCompare.classList.add("active");$btnSingle.classList.remove("active");renderPreview();});
$btnSingle.classList.add("active");

// 生成蓝图
$btnGen.addEventListener("click",function(){$empty.style.display="flex";$empty.innerHTML="<span class=icon>⏳</span><span>正在生成文件架构与蓝图...</span>";vscode.postMessage({type:"generate"});});

vscode.postMessage({type:"loadFileList"});

window.addEventListener("message",function(e){
  var msg=e.data;if(!msg||!msg.type)return;
  switch(msg.type){
    case"fileList":files=msg.files||[];renderList();break;
    case"fileContent":fileContents[msg.path]=msg.content;renderPreview();break;
    case"error":$empty.style.display="flex";$empty.innerHTML="<span class=icon>⚠️</span><span>"+escHtml(msg.message)+"</span>";break;
  }
});
})();
</script>
</body>
</html>`;
  }
}

module.exports = { BlueprintPanel };
