#!/usr/bin/env node


import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { ColorConsole } from './console.js';

global.console = new ColorConsole({
    stdout: process.stdout,
    stderr: process.stderr,
    timestamp: process.env.NODE_ENV !== 'production',
});

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(PROJECT_DIR, '.env') });

const PORT = process.env.PORT || 11434;

const providers = {};

const hunyuanApiKey = process.env.HUNYUAN_API_KEY || process.env.TOKENHUB_API_KEY;
if (hunyuanApiKey) {
    providers.hunyuan = createOpenAI({
        apiKey: hunyuanApiKey,
        baseURL: process.env.HUNYUAN_API_URL || process.env.TOKENHUB_API_URL
            || 'https://tokenhub.tencentmaas.com/v1',
        compatibility: 'compatible',
        name: 'hunyuan',
    });
}

if (process.env.DEEPSEEK_API_KEY) {
    providers.deepseek = createOpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
        compatibility: 'compatible',
        name: 'deepseek',
    });
}

if (process.env.ZHIPU_API_KEY) {
    providers.zhipu = createOpenAI({
        apiKey: process.env.ZHIPU_API_KEY,
        baseURL: process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4',
        compatibility: 'compatible',
        name: 'zhipu',
    });
}

if (process.env.KIMI_API_KEY) {
    providers.kimi = createOpenAI({
        apiKey: process.env.KIMI_API_KEY,
        baseURL: process.env.KIMI_API_URL || 'https://api.moonshot.cn/v1',
        compatibility: 'compatible',
        name: 'kimi',
    });
}

if (Object.keys(providers).length === 0) {
    console.error('❌ No API keys found. Set HUNYUAN_API_KEY (TokenHub) or other provider keys');
    process.exit(1);
}

const DEFAULT_MODELS_PATH = path.join(PROJECT_DIR, 'models.json');

let models = {};
try {
    if (fs.existsSync(DEFAULT_MODELS_PATH)) {
        models = JSON.parse(fs.readFileSync(DEFAULT_MODELS_PATH, 'utf8'));
        console.log(`✅ Loaded models from ${DEFAULT_MODELS_PATH}`);
    } else {
        models = {
            'hy3': { provider: 'hunyuan', model: 'hy3' },
            'hy3-preview': { provider: 'hunyuan', model: 'hy3-preview' },
            'hunyuan-role-latest': { provider: 'hunyuan', model: 'hunyuan-role-latest' },
            'deepseek-chat': { provider: 'deepseek', model: 'deepseek-chat' },
            'deepseek-reasoner': { provider: 'deepseek', model: 'deepseek-reasoner' },
            'glm-4-flash': { provider: 'zhipu', model: 'glm-4-flash' },
            'kimi-k2': { provider: 'kimi', model: 'moonshot-v1-8k' },
        };
        console.log('ℹ️ Using built-in models. Create a models.json file to customize.');
    }
} catch (error) {
    console.error(`❌ Error loading models.json: ${error.message}`);
    process.exit(1);
}

const getBody = (request) => new Promise((resolve, reject) => {
  let raw = '';
  request.on('data', (chunk) => raw += chunk);
  request.on('end', () => {
    console.debug('[getBody] raw length:', raw.length);
    if (!raw) {
      console.debug('[getBody] empty body, resolving {}');
      return resolve({});
    }
    try {
      const parsed = JSON.parse(raw);
      console.debug('[getBody] parsed keys:', Object.keys(parsed ?? {}));
      resolve(parsed);
    } catch (e) {
      console.error('[getBody] JSON parse error:', e.message);
      console.debug('[getBody] raw payload:', raw.slice(0, 500));
      reject(e);
    }
  });
});

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const sendJSON = (response, data, status = 200) =>
    response.writeHead(status, {
        'Content-Type': 'application/json',
        'charset': 'utf-8',
        ...CORS_HEADERS,
    }).end(JSON.stringify(data));

const sendOpenAIError = (response, message, status = 500, type = 'server_error') =>
    sendJSON(response, {
        error: { message, type, code: null },
    }, status);

const newChatCompletionId = () => `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const writeOpenAISSE = (response, payload) => {
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const openAIChunk = (id, created, model, delta, finishReason = null) => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{
        index: 0,
        delta,
        finish_reason: finishReason,
    }],
});

const openAIUsageChunk = (id, created, model, usage) => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [],
    usage,
});

const normalizeOpenAIUsage = (usage) => {
    if (!usage) return null;
    const promptTokens = usage.prompt_tokens ?? usage.promptTokens ?? 0;
    const completionTokens = usage.completion_tokens ?? usage.completionTokens ?? 0;
    const totalTokens = usage.total_tokens ?? usage.totalTokens ?? (promptTokens + completionTokens);
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
    };
};


const getProviderFetchConfig = (providerName) => {
    switch (providerName) {
        case 'hunyuan':
            return {
                apiKey: process.env.HUNYUAN_API_KEY || process.env.TOKENHUB_API_KEY,
                baseURL: (process.env.HUNYUAN_API_URL || process.env.TOKENHUB_API_URL
                    || 'https://tokenhub.tencentmaas.com/v1').replace(/\/+$/, ''),
            };
        case 'deepseek':
            return {
                apiKey: process.env.DEEPSEEK_API_KEY,
                baseURL: (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1')
                    .replace(/\/+$/, ''),
            };
        default:
            return null;
    }
};

const buildOpenAIChatBody = (modelConfig, messages, options = {}, stream = false) => {
    const modelName = modelConfig.model;
    const isReasoner = modelConfig.provider === 'deepseek' && /reasoner/i.test(modelName);
    const body = {
        model: modelName,
        messages: prepareMessages(messages).map((m) => ({
            role: m.role,
            content: m.content,
        })),
        stream,
    };

    if (!isReasoner) {
        if (typeof options.temperature === 'number') body.temperature = options.temperature;
        if (typeof options.top_p === 'number') body.top_p = options.top_p;
    }
    if (typeof options.num_predict === 'number') body.max_tokens = options.num_predict;

    if (stream) {
        body.stream_options = options.stream_options ?? { include_usage: true };
    }

    return body;
};

const parseAssistantMessage = (message = {}) => ({
    text: typeof message.content === 'string' ? message.content : '',
    reasoning: typeof message.reasoning_content === 'string' ? message.reasoning_content : null,
});

const validateModel = name => {
    const config = models[name];
    if (!config) {
        throw new Error(`Model ${name} not supported`);
    }
    if (!providers[config.provider]) {
        throw new Error(`Provider ${config.provider} not available`);
    }
    return config;
};

const prepareMessages = (messages = []) => {
  console.debug('[prepareMessages] incoming messages count:', messages.length);

  const out = messages.map((msg, idx) => {
    const role = msg.role === 'assistant' || msg.role === 'system' ? msg.role : 'user';
    const c = msg.content;

    if (Array.isArray(c)) {
      console.debug(`[prepareMessages] msg[${idx}] has ${c.length} content blocks`);
      return { role, content: c };
    }

    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (!trimmed) {
        console.debug(`[prepareMessages] msg[${idx}] is empty string; dropping`);
        return null;
      }
      return { role, content: trimmed };
    }

    console.debug(`[prepareMessages] msg[${idx}] has unsupported content type`, typeof c);
    return null;
  }).filter(Boolean);

  console.debug('[prepareMessages] valid messages count:', out.length);
  return out;
};


const generateResponse = async (modelConfig, messages, options = {}) => {
  const fetchConfig = getProviderFetchConfig(modelConfig.provider);
  if (fetchConfig) {
    const upstream = await fetch(`${fetchConfig.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fetchConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOpenAIChatBody(modelConfig, messages, options, false)),
    });
    if (!upstream.ok) {
      throw new Error(`${modelConfig.provider} HTTP ${upstream.status}: ${await upstream.text()}`);
    }
    const data = await upstream.json();
    if (data.error) throw new Error(data.error.message || 'Upstream returned an error');
    if (!data.choices?.[0]?.message) throw new Error('Invalid upstream chat completion');
    const parsed = parseAssistantMessage(data.choices[0].message);
    return {
      text: parsed.text,
      reasoning: parsed.reasoning,
      usage: normalizeOpenAIUsage(data.usage),
      finishReason: data.choices[0].finish_reason || 'stop',
    };
  }

  const result = await generateText({
    model: providers[modelConfig.provider](modelConfig.model),
    messages: prepareMessages(messages),
    temperature: options.temperature,
    topP: options.top_p,
    maxTokens: options.num_predict,
    maxRetries: 0,
  });
  return {
    text: result.text || '',
    reasoning: null,
    usage: normalizeOpenAIUsage(result.usage),
    finishReason: result.finishReason === 'tool-calls' ? 'tool_calls' : result.finishReason,
  };
};


const streamOpenAICompatibleFetch = async (response, modelConfig, messages, options = {}, requestedModel) => {
  const fetchConfig = getProviderFetchConfig(modelConfig.provider);
  if (!fetchConfig) {
    throw new Error(`Provider ${modelConfig.provider} does not support native streaming`);
  }

  const modelName = modelConfig.model;
  const id = newChatCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const outModel = requestedModel || modelName;
  const body = buildOpenAIChatBody(modelConfig, messages, options, true);

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    ...CORS_HEADERS,
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const controller = new AbortController();
  const onClose = () => controller.abort();
  response.once('close', onClose);
  let reader;
  try {
    const upstream = await fetch(`${fetchConfig.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fetchConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      throw new Error(`${modelConfig.provider} HTTP ${upstream.status}: ${await upstream.text()}`);
    }
    if (!upstream.body) throw new Error('Upstream response has no stream');
    reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventData = [];
    let doneReceived = false;
    let finishReason = null;
    writeOpenAISSE(response, openAIChunk(id, created, outModel, { role: 'assistant' }));

    const dispatchEvent = () => {
      if (eventData.length === 0) return;
      const data = eventData.join('\n');
      eventData = [];
      if (data.trim() === '[DONE]') {
        doneReceived = true;
        return;
      }
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error(parsed.error.message || 'Upstream stream error');
      const choice = parsed.choices?.[0];
      const delta = choice?.delta || {};
      const outDelta = {};
      if (typeof delta.content === 'string' && delta.content) outDelta.content = delta.content;
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        outDelta.reasoning_content = delta.reasoning_content;
      }
      if (Object.keys(outDelta).length > 0) {
        writeOpenAISSE(response, openAIChunk(id, created, outModel, outDelta));
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const usage = normalizeOpenAIUsage(parsed.usage);
      if (usage) writeOpenAISSE(response, openAIUsageChunk(id, created, outModel, usage));
    };
    const consumeLine = (line) => {
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') return dispatchEvent();
      if (line.startsWith('data:')) {
        const value = line.slice(5);
        eventData.push(value.startsWith(' ') ? value.slice(1) : value);
      }
    };

    // Network chunks may split both UTF-8 characters and SSE event boundaries.
    while (!doneReceived) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while (!doneReceived && (newline = buffer.indexOf('\n')) !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) {
        if (!doneReceived && buffer) consumeLine(buffer);
        if (!doneReceived) dispatchEvent();
        break;
      }
    }
    if (!doneReceived && !finishReason) throw new Error('Upstream stream ended before completion');
    writeOpenAISSE(response, openAIChunk(id, created, outModel, {}, finishReason || 'stop'));
  } catch (error) {
    if (!response.destroyed) {
      writeOpenAISSE(response, {
        ...openAIChunk(id, created, outModel, {}, 'stop'),
        error: { message: error.message, type: 'server_error', code: null },
      });
    }
  } finally {
    if (!response.destroyed) response.end('data: [DONE]\n\n');
    response.off('close', onClose);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
};


const streamOpenAIResponse = async (response, modelConfig, messages, options = {}, requestedModel) => {
  if (getProviderFetchConfig(modelConfig.provider)) {
    return streamOpenAICompatibleFetch(response, modelConfig, messages, options, requestedModel);
  }

  const id = newChatCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const outModel = requestedModel || modelConfig.model;
  const controller = new AbortController();
  const onClose = () => controller.abort();
  response.once('close', onClose);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    ...CORS_HEADERS,
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  try {
    let streamError;
    const result = streamText({
      model: providers[modelConfig.provider](modelConfig.model),
      messages: prepareMessages(messages),
      temperature: options.temperature,
      topP: options.top_p,
      maxTokens: options.num_predict,
      maxRetries: 0,
      abortSignal: controller.signal,
      // textStream omits error events in AI SDK 4; capture them explicitly.
      onError: ({ error }) => { streamError = error; },
    });
    writeOpenAISSE(response, openAIChunk(id, created, outModel, { role: 'assistant' }));
    for await (const delta of result.textStream) {
      if (delta) writeOpenAISSE(response, openAIChunk(id, created, outModel, { content: delta }));
    }
    if (streamError) throw new Error(streamError.message || 'Upstream stream error');
    if (options.stream_options?.include_usage) {
      const usage = normalizeOpenAIUsage(await result.usage);
      if (usage) writeOpenAISSE(response, openAIUsageChunk(id, created, outModel, usage));
    }
    const finishReason = await result.finishReason;
    if (finishReason === 'error' || finishReason === 'unknown') {
      throw new Error('Upstream stream ended before completion');
    }
    writeOpenAISSE(response, openAIChunk(id, created, outModel, {},
      finishReason === 'tool-calls' ? 'tool_calls' : finishReason || 'stop'));
  } catch (error) {
    if (!response.destroyed) {
      writeOpenAISSE(response, {
        ...openAIChunk(id, created, outModel, {}, 'stop'),
        error: { message: error.message, type: 'server_error', code: null },
      });
    }
  } finally {
    if (!response.destroyed) response.end('data: [DONE]\n\n');
    response.off('close', onClose);
    controller.abort();
  }
};


const handleOpenAIChatCompletions = async (request, response) => {
  try {
    let body;
    try {
      body = await getBody(request);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return sendOpenAIError(response, 'Invalid JSON request body', 400, 'invalid_request_error');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendOpenAIError(response, 'Request body must be a JSON object', 400, 'invalid_request_error');
    }
    const { model, messages, stream = false, temperature, top_p, max_tokens, stream_options } = body;
    if (typeof model !== 'string' || !model.trim()) {
      return sendOpenAIError(response, 'Missing required parameter: model', 400, 'invalid_request_error');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return sendOpenAIError(response, 'Missing required parameter: messages', 400, 'invalid_request_error');
    }
    if (messages.some(message => !message || typeof message !== 'object'
      || (typeof message.content !== 'string' && !Array.isArray(message.content)))) {
      return sendOpenAIError(response, 'Invalid messages: each message requires content', 400, 'invalid_request_error');
    }
    const validMessages = prepareMessages(messages);
    if (validMessages.length === 0 || validMessages.some(message => Array.isArray(message.content) && !message.content.length)) {
      return sendOpenAIError(response, 'No valid messages found', 400, 'invalid_request_error');
    }
    if (typeof stream !== 'boolean') {
      return sendOpenAIError(response, 'stream must be a boolean', 400, 'invalid_request_error');
    }
    if ([temperature, top_p].some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))
      || (max_tokens !== undefined && (!Number.isInteger(max_tokens) || max_tokens <= 0))) {
      return sendOpenAIError(response, 'Invalid generation parameters', 400, 'invalid_request_error');
    }
    if (stream_options !== undefined && (!stream_options || typeof stream_options !== 'object'
      || Array.isArray(stream_options) || (stream_options.include_usage !== undefined && typeof stream_options.include_usage !== 'boolean'))) {
      return sendOpenAIError(response, 'Invalid stream_options', 400, 'invalid_request_error');
    }
    const modelConfig = validateModel(model);
    const options = { temperature, top_p, num_predict: max_tokens, stream_options };
    if (stream) {
      await streamOpenAIResponse(response, modelConfig, validMessages, options, model);
      return;
    }
    const result = await generateResponse(modelConfig, validMessages, options);
    const message = { role: 'assistant', content: result.text || '' };
    if (result.reasoning) message.reasoning_content = result.reasoning;
    sendJSON(response, {
      id: newChatCompletionId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message, finish_reason: result.finishReason || 'stop' }],
      usage: result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (error) {
    console.error('[OpenAI /v1/chat/completions] error:', error.message);
    if (!response.headersSent) {
      const status = /not supported|not available/i.test(error.message) ? 404 : 500;
      sendOpenAIError(response, error.message, status);
    } else {
      response.write('data: [DONE]\n\n');
      response.end();
    }
  }
};

const routes = {
    'GET /': (request, response) => response.end('Multi-provider LLM proxy (OpenAI-compatible).'),
    'GET /health': (request, response) => sendJSON(response, {
        status: 'ok',
        service: 'ollama-api-proxy',
        port: Number(PORT),
        providers: Object.keys(providers),
        models: Object.keys(models).filter(name => providers[models[name]?.provider]),
    }),
    'GET /v1/models': (request, response) => {
        const data = Object.entries(models)
            .filter(([, config]) => providers[config.provider])
            .map(([name, config]) => ({
                id: name,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: config.provider,
            }));
        sendJSON(response, { object: 'list', data });
    },
    'POST /v1/chat/completions': handleOpenAIChatCompletions,
};

// ---------------------------------------------------------------------------
// HTTP 骨架（已实现）：CORS 预检、查表分发、监听端口、信号退出
// 把上面整条链路挂到 localhost:PORT（默认 11434）
// ---------------------------------------------------------------------------
const proxyServer = http.createServer(async (request, response) => {
    const routeKey = `${request.method} ${request.url.split('?')[0]}`;
    console.info(routeKey);

    if (request.method === 'OPTIONS') {
        return response.writeHead(200, CORS_HEADERS).end();
    }

    try {
        const handler = routes[routeKey];
        if (handler) {
            await handler(request, response);
        } else {
            sendOpenAIError(response, 'Not found', 404, 'invalid_request_error');
        }
    } catch (error) {
        console.error('Server error:', error.message);
        if (!response.headersSent) {
            sendOpenAIError(response, 'Internal server error', 500);
        }
    }
});

proxyServer.listen(PORT, () => {
    const availableModels = Object.keys(models).filter(name => providers[models[name]?.provider]);

    console.log(`🚀 LLM Proxy running on http://localhost:${PORT}`);
    console.log(`🔑 Providers: ${Object.keys(providers).join(', ') || '(none — 请配置 Provider)'}`);
    console.log(`📋 Available models: ${availableModels.join(', ') || '(none)'}`);
    if (availableModels.length === 0) {
        console.warn('⚠️ 没有可用模型：请配置 Provider，并确认 models.json 与 Key 对应');
        console.warn('   混元请在 .env 设置 HUNYUAN_API_KEY（TokenHub）');
    }
    console.log(`📡 POST http://localhost:${PORT}/v1/chat/completions`);
    console.log(`📡 GET  http://localhost:${PORT}/v1/models`);
    console.log(`📡 GET  http://localhost:${PORT}/health`);
});

['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, () => {
        console.log(`\n🛑 Received ${signal}, shutting down...`);
        proxyServer.close(() => process.exit(0));
    });
});
