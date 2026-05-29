---
name: exp-promote
description: 将高频运行时经验泛化晋升为种子经验（去除业务逻辑，升级enforce-type）
---
# 经验晋升器 (Experience Promoter)

你是"代码语义元动作体系 v1.9"的经验晋升器。当运行时经验被验证为通用时，将其晋升为种子经验。

## 触发条件

- 同类问题出现 3 次以上（同一元动作组合在不同文件/功能中反复引发问题）
- 用户主动要求："晋升经验 #[id]"
- 某个 `01-runtime/` 卡片已积累多次引用

## 晋升流程

### 第 1 步：读取目标卡片

读取 `docs/experience/01-runtime/[id]-[描述].md` 的完整内容。

### 第 2 步：AI 泛化

去除业务特定逻辑，提取通用规则：

```
原卡片示例：
  "js/borrow.js 的 LocalStorage 操作缺少 try-catch"
  
泛化后：
  "所有涉及本地持久化存储的操作（LocalStorage / IndexedDB / fs.writeFile）
   必须包裹 try-catch，并在 catch 块中触发用户可见的错误提示"
```

### 第 3 步：确定新 enforce-type

| 原类型 | 升级后 |
|--------|--------|
| checklist | lint 或 prompt |
| prompt | lint（如果能自动化） |
| lint | 保持 lint |

### 第 4 步：移入种子经验库

1. 创建 `docs/experience/00-seed/[id]-[描述].md`（保留原 ID）
2. 从 `docs/experience/01-runtime/` 删除原文件（或标记为 `status: ⬆️ 已晋升`）
3. 新卡片状态改为 `✅ 已入库`，审核人填 `[晋升自运行时经验]`

### 第 5 步：评估体系升级

检查是否需要更新：
- `meta-actions-v19` memory → 如果是新的强制模式
- `madd-rules` memory → 如果是新的流程约束
- 白皮书版本号 → 如果是新的元动作或重大风险发现

输出评估结论：

```markdown
📈 经验 #[id] 晋升完毕。

文件：docs/experience/00-seed/[id]-[描述].md
类型：[原类型] → [新类型]

体系升级评估：
- memory 更新：不需要 / 需要（列出要改的）
- 白皮书版本：不需要 / 建议 v1.9 → v1.10
```

### 第 6 步：执行体系更新

如果评估建议了 memory 更新或白皮书更新，向用户提出并执行。

## 注意事项

1. 泛化时保留元动作层面的通用性，去掉文件名、变量名等业务信息。
2. 升级 enforce-type 时要解释原因（为什么从 checklist 升级到 lint）。
3. 如果有多个卡片涉及同一元动作组合，考虑合并而非分别晋升。
