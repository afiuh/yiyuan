---
id: seed-003
version: 1.0
meta-actions: R17, R18
enforce-type: lint
priority: high
status: ✅ 已入库
---
## 经验卡片 #seed-003：资源绑定必须配对清理

- **触发场景：** 所有事件监听、观察者模式、定时器的注册（addEventListener / .on() / setTimeout / setInterval / MutationObserver）
- **关联元动作：** [R17 绑定]、[R18 清理]
- **问题描述：** AI 频繁添加 addEventListener 但从不写对应的 removeEventListener，导致内存泄漏、重复绑定、组件卸载后残留事件
- **根本原因：** [R17 绑定] 未配对 [R18 清理] — 每创建一个资源绑定，就产生一个需要在适当时机释放的责任
- **解决方案：** 
  1. addEventListener → 组件卸载/清理函数中 removeEventListener
  2. setTimeout → clearTimeout（组件卸载时）
  3. setInterval → clearInterval
  4. MutationObserver → .disconnect()
  5. .on() → .off()
- **预防规则：** 任何 [R17 绑定] 必须配对 [R18 清理]，在同一个函数作用域或同一组件的生命周期内闭合。蓝图自动补充，合规强制检查
- **工具链映射：** Lint 规则 — 检测 addEventListener 是否有对应 removeEventListener，setTimeout 是否有 clearTimeout
- **创建日期：** 2026-03-28
- **审核人：** 陈懿灵（白皮书提取）
