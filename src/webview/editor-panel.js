// [M1 声明] 代码编辑器面板 — WebView 实现（Monaco + 元动作标注）
// 代码语义元动作体系 v1.9
//
// 职责：加载 Monaco Editor，编辑代码时实时显示元动作标注。
// 标注以 Monaco decorations 形式显示在行末和 overviewRuler。
//
// 暴露给 extension.js 的接口：
//   new EditorPanel(extensionUri, onMessage)
//   panel.open()                   — 打开/复用面板
//   panel.sendInit(content, language) — 推送初始代码
//   panel.sendAnnotations(annotations) — 推送标注结果
//   panel.dispose()                — 销毁

const vscode = require('vscode');

// 颜色编码：按元动作流分类
const FLOW_COLORS = {
  Memory:    '#4FC1FF',  // 蓝
  Control:   '#C586C0',  // 紫
  Function:  '#CE9178',  // 橙
  IO:        '#F44747',  // 红
  Resource:  '#6A9955'   // 绿
};
const DEFAULT_COLOR = '#808080';

class EditorPanel {
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
      'yiyuanEditor',
      '意元 — 元动作编辑器',
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

  sendInit(content, language) {
    this._postMessage({ type: 'init', content, language });
  }

  sendAnnotations(annotations) {
    this._postMessage({ type: 'annotations', annotations });
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
        console.warn('[EditorPanel] postMessage failed:', err);
      });
    }
  }

  _getHtml() {
    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>意元 - 元动作编辑器</title>\n<style>\n*{box-sizing:border-box;margin:0;padding:0}\nbody{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);height:100vh;display:flex;flex-direction:column;overflow:hidden}\n#toolbar{display:flex;gap:8px;padding:6px 12px;background:var(--vscode-titleBar-activeBackground);border-bottom:1px solid var(--vscode-input-border);flex-shrink:0;align-items:center}\n#toolbar .title{font-size:12px;font-weight:600;color:var(--vscode-foreground)}\n#toolbar .info{font-size:11px;color:var(--vscode-descriptionForeground);margin-left:auto}\n#legend{display:flex;gap:10px;padding:4px 12px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-input-border);flex-shrink:0;font-size:11px;overflow-x:auto}\n#legend .item{display:flex;align-items:center;gap:4px;white-space:nowrap}\n#legend .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}\n#editor-container{flex:1;overflow:hidden}\n#loading{flex:1;display:flex;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground);font-size:13px;flex-direction:column;gap:8px}\n#loading .spinner{width:24px;height:24px;border:2px solid var(--vscode-input-border);border-top-color:var(--vscode-focusBorder);border-radius:50%;animation:spin .8s linear infinite}\n@keyframes spin{to{transform:rotate(360deg)}}\n</style>\n</head>\n<body>\n<div id="toolbar">\n  <span class="title">元动作编辑器</span>\n  <span class="info" id="anno-count"></span>\n</div>\n<div id="legend">\n  <div class="item"><span class="dot" style="background:#4FC1FF"></span> 内存</div>\n  <div class="item"><span class="dot" style="background:#C586C0"></span> 控制</div>\n  <div class="item"><span class="dot" style="background:#CE9178"></span> 函数</div>\n  <div class="item"><span class="dot" style="background:#F44747"></span> 交互/IO</div>\n  <div class="item"><span class="dot" style="background:#6A9955"></span> 资源</div>\n</div>\n<div id="loading"><div class="spinner"></div><span>正在加载 Monaco Editor...</span></div>\n<div id="editor-container" style="display:none"></div>\n<script>\n(function(){\nvar vscode=acquireVsCodeApi();\nvar editor=null;\nvar decorations=[];\nvar debounceTimer=null;\nvar flowColors={\n  Memory:"#4FC1FF",Control:"#C586C0",Function:"#CE9178",\n  IO:"#F44747",Resource:"#6A9955"\n};\nvar defaultColor="#808080";\n\n// 加载 Monaco\nvar baseUrl="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs";\n\nfunction loadScript(src,cb){\n  var s=document.createElement("script");\n  s.src=src;\n  s.onload=cb;\n  s.onerror=function(){\n    document.getElementById("loading").innerHTML="<span style=color:var(--vscode-inputValidation-errorForeground)>Monaco 加载失败，请检查网络连接</span>";\n  };\n  document.head.appendChild(s);\n}\n\n// 先加载 loader\nvar loaderUrl=baseUrl+"/loader.js";\nloadScript(loaderUrl,function(){\n  require.config({paths:{vs:baseUrl}});\n  require(["vs/editor/editor.main"],function(){\n    document.getElementById("loading").style.display="none";\n    document.getElementById("editor-container").style.display="";\n\n    monaco.languages.register({id:"yiyuan-js"});\n\n    editor=monaco.editor.create(document.getElementById("editor-container"),{\n      value:"// 请在 VS Code 中打开 JS/TS 文件后使用此面板\\n",\n      language:"javascript",\n      theme:"vs-dark",\n      automaticLayout:true,\n      fontSize:13,\n      minimap:{enabled:true},\n      scrollBeyondLastLine:false,\n      overviewRulerBorder:false\n    });\n\n    // 内容变化 → debounce → 发送给扩展\n    editor.onDidChangeModelContent(function(){\n      clearTimeout(debounceTimer);\n      debounceTimer=setTimeout(function(){\n        vscode.postMessage({type:"contentChanged",content:editor.getValue()});\n      },500);\n    });\n\n    // 编辑器就绪\n    vscode.postMessage({type:"ready"});\n  });\n});\n\n// 更新装饰器\nfunction updateDecorations(annotations){\n  if(!editor)return;\n  var newDecorations=[];\n  var model=editor.getModel();\n  if(!model||!annotations||annotations.length===0){\n    decorations=editor.deltaDecorations(decorations,[]);\n    document.getElementById("anno-count").textContent="0 标注";\n    return;\n  }\n\n  annotations.forEach(function(a){\n    var line=a.line-1; // 0-indexed\n    if(line<0||line>=model.getLineCount())return;\n    var color=flowColors[a.flow]||defaultColor;\n    var label=a.metaActionId;\n\n    // 行末标注\n    newDecorations.push({\n      range:new monaco.Range(line+1,model.getLineMaxColumn(line+1),line+1,model.getLineMaxColumn(line+1)),\n      options:{\n        after:{content:" \\u00a0"+label+"\\u00a0",inlineClassName:"anno-label",hoverMessage:{value:"**"+a.metaActionName+"**\\n\\n"+a.code+"\\n\\n风险: "+a.riskLevel+" | 流: "+a.flow}},\n        overviewRuler:{color:color,position:monaco.editor.OverviewRulerLane.Right},\n        glyphMarginClassName:"anno-glyph",\n        glyphMarginHoverMessage:{value:"**"+a.metaActionName+"**\\n\\n"+a.code+"\\n\\n风险: "+a.riskLevel}\n      }\n    });\n\n    // 行高亮（整行）\n    newDecorations.push({\n      range:new monaco.Range(line+1,1,line+1,1),\n      options:{\n        isWholeLine:true,\n        className:"anno-line-"+a.flow.toLowerCase(),\n        overviewRuler:{color:color,position:monaco.editor.OverviewRulerLane.Center}\n      }\n    });\n  });\n\n  decorations=editor.deltaDecorations(decorations,newDecorations);\n  document.getElementById("anno-count").textContent=annotations.length+" 标注";\n}\n\n// 注入标注样式\nfunction injectStyles(){\n  var style=document.createElement("style");\n  style.textContent=\n    ".anno-label{font-size:10px;color:#888;margin-left:2px;opacity:.7}\\n"+\n    ".anno-line-memory{border-left:2px solid #4FC1FF;background:rgba(79,193,255,.03)}\\n"+\n    ".anno-line-control{border-left:2px solid #C586C0;background:rgba(197,134,192,.03)}\\n"+\n    ".anno-line-function{border-left:2px solid #CE9178;background:rgba(206,145,120,.03)}\\n"+\n    ".anno-line-io{border-left:2px solid #F44747;background:rgba(244,71,71,.03)}\\n"+\n    ".anno-line-resource{border-left:2px solid #6A9955;background:rgba(106,153,85,.03)}\";\n  document.head.appendChild(style);\n}\n\n// 接收消息\nwindow.addEventListener("message",function(e){\n  var msg=e.data;\n  if(!msg||!msg.type)return;\n  switch(msg.type){\n    case"init":\n      if(editor){\n        editor.setValue(msg.content||"");\n        var lang=msg.language||"javascript";\n        if(lang==="typescriptreact")lang="typescript";\n        if(lang==="javascriptreact")lang="javascript";\n        monaco.editor.setModelLanguage(editor.getModel(),lang);\n        injectStyles();\n      }\n      break;\n    case"annotations":\n      updateDecorations(msg.annotations);\n      break;\n    case"error":\n      document.getElementById("loading").style.display="flex";\n      document.getElementById("loading").innerHTML="<span style=color:var(--vscode-inputValidation-errorForeground)>"+msg.message.replace(/&/g,"&amp;").replace(/</g,"&lt;")+"</span>";\n      break;\n  }\n});\n})();\n</script>\n</body>\n</html>';
  }
}

module.exports = { EditorPanel };
