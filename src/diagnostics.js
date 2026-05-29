// [M1 声明] 诊断转换器 — toDiagnostics(violations) → vscode.Diagnostic[]
// 代码语义元动作体系 v1.9
//
// 职责：将违规项转换为 VS Code Diagnostic 对象，输出到 PROBLEMS 面板。
// 依赖 VS Code API 类型，但不依赖 VS Code 运行时（纯转换函数）。

const vscode = require('vscode');

/**
 * [M5 转换] 将 Violation[] 转换为 VS Code Diagnostic[]
 *
 * @param {Violation[]} violations — check() 返回的违规列表
 * @param {vscode.TextDocument} document — 当前文档（用于计算 Range）
 * @returns {vscode.Diagnostic[]}
 */
function toDiagnostics(violations, document) {
  // [C6 条件] 无违规直接返回空数组
  if (!violations || violations.length === 0) {
    return [];
  }

  // [C7 循环] 逐项转换
  return violations.map(v => {
    // [M4 计算] 计算 VS Code Range（1-indexed → 0-indexed）
    const line = Math.max(0, v.line - 1);
    const column = Math.max(0, v.column - 1);

    // 获取行的实际长度以确保 Range 有效
    const lineText = document.lineAt(line).text;
    const endColumn = Math.min(lineText.length, column + 40);

    const range = new vscode.Range(line, column, line, endColumn);

    // [M5 转换] severity 字符串 → vscode.DiagnosticSeverity
    const severity = mapSeverity(v.severity);

    // [M1 声明] 创建 Diagnostic
    const diagnostic = new vscode.Diagnostic(
      range,
      `[${v.metaActionId}] ${v.message}`,
      severity
    );

    // [M2 赋值] 设置来源
    diagnostic.source = '意元';
    diagnostic.code = v.rule;

    // [M2 赋值] 设置相关链接（修复建议）
    if (v.suggestion) {
      diagnostic.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(document.uri, range),
          `💡 ${v.suggestion}`
        )
      ];
    }

    return diagnostic;
  });
}

/**
 * [M5 转换] 将字符串严重级别映射为 VS Code DiagnosticSeverity
 */
function mapSeverity(severity) {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

// [F10 返回] 导出
module.exports = { toDiagnostics };
