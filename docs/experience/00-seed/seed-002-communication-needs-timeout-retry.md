---
id: seed-002
version: 1.0
meta-actions: I16, F12, C8
enforce-type: lint
priority: high
status: ✅ 已入库
---
## 经验卡片 #seed-002：通信操作必须完整保护

- **触发场景：** 所有网络请求操作（fetch / axios / XMLHttpRequest / WebSocket）
- **关联元动作：** [I16 通信]、[F12 捕获]、[C8 异步]
- **问题描述：** AI 生成 fetch/axios 调用时，常遗漏 timeout 超时配置、retry 重试机制、异常处理，导致网络不可用时功能卡死或静默失败
- **根本原因：** [I16 通信] 未配置 timeout + retry，且未配对 [F12 捕获] — 网络是最高不确定性的操作，必须三层保护
- **解决方案：** 
  1. fetch 使用 AbortController + setTimeout 实现超时
  2. axios 配置 timeout 参数
  3. 外包 try-catch 或 .catch() 处理异常
  4. 实现指数退避重试机制
- **预防规则：** 任何 [I16 通信] 必须同时具备：(1) 超时配置，(2) 重试机制，(3) [F12 捕获]。蓝图自动补充，合规强制检查
- **工具链映射：** Lint 规则 — 检测 fetch/axios 调用是否有 signal/timeout + retry + try-catch
- **创建日期：** 2026-03-28
- **审核人：** 陈懿灵（白皮书提取）
