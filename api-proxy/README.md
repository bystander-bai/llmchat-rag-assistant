# OpenAI 兼容模型代理

Node.js 多 Provider 服务，提供模型列表、普通回复、SSE 转发和 OpenAI 兼容接口。

## 启动

在本目录执行：

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# 编辑 .env，至少填写一个有效的 Provider API Key
npm start
```

默认端口 `11434`，单独启动时可用 `PORT` 覆盖。根目录的 `npm run dev:proxy` 可同时启动前端，并固定代理端口为 `11434`。`.env` 和 `models.json` 相对于本模块读取，外部环境变量优先。修改后重启代理。

在前端设置中选择「实训二代理」，地址填 `http://127.0.0.1:11434`，从返回的模型列表选择模型。密钥配置在本服务的 `.env` 中，前端 API Key 可留空。单独运行前端与 RAG 时无需启动本代理。

| Provider | 密钥 | 默认上游 |
| --- | --- | --- |
| hunyuan | `HUNYUAN_API_KEY` 或 `TOKENHUB_API_KEY` | `https://tokenhub.tencentmaas.com/v1` |
| deepseek | `DEEPSEEK_API_KEY` | 见 `.env.example` |
| zhipu | `ZHIPU_API_KEY` | 见 `.env.example` |
| kimi | `KIMI_API_KEY` | 见 `.env.example` |

只有配置密钥的 Provider 会注册。模型映射见 `models.json`，文件不存在时使用内置表。可通过对应的 `*_API_URL` 覆盖上游地址。

## 接口

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 健康与 Provider 状态 |
| `GET /v1/models` | 当前可用模型 |
| `POST /v1/chat/completions` | OpenAI 格式聊天，支持 `stream: true` |

SSE 使用 `data:` 帧及 `[DONE]` 结束标记；支持文本、思考内容与用量。默认模型为 `hy3` 的使用方式和前端配置见 [项目 README](../README.md)。

已完成验证的测试文件及命令已清理。其他 Provider 需要使用各自的有效密钥后再进行实际对话验证。

## 连接排查

先访问 [健康接口](http://127.0.0.1:11434/health) 和 [模型列表](http://127.0.0.1:11434/v1/models)。如果模型列表为空，检查所选 Provider 的密钥是否已配置，以及 `models.json` 中的模型是否使用了该 Provider。接口可访问代表代理已启动，模型权限及上游额度仍需通过实际对话确认。

服务目前面向本地开发，未实现用户鉴权、限流或租户隔离，正式部署需补齐这些能力。
