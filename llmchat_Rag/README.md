# LangGraph RAG 智能客服

FastAPI 知识库服务，提供 Embedding、Markdown 切块入库、路由、检索、答案生成和多轮会话接口。

## 安装与启动

在本目录执行（Python 3.12+）：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
if (!(Test-Path .venv)) { python -m venv .venv }
./.venv/Scripts/python.exe -m pip install -r requirements.txt
# 编辑 .env，填入真实的 HUNYUAN_API_KEY 和 EMBEDDING_API_KEY
./.venv/Scripts/python.exe server.py
```

Linux/macOS 使用 `.venv/bin/python`。也可从根目录运行 `npm run dev` 同时启动前端，或在本目录运行 `main.py` 使用终端问答。

示例中的 API Key 必须替换为实际值。若向量模型复用问答密钥，可将 `EMBEDDING_API_KEY` 留空或删除；保留示例占位值会阻止回退。首次缺库时会调用真实 Embedding 服务创建向量库，启动耗时和额度取决于文档规模及上游服务。

默认监听端口 `14052`，通过 `API_HOST`、`API_PORT` 配置。前端选择「实训四 RAG」，地址 `http://127.0.0.1:14052`。健康检查：[health](http://127.0.0.1:14052/health)；交互接口文档：[Swagger UI](http://127.0.0.1:14052/docs)。本服务不提供独立聊天网页。

根目录统一启动脚本将 RAG 绑定到 `127.0.0.1:14052`。模型和密钥取自后端配置；前端的普通对话模型与流式开关不控制 RAG。

## 配置与知识库

| 配置 | 默认值 / 说明 |
| --- | --- |
| `HUNYUAN_API_KEY` | 问答密钥，优先于 `TOKENHUB_API_KEY`、`OPENAI_API_KEY` 等别名 |
| `OPENAI_API_BASE` | `https://tokenhub.tencentmaas.com/v1` |
| `LLM_MODEL` | `hy3` |
| `LLM_STRUCTURED_METHOD` | TokenHub/混元默认 `json_schema`；可配置为 `json_schema`、`json_mode` 或 `function_calling` |
| `EMBEDDING_API_BASE` | `https://tokenhub.tencentmaas.com/v1` |
| `EMBEDDING_MODEL` | `kinfra-text-embedding-0.6b`，固定 1024 维 |
| `EMBEDDING_API_KEY` | 可独立配置，未设时回退问答密钥 |
| `EMBEDDING_BATCH_SIZE` | TokenHub 默认 64 |
| `DATA_DIR` | `./data/md`，30 篇腾讯产品文档与客服规则 |
| `PERSISTANT_STORAGE_DIR` | `./db_md`，保留原配置名的拼写 |
| `REBUILD_VECTORSTORE` | `False`，缺库自动构建，已有库默认复用 |
| `REGENERATION_THRESHOLD` / `RERETREVIAL_THRESHOLD` | 默认 5 / 3，限制再生成/再检索 |

`.env`、数据目录和数据库的相对路径均以本模块目录为基准。外部环境变量优先，不会被 `.env` 覆盖。修改 Embedding 模型或资料后，先停止服务并备份数据库，再用 `REBUILD_VECTORSTORE=True` 重建，成功后设回 `False`。重建先在相邻临时目录构建和校验，再切换到正式路径；构建失败保留旧库，切换失败恢复旧库。勿在其他进程使用同一数据库时执行。Chroma 要求 `>=1.5.9,<2`，以使用显式关闭客户端的接口。

已有库默认复用，编辑 Markdown 文件后需要重建才能更新检索内容。配置修改后需要重启服务。

## API

`GET /` 返回服务说明，`GET /health` 返回健康状态。`POST /chat` 示例：

```json
{"question":"腾讯会议如何通过会议号加入会议？","session_id":null}
```

成功返回 `session_id`、`answer`、`sources`、`steps`。追问携带上次的 `session_id`，新对话可不传。重新生成时发送最后一轮的原问题、原 `session_id` 和 `regenerate: true`，保留此前轮次，只在成功后替换最后一轮。`POST /chat/reset?session_id=...` 清理指定会话，重复执行安全；不传 ID 不会清空所有会话。

### 结构化输出与错误处理

路由及评分结果必须通过结构校验，评分只接受 `yes` 或 `no`。模型返回空内容或无效结构时，服务保留原任务并补充结构说明，最多重试一次；仍失败或模型明确拒绝判断时返回 503，拒绝判断不自动重试。失败请求不会创建新会话或覆盖已保存的历史。

| 状态码 | 含义与处理 |
| --- | --- |
| 400 | 问题或配置错误，查看响应中的 `detail`。 |
| 409 | 会话失效或重新生成的不是最后一轮；后端重启后请新建对话。 |
| 422 | 请求体不符合接口定义，检查必填字段与数据类型。 |
| 503 | 未获得有效的结构化判断结果，可稍后重试并查看服务端日志。 |
| 500 | 其他执行失败，查看服务端日志中的具体原因。 |

前端同时显示 HTTP 状态和后端 `detail`。`GET /health` 仅用于探活，实际问答效果及上游模型可用性需通过真实提问确认。

## 验证与边界

```powershell
./.venv/Scripts/python.exe -m pip check
```

已完成验证的测试代码、测试依赖清单、冒烟脚本及临时验证库已清理。当前可使用 `pip check` 检查 Python 依赖，并通过 `/health` 和实际问答确认服务状态。

会话保存在进程内存中，服务重启会清空；共享图状态通过锁串行保护，暂不支持多进程共享会话。未实现鉴权、文档上传与增量入库。流程终止和接口成功不代表所有问题的答案质量都有保证。

整组安装启动见 [项目 README](../README.md)。
