// [M1 声明] 提示词模板加载器
// 代码语义元动作体系 v1.9
//
// 职责：加载 .md 模板文件并执行变量替换。
// 模板与代码分离，方便后续调优。

const fs = require('fs');
const path = require('path');

/**
 * [M20 初始化] 模板目录路径
 */
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/**
 * [F9 调用] 加载探测模板并替换变量
 *
 * @param {Object} variables
 * @param {string} variables.requirement      — 功能需求描述
 * @param {string} variables.metaActionDefs   — 元动作定义摘要
 * @param {string} [variables.experienceConstraints] — 经验卡片约束（可选）
 * @returns {string} 替换后的完整系统提示词
 */
function loadProbeTemplate(variables) {
  const template = readTemplate('probe.md');

  return replaceVariables(template, {
    requirement: variables.requirement || '（待用户描述）',
    metaActionDefs: variables.metaActionDefs || getDefaultMetaActionDefs(),
    experienceConstraints: variables.experienceConstraints || '（暂无相关经验卡片约束）'
  });
}

/**
 * [F9 调用] 加载蓝图模板并替换变量
 *
 * @param {Object} variables
 * @param {string} variables.bdd              — 全局 BDD 规格
 * @param {string} variables.metaActionDefs   — 元动作定义摘要
 * @returns {string} 替换后的完整系统提示词
 */
function loadBlueprintTemplate(variables) {
  const template = readTemplate('blueprint.md');

  return replaceVariables(template, {
    bdd: variables.bdd || '（待阶段一 BDD 生成）',
    metaActionDefs: variables.metaActionDefs || getDefaultMetaActionDefs()
  });
}

/**
 * [I15 存储] 读取模板文件
 */
function readTemplate(filename) {
  const filePath = path.join(TEMPLATES_DIR, filename);

  // [C6 条件] 文件存在性检查
  if (!fs.existsSync(filePath)) {
    throw new Error(`[意元] 模板文件不存在: ${filePath}`);
  }

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    // [F11 抛出]
    throw new Error(`[意元] 无法读取模板文件 ${filename}: ${err.message}`);
  }
}

/**
 * [M5 转换] 变量替换：{{变量名}} → 值
 */
function replaceVariables(template, variables) {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    // [C7 循环] 替换所有出现（全局替换）
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, value);
    }
  }

  return result;
}

/**
 * [M3 内存读取] 获取默认元动作定义（后备）
 */
function getDefaultMetaActionDefs() {
  return `### 内存流
- [M1] 声明：创建变量、函数、类、模块导入
- [M2] 赋值：将值存入已声明的内存变量
- [M3] 内存读取：从可信内存变量中取值
- [M4] 计算：同数据类型内的运算
- [M5] 转换：跨数据类型的变换（JSON.parse、Number()、toString()...）
- [M20] 初始化：系统启动时的状态准备、配置加载、依赖注入

### 控制流
- [C6] 条件：逻辑分支判断（if/switch/?:）
- [C7] 循环：重复执行逻辑（for/while/map/forEach）
- [C8] 异步：非阻塞等待、并发控制（await/then/setTimeout）

### 函数流
- [F9] 调用：执行函数或方法
- [F10] 返回：退出函数作用域并返回值
- [F11] 抛出：主动引发错误
- [F12] 捕获：拦截异常（try-catch/.catch）
- [F19] 副作用：非 IO 类的内部状态变更

### 交互流
- [I13] 渲染：输出到 UI/控制台/日志
- [I14] 用户输入：所有外部不可信源的数据接收
- [I15] 存储：本地持久化操作（localStorage/IndexedDB/fs）
- [I16] 通信：网络交互操作（fetch/axios/WebSocket）

### 资源流
- [R17] 绑定：运行时建立事件监听/观察者/连接
- [R18] 清理：释放资源、解除绑定、复位状态

### 强制配对规则
- [I15 存储] → 必须包裹 try-catch [F12 捕获]
- [I16 通信] → 必须带 timeout + retry + [F12 捕获]
- [R17 绑定] → 必须有对应的 [R18 清理]
- [I14 用户输入] → 必须调用 validate() 和 sanitize()
- [M5 转换] → JSON.parse 必须包裹 try-catch [F12 捕获]`;
}

/**
 * [F9 调用] 加载测试模板并替换变量
 *
 * @param {Object} variables
 * @param {string} variables.blueprint      — 语义蓝图内容
 * @param {string} variables.metaActionDefs — 元动作定义摘要
 * @param {string} variables.testFramework  — 测试框架（jest/vitest）
 * @param {string} variables.sourceFile     — 源文件路径
 * @returns {string} 替换后的完整系统提示词
 */
function loadTestTemplate(variables) {
  const template = readTemplate('test.md');

  return replaceVariables(template, {
    blueprint: variables.blueprint || '（无蓝图）',
    metaActionDefs: variables.metaActionDefs || getDefaultMetaActionDefs(),
    testFramework: variables.testFramework || 'jest',
    sourceFile: variables.sourceFile || '（未知）'
  });
}

/**
 * [F9 调用] 加载代码生成模板并替换变量
 */
function loadCodeTemplate(variables) {
  const template = readTemplate('code.md');
  return replaceVariables(template, {
    blueprint: variables.blueprint || '（无蓝图）',
    metaActionDefs: variables.metaActionDefs || getDefaultMetaActionDefs(),
    sourceFile: variables.sourceFile || '（未知）'
  });
}

function loadFixTestTemplate(vars) {
  return replaceVariables(readTemplate('fix-test.md'), {
    blueprint: vars.blueprint || '', currentCode: vars.currentCode || '', testErrors: vars.testErrors || ''
  });
}
function loadFixCodeTemplate(vars) {
  return replaceVariables(readTemplate('fix-code.md'), {
    blueprint: vars.blueprint || '', currentCode: vars.currentCode || '', testErrors: vars.testErrors || ''
  });
}
function loadFixComplianceTemplate(vars) {
  return replaceVariables(readTemplate('fix-compliance.md'), {
    blueprint: vars.blueprint || '', currentCode: vars.currentCode || '', violations: vars.violations || ''
  });
}
function loadExpCardTemplate(vars) {
  return replaceVariables(readTemplate('exp-card.md'), {
    sourceFile: vars.sourceFile || '', fixedViolations: vars.fixedViolations || '', blueprintSection: vars.blueprintSection || ''
  });
}
function loadIntegrateTemplate(vars) {
  return replaceVariables(readTemplate('integrate.md'), {
    bdd: vars.bdd || '', fileManifest: vars.fileManifest || '', sourceFiles: vars.sourceFiles || ''
  });
}

// [F10 返回] 导出
module.exports = { loadProbeTemplate, loadBlueprintTemplate, loadTestTemplate, loadCodeTemplate, loadFixTestTemplate, loadFixCodeTemplate, loadFixComplianceTemplate, loadExpCardTemplate, loadIntegrateTemplate };
