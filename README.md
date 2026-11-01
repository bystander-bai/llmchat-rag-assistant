# 企业知识库智能客服

基于 React、FastAPI 和 LangGraph 的客服工作台，支持模型对话和本地知识库问答。知识库覆盖企业微信、腾讯会议、腾讯云服务器、腾讯云对象存储、微信小程序及课程客服规则，适合本地运行、教学演示和继续开发。

最近更新：2026-11-01。

## 主要功能

- **三种连接模式**：直连 TokenHub、通过 Node.js 代理访问模型、通过 RAG 服务查询知识库。
- **知识库问答**：文档检索、相关性判断、答案生成与校验，展示引用来源和执行步骤。
- **连续对话**：结合上下文理解追问，支持重新生成最后一轮回答。
- **聊天工作台**：多会话、本地记录保存、Markdown 和代码高亮；普通模型对话支持流式响应。
- **错误提示**：前端显示后端错误详情；RAG 结构化输出为空或无效时自动重试一次，仍失败则返回可重试提示。


## 项目结构

| 目录 | 职责 | 技术 | 默认端口 |
| --- | --- | --- | --- |
| `llm-chat` | 客服工作台、普通/流式对话、RAG 来源与步骤展示 | React 18、TypeScript、Vite、Zustand | 3098 |
| `api-proxy` | 模型列表、多 Provider 转发、OpenAI 兼容接口 | Node.js | 11434 |
| `llmchat_Rag` | 文档切块、向量检索、自适应问答、多轮会话 | FastAPI、LangGraph、Chroma | 14052 |
| `scripts` | 统一启动、代码与依赖检查 | Node.js | — |
| `llmchat_Rag/data/md` | Markdown 知识资料，目前共 30 篇 | Markdown | — |
| `llmchat_Rag/db_md` | 运行时创建或复用的正式向量库 | Chroma | — |

前端支持三条调用路径：直连模式经 Vite `/tokenhub` 代理访问 TokenHub；代理模式经 Node 服务访问模型；RAG 模式直接调用 Python 服务。RAG 不依赖 Node 代理。

## 快速启动

### 1. 安装依赖

需要 Node.js 20+、npm 和 Python 3.12+。以下命令使用 **Windows PowerShell**，在项目根目录执行：

```powershell
npm --prefix llm-chat ci
npm --prefix api-proxy ci
if (!(Test-Path llmchat_Rag/.venv)) { python -m venv llmchat_Rag/.venv }
./llmchat_Rag/.venv/Scripts/python.exe -m pip install -r llmchat_Rag/requirements.txt
```

根目录只提供脚本入口，不需要运行 `npm install`。仅使用前端与 RAG 时，可跳过 `api-proxy` 的安装。Linux/macOS 创建虚拟环境可使用 `python3 -m venv llmchat_Rag/.venv`，随后将 Python 路径换为 `llmchat_Rag/.venv/bin/python`；下方复制配置的 PowerShell 命令需换为对应 shell 的文件复制命令。

### 2. 填写配置

仅在 `.env` 不存在时复制示例，已有配置请保留：

```powershell
if (!(Test-Path api-proxy/.env)) { Copy-Item api-proxy/.env.example api-proxy/.env }
if (!(Test-Path llmchat_Rag/.env)) { Copy-Item llmchat_Rag/.env.example llmchat_Rag/.env }
```

使用 RAG 时，编辑 `llmchat_Rag/.env`，将 `HUNYUAN_API_KEY` 和 `EMBEDDING_API_KEY` 的占位值替换为实际密钥。两者可使用同一把有对应模型权限的密钥；如需自动回退问答密钥，应将 `EMBEDDING_API_KEY` 留空或删除该项，不能保留示例占位值。

使用 Node 代理时，在 `api-proxy/.env` 中配置所选 Provider 的密钥，例如 `HUNYUAN_API_KEY`。使用直连模式时，在前端设置中填写 API Key。详细配置见下文及各模块 README。

环境变量优先于模块 `.env`。后端配置文件、知识库和向量库路径以模块目录为基准，不依赖启动时所在目录。真实 `.env`、依赖、构建产物和向量库已列入 `.gitignore`。

### 3. 启动服务

```powershell
npm run dev         # 前端 + RAG
npm run dev:proxy   # 前端 + Node 代理
npm run dev:all     # 前端 + 两个后端
```

### 4. 选择模式并开始对话

打开 [客服工作台](http://127.0.0.1:3098)，进入右上角「设置」。首次使用默认是「直连 API」；运行 `npm run dev` 后，需要手动选择「实训四 RAG」。已有用户会沿用浏览器保存的模式。

| 模式 | 设置 | 能力 |
| --- | --- | --- |
| 实训四 RAG | `http://127.0.0.1:14052`，密钥和模型在后端配置 | 知识库问答、多轮追问、引用来源、执行步骤；非流式 |
| 实训二代理 | `http://127.0.0.1:11434`，模型 `hy3` | 普通或 SSE 流式对话 |
| 直连 API | `/tokenhub/v1`，填写 API Key，默认模型 `hy3` | 通过 Vite 开发代理访问 TokenHub |

点击「测试连接」，然后打开右下角客服窗口。可以先提问“腾讯会议如何通过会议号加入会议？”，再追问“桌面端具体怎么操作？”，查看回答、引用来源与执行步骤。真实问答和首次建库会调用模型 API，使用账户额度。

RAG 的「测试连接」只检查服务是否可访问，模型权限和回答效果需要通过实际问答确认。

统一启动脚本检查依赖和端口占用，固定使用上述三个端口。按 Ctrl+C 或输入 `stop` 回车结束整组服务。模块也可分别启动，见各自 README。

刷新页面后会保留本地聊天记录，并清除中断请求的加载状态。RAG 上下文保存在后端内存中：重新生成沿用原 `session_id`，只替换最后一轮回答；生成失败时保留原历史。后端重启后上下文会丢失，本地显示的旧消息不会自动恢复服务端历史。

## RAG 配置

配置文件为 `llmchat_Rag/.env`，模板见 [.env.example](llmchat_Rag/.env.example)。

| 配置项 | 默认值或用途 |
| --- | --- |
| `HUNYUAN_API_KEY` | 问答密钥；也支持 `TOKENHUB_API_KEY`、`OPENAI_API_KEY` 等别名 |
| `OPENAI_API_BASE` | `https://tokenhub.tencentmaas.com/v1` |
| `LLM_MODEL` | `hy3` |
| `LLM_STRUCTURED_METHOD` | TokenHub/混元默认 `json_schema`，用于路由与评分 |
| `EMBEDDING_API_KEY` | 向量模型密钥；未填写时回退问答密钥 |
| `EMBEDDING_API_BASE` | `https://tokenhub.tencentmaas.com/v1` |
| `EMBEDDING_MODEL` | `kinfra-text-embedding-0.6b`，固定 1024 维 |
| `EMBEDDING_BATCH_SIZE` | TokenHub 默认每批 64 条 |
| `DATA_DIR` | `./data/md` |
| `PERSISTANT_STORAGE_DIR` | `./db_md`，沿用代码中的配置名拼写 |
| `REBUILD_VECTORSTORE` | `False`，已有库默认复用 |
| `REGENERATION_THRESHOLD` / `RERETREVIAL_THRESHOLD` | `5` / `3`，限制答案再生成和再检索次数 |

修改后重启对应服务。统一启动脚本固定前端 `3098`、RAG `14052`、代理 `11434`；单独启动后端时可通过 `API_PORT` 或 `PORT` 调整，并同步修改前端设置。

## 知识库维护

首次启动若没有向量库，RAG 会读取 `llmchat_Rag/data/md` 下的 Markdown 文档，切块并调用 Embedding 服务建库；之后复用 `db_md`，编辑资料不会自动更新已有向量库。

更新资料或更换向量模型时：

1. 停止使用该向量库的 RAG 进程，备份 `llmchat_Rag/db_md`。
2. 更新 Markdown 文件或模型配置，在 `llmchat_Rag/.env` 中设置 `REBUILD_VECTORSTORE=True`。
3. 启动 RAG，等待新库构建、校验和服务初始化完成。
4. 成功后将 `REBUILD_VECTORSTORE` 改回 `False`，避免下次启动重复建库。

新库先在相邻临时目录构建并校验，成功后切换；构建或切换失败时保留或恢复旧库。重建期间应确保其他进程未占用同一数据库。

## 代码与依赖检查

```powershell
npm run check       # ESLint、TypeScript、前端构建、pip check
```

该命令需要已安装前端依赖和 RAG 虚拟环境，执行 ESLint、TypeScript 检查、Vite 构建与 `pip check`，不调用模型 API。检查日志在执行时生成于 `artifacts/check/`。

当前项目已清理完成验证的测试代码、专用依赖、验证脚本和生成产物；保留上述代码检查及构建入口。

历史验证产物已按要求清理；当前安装、启动和检查方式以本 README 及各模块 README 为准。

## 常见问题

| 现象 | 排查或处理方式 |
| --- | --- |
| 启动提示端口占用 | 先结束占用对应端口的旧服务，再执行统一启动命令。 |
| RAG 无法连接 | 确认后端初始化完成，访问 [RAG 健康接口](http://127.0.0.1:14052/health)，核对前端地址与模式。 |
| 代理模型列表为空 | 检查 `api-proxy/.env` 是否配置所选 Provider 密钥，以及 `models.json` 是否有对应模型。 |
| RAG 返回 400 | 查看聊天气泡中的具体错误；检查问题是否为空、配置值及密钥是否仍包含占位说明。 |
| RAG 返回 503 | 路由或评分未返回有效结构化结果，或模型拒绝判断。空/无效结果已自动重试一次，可稍后重试并查看后端日志。 |
| 重新生成返回 409 | 会话已失效或所选问题不是最后一轮。后端重启后请新建对话。 |
| RAG 返回 500 | 查看启动 RAG 的终端日志，检查上游模型、检索服务及配置。 |
| 刷新后看到旧消息，但追问失去上下文 | 浏览器记录和后端会话分别保存；后端重启会清空上下文。 |
| 首次启动或回复较慢 | 首次建库需要调用 Embedding；RAG 一次问答包含多次模型调用，且后端问答按顺序执行。 |

## 构建与部署

```powershell
npm --prefix llm-chat run build
npm --prefix llm-chat run preview -- --host 127.0.0.1 --port 3099 --strictPort
```

静态产物在 `llm-chat/dist/`。Vite 开发代理 `/tokenhub` 不会随静态文件部署，正式环境需要配置反向代理，或使用 Node 代理/RAG 接口，并配置可访问的后端地址。

## 当前能力边界

RAG 会话保存在单进程内存中，重启丢失且调用串行，暂不支持多进程共享。当前没有用户鉴权、租户隔离、持久化会话、真实人工坐席和文档上传/增量入库；附件按钮仅提供本地预览。知识库中的课程客服规则用于教学演示，模型回答质量取决于知识资料与上游服务。

## 文档入口

- [前端说明](llm-chat/README.md)
- [代理说明](api-proxy/README.md)
- [RAG 说明](llmchat_Rag/README.md)

当前安装、启动与检查方式以本 README 和各模块 README 为准。
