---
id: seed-001
version: 1.0
meta-actions: I15, F12
enforce-type: lint
priority: high
status: ✅ 已入库
---
## 经验卡片 #seed-001：存储操作必须包裹异常处理

- **触发场景：** 所有涉及本地持久化存储的操作（LocalStorage / sessionStorage / IndexedDB / fs.writeFile）
- **关联元动作：** [I15 存储]、[F12 捕获]
- **问题描述：** AI 生成代码时，频繁遗漏 `localStorage.setItem()` 等存储操作的异常处理，导致配额满、数据损坏等场景下程序崩溃
- **根本原因：** [I15 存储] 未配对 [F12 捕获] — 存储操作是有失败可能的副作用操作，必须当作高风险对待
- **解决方案：** 所有存储操作必须包裹 try-catch，catch 块中触发用户可见的错误提示
- **预防规则：** 任何 [I15 存储] 必须配对 [F12 捕获]，在蓝图中自动补充，在合规审查中强制检查
- **工具链映射：** Lint 规则 — 检测 `localStorage.setItem` / `sessionStorage.setItem` / `fs.writeFile` 是否被 try-catch 包裹
- **创建日期：** 2026-03-28
- **审核人：** 陈懿灵（白皮书提取）
