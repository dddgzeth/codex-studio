# 浏览器化终端编程 Agent 技术架构 v0.2

## 文档定位

这份文档只讨论技术架构，不重复产品目标细节。

对应关系：

- [product-scheme.md](/Users/congjian/6_projects/markdown_html/product-scheme.md:1) 负责产品方案和体验边界
- `technical-architecture.md` 负责工程实现、模块拆分、数据流和扩展策略

当前目标是先支持 `Codex`，但架构必须保留扩展到 `Claude Code` 的能力。

同时明确两个约束：

- `Gemini` 会参与设计期和动态渲染协议设计期，但不进入产品运行时主链路
- 浏览器化之后必须尽量保持原有 `CLI` 使用能力，尤其不能把斜杠命令能力做丢

## 核心架构目标

第一版架构需要同时满足 6 个目标：

1. 浏览器是主交互界面
2. 本地服务托管 agent 进程，而不是让用户操作终端
3. 支持多会话并行
4. 支持长期本地历史保留
5. 支持结构化渲染和少量自定义 HTML 渲染
6. 后续可扩展到多 agent

## 设计期模型使用原则

`Gemini` 在这个项目里不是运行时依赖，而是开发期辅助能力。

明确分成两类：

### 1. 允许使用 `Gemini` 的阶段

- 前端视觉方案探索
- 页面布局与交互风格探索
- 动态渲染协议设计阶段
- 内容块视觉语言设计
- UI 文案与信息组织方案探索

### 2. 不使用 `Gemini` 的阶段

- 用户真实会话运行时
- 本地服务调度
- agent 会话转发
- 历史存储与恢复
- 最终用户的模型调用链路

工程结论：

- `Gemini` 用于“把产品设计得更好看、更顺手”
- 不用于“替代用户实际选择的 agent / model”
- 产品开发完成后，最终用户仍然使用自己选择的 agent 和模型

## 总体分层

建议采用四层架构：

1. 浏览器前端层
2. 本地应用服务层
3. agent 适配层
4. 本地持久化层

### 1. 浏览器前端层

职责：

- 会话界面
- 多会话标签与切换
- 项目上下文面板
- 动态渲染内容块
- 当前会话状态展示
- 单会话内查找
- 导出入口
- 保持原始输入语义不过度改写

边界：

- 不直接管理 agent 进程
- 不承担完整历史的唯一存储责任
- 不直接解析不同 agent 的原始输出协议

### 2. 本地应用服务层

职责：

- 暴露本地 HTTP / WebSocket 接口
- 管理会话生命周期
- 启动与回收 agent 进程
- 统一处理消息流
- 管理历史写入
- 管理导出
- 向前端推送结构化事件
- 保留对原始输入链路的透传能力

边界：

- 不包含强耦合的单一 agent 逻辑
- 不直接承载前端渲染细节

### 3. agent 适配层

职责：

- 封装不同 agent 的启动方式
- 封装输入发送方式
- 封装输出解析方式
- 把不同 agent 的原始输出转成统一事件流
- 处理 session 兼容读取
- 兼容 agent 原生命令语义，包括斜杠命令

这是后续扩展 `Claude Code` 的关键层。

### 4. 本地持久化层

职责：

- 持久化会话
- 持久化消息
- 持久化事件
- 持久化项目元数据
- 持久化导出记录
- 为搜索预留索引结构

## 运行模型

### 1. 基本运行方式

推荐模式：

- 用户启动本地服务
- 本地服务打开或提示打开浏览器页面
- 浏览器连接本地服务
- 用户在浏览器里发起新会话
- 本地服务创建对应 agent runtime
- agent 输出持续转成结构化事件并推给前端

### 2. 多会话模型

每个会话对应一个独立 runtime。

runtime 至少包含：

- session id
- agent type
- workspace path
- process handle
- state
- event stream
- history writer

每个 runtime 独立存在，互不阻塞。

推荐状态机：

- `idle`
- `starting`
- `running`
- `waiting_input`
- `summarizing`
- `completed`
- `failed`
- `terminated`

### 3. 进程管理原则

- 一个会话对应一个独立 agent 进程或进程组
- 本地服务负责标准化启动参数
- 本地服务负责超时、异常退出、手动停止
- 前端只感知状态，不直接操作系统进程

## 模块拆分建议

### 1. 前端模块

- `app-shell`
  负责整体布局与路由
- `session-list`
  负责会话列表和最近会话
- `session-view`
  负责当前会话消息流
- `composer`
  负责输入框、模式选择、发送
- `context-panel`
  负责项目上下文、文件、状态
- `render-blocks`
  负责动态内容块渲染
- `export-panel`
  负责导出

### 2. 本地服务模块

- `api-server`
  提供 HTTP API
- `realtime-gateway`
  提供 WebSocket 或 SSE
- `session-manager`
  管理会话和 runtime 生命周期
- `agent-runtime-manager`
  管理 agent 进程与 IO
- `history-manager`
  管理消息和事件持久化
- `export-manager`
  处理 Markdown / HTML 导出
- `project-context-service`
  收集当前项目上下文
- `command-compatibility-layer`
  保证原始输入与 agent 原生命令能力兼容

### 3. agent 适配层模块

- `agent-adapter-interface`
  定义统一接口
- `codex-adapter`
  第一版唯一正式实现
- `session-importer`
  导入和识别已有 session
- `event-normalizer`
  将原始输出归一化

## agent 适配层接口建议

建议内部统一定义一个 adapter interface。

至少包含：

- `startSession(config)`
- `sendInput(sessionId, input)`
- `interrupt(sessionId)`
- `terminate(sessionId)`
- `streamEvents(sessionId)`
- `loadSession(sessionId)`
- `importExternalSessions()`

并且需要满足一个兼容性原则：

- 对用户原始输入尽量透传
- 不在 adapter 层强行改写斜杠命令
- 如需在浏览器增加增强语法，必须和 agent 原生命令显式区分

这样后续扩展 `Claude Code` 时，只需要新增一个 adapter，而不是改动主系统。

## 数据流

### 1. 新会话流程

1. 前端发起 `create session`
2. 本地服务创建 session record
3. `session-manager` 分配 runtime
4. `codex-adapter` 启动 agent
5. agent 输出进入 `event-normalizer`
6. 标准事件写入历史
7. 标准事件推送给前端
8. 前端按块渲染

### 2. 用户输入流程

1. 用户在前端输入 prompt
2. 前端发送 `send input`
3. 本地服务写入 user message
4. `command-compatibility-layer` 判断是否为浏览器侧自定义命令
5. 若不是浏览器自定义命令，则原样透传给 agent
6. adapter 将输入发给 agent
7. agent 输出流式返回
8. 事件归一化、持久化、推送

这里的关键原则是：

- 默认优先保留 agent 自身输入语义
- 对 `/xxx` 形式的输入必须谨慎处理
- 不能因为浏览器包装层存在，就破坏 `CLI` 斜杠命令能力

### 3. 历史恢复流程

1. 前端请求会话列表
2. 本地服务返回 session summaries
3. 前端打开某会话
4. 本地服务分页返回消息与事件
5. 前端重建会话视图

## 统一事件模型

前端不要直接消费 agent 原始 stdout，而应消费统一事件。

建议第一版事件类型：

- `session_created`
- `session_state_changed`
- `user_message`
- `assistant_message_started`
- `assistant_block`
- `assistant_message_completed`
- `tool_event`
- `log_chunk`
- `file_change_event`
- `summary_event`
- `error_event`
- `export_completed`

统一事件至少应包含：

- `event_id`
- `session_id`
- `agent_type`
- `timestamp`
- `event_type`
- `payload`

这样能保证：

- 前端渲染逻辑稳定
- 历史回放稳定
- 后续多 agent 接入时不需要重写前端

## 动态渲染协议

前端渲染基于“内容块”而不是整段 HTML。

这部分在设计阶段可以使用 `Gemini` 辅助完成，目标不是让 `Gemini` 参与运行时渲染，而是帮助我们在开发期定义：

- 哪些内容块最符合大众审美
- 哪些内容块最适合高信息密度场景
- 不同块之间的视觉层级和排版节奏
- 什么样的复杂结果适合进入 `html_fragment`

建议第一版块类型：

- `markdown`
- `code`
- `diff`
- `table`
- `checklist`
- `callout`
- `timeline`
- `task_status`
- `log`
- `file_change_summary`
- `artifact`
- `html_fragment`

建议块结构至少包含：

- `block_id`
- `block_type`
- `title`
- `data`
- `meta`

说明：

- `markdown`、`code`、`diff` 等标准块优先
- `html_fragment` 作为例外能力
- 不建议让 agent 默认直接返回整页 HTML

开发期可以让 `Gemini` 参与的事项：

- 动态块视觉设计
- 卡片结构设计
- 复杂结果页面编排
- 组件视觉一致性审阅

但运行时仍然遵循：

- 用户用什么 agent，就由什么 agent 负责内容输出
- 浏览器只做渲染，不在运行时再引入 `Gemini`

## `html_fragment` 隔离策略

### 1. 为什么需要隔离

如果 `html_fragment` 不隔离，可能出现：

- 全局样式污染
- 布局冲突
- 非预期脚本执行
- 事件监听越界
- 页面性能下降

因此技术原则应该是：

**主应用壳层与 agent 生成 HTML 必须解耦。**

### 2. 第一版建议策略

- 默认禁止脚本执行
- 默认限制样式作用域
- 限制可用标签和属性范围
- 渲染错误仅影响当前块
- 前端保留降级显示能力

### 3. 渐进开放策略

后续如果确实需要更自由的富布局能力，可以按等级开放：

- Level 1: 只允许安全静态 HTML
- Level 2: 允许有限样式能力
- Level 3: 允许受控交互组件

第一版建议只做 `Level 1`。

## 历史存储架构

### 1. 为什么要分层

你的产品既要“快”，又要“稳”。

所以历史不能只存在浏览器内存里，也不建议只存在浏览器本地缓存里。

建议采用两层：

- 浏览器本地缓存层
- 本地服务持久化层

### 2. 浏览器本地缓存层

职责：

- 保存最近会话摘要
- 保存当前会话视图状态
- 支持刷新恢复
- 缓存最近读取的消息片段

特点：

- 面向体验优化
- 面向快速打开
- 可被清理和重建

### 3. 本地服务持久化层

职责：

- 保存完整历史
- 保存结构化事件
- 保存消息块
- 保存元数据
- 为后续搜索预留索引

特点：

- 面向正式存档
- 面向可靠恢复
- 不依赖某个浏览器实例

### 4. MVP 搜索边界

MVP 建议只做：

- 单会话内基础查找
- 会话列表浏览
- 按项目或时间定位会话

MVP 后高优先级再做：

- 全局历史搜索
- 按命令筛选
- 按文件筛选
- 按错误筛选
- 命中高亮
- 跳转定位

## 数据模型建议

第一版至少要有下面几类核心实体：

### 1. Session

字段方向：

- `session_id`
- `agent_type`
- `workspace_path`
- `title`
- `created_at`
- `updated_at`
- `status`
- `last_message_preview`

### 2. Message

字段方向：

- `message_id`
- `session_id`
- `role`
- `content_raw`
- `content_summary`
- `created_at`

### 3. RenderBlock

字段方向：

- `block_id`
- `message_id`
- `block_type`
- `payload`
- `order_index`

### 4. Event

字段方向：

- `event_id`
- `session_id`
- `event_type`
- `payload`
- `created_at`

## 项目上下文采集

第一版建议项目上下文只做“必要可见”，不要一开始做成完整 IDE。

推荐采集：

- 当前工作目录
- 当前会话涉及文件
- 修改文件列表
- 最近执行命令
- agent 当前状态
- 最近关键事件

不建议 MVP 一开始就做：

- 完整 IDE 编辑器
- 复杂多面板文件编辑
- 全量项目索引

## 导出架构

MVP 只做两种导出：

- Markdown
- HTML

实现建议：

- 导出不直接依赖当前 DOM
- 导出基于统一消息和渲染块数据生成
- 这样可以保证导出稳定，不受页面当前状态影响

## 推荐技术方向

这里只给方向，不在这份文档里强行定死具体库。

### 前端

推荐要求：

- 支持流式更新
- 支持复杂组件状态
- 支持本地缓存
- 支持高质量渲染
- 视觉质量必须达到可公开开源展示的水准
- 界面风格要符合大众审美，避免明显的工具感拼凑
- 复杂信息展示要清晰，不靠堆字

### 本地服务

推荐要求：

- 易于管理本地子进程
- 易于做 WebSocket / SSE
- 易于做本地文件持久化
- 易于抽象 adapter

### 存储

推荐要求：

- 本地可持久化
- 支持结构化查询
- 后续可加搜索索引

## 非功能性要求

第一版至少应满足：

- 会话恢复稳定
- 长会话不明显卡顿
- 多会话互不干扰
- 单个渲染块异常不拖垮整页
- agent 异常退出后界面可恢复
- 浏览器刷新后状态可恢复
- 原始 `CLI` 斜杠命令能力不被破坏
- 前端 UI 达到高完成度，不只是“能用”

## UI / UX 质量要求

这不是附属要求，而是核心要求。

第一版前端必须满足：

- 整体视觉足够好看，适合开源项目公开展示
- 信息密度高，但不脏乱
- 对复杂输出有清晰层级
- 对普通输出有稳定、舒适的阅读体验
- 多会话切换直观
- 项目上下文展示自然，不像临时拼接面板

这里允许在开发期显式使用 `Gemini` 做设计辅助，以提高：

- 首屏布局质量
- 内容块视觉一致性
- 复杂结果页编排
- 交互细节完成度

## MVP 技术闭环

MVP 技术上建议先打通这条链路：

1. 本地服务启动
2. 浏览器连接本地服务
3. 浏览器发起 `Codex` 会话
4. 本地服务托管 `Codex`
5. agent 输出转成统一事件
6. 前端按内容块渲染
7. 会话写入正式历史
8. 页面刷新后可恢复
9. 支持多会话并行
10. 支持导出 Markdown / HTML

## 后续演进顺序

建议按下面顺序推进：

1. 跑通 `Codex` 单会话闭环
2. 补齐多会话并行
3. 补齐长期历史与恢复
4. 补齐动态渲染块
5. 补齐单会话查找
6. 补齐导出
7. 再做全局历史搜索
8. 再做 `Claude Code` adapter
