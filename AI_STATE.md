# ⚠️ MADD 当前阶段：⚪ 初始化

> **下一步：执行「开始六维度探测需求」命令（`yiyuan.probe`）**
> 
> ⛔ 禁止跳步。不要直接写代码、不要 submit_plan。
> ⛔ 先执行下一步命令。

---

## 文件清单

| 文件 | 大小 |
|------|------|
| extension.js | 55045 |
| package.json | 2890 |
| src/diagnostics.js | 2363 |
| src/engine/annotator.js | 21979 |
| src/engine/checker.js | 12618 |
| src/engine/index.js | 436 |
| src/engine/loader.js | 2839 |
| src/engine/rules.json | 22526 |
| src/llm/adapters.js | 2096 |
| src/llm/deepseek.js | 5051 |
| src/llm/glm.js | 4683 |
| src/llm/index.js | 190 |
| src/llm/qwen.js | 4531 |
| src/probe/engine.js | 4189 |
| src/probe/index.js | 246 |
| src/probe/session.js | 8281 |
| src/templates.js | 6706 |
| src/webview/blueprint-panel.js | 11743 |
| src/webview/compliance-panel.js | 9685 |
| src/webview/decision-panel.js | 5292 |
| src/webview/editor-panel.js | 9923 |
| src/webview/probe-panel.js | 24693 |
| templates/blueprint.md | 2850 |
| templates/code.md | 1572 |
| templates/exp-card.md | 860 |
| templates/fix-code.md | 536 |
| templates/fix-compliance.md | 535 |
| templates/fix-test.md | 543 |
| templates/integrate.md | 627 |
| templates/probe.md | 4271 |
| templates/test.md | 1959 |

## 阶段流转

- ⚪ 初始化 → 开始六维度探测需求 ← 当前
- 🟡 BDD 就绪 → 生成语义蓝图
- 🟠 蓝图就绪 → 生成测试
- 🟣 测试就绪 → 生成测试（进入管线）
- 🟢 管线完成 → 查看合规面板
