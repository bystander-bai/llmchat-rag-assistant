import {
  useSettingStore,
  DEFAULT_API_BASE_URL,
  DEFAULT_PROXY_URL,
  getEffectiveModel,
  type ModelOption,
  type Settings,
} from '../stores/setting'
import { testRagConnection } from './ragApi'
import type { ChatCompletion } from './messageHandler'

const normalizeBaseUrl = (url: string) => url.trim().replace(/\/+$/, '')

/**
 * 把 base 拼成 OpenAI 风格路径。
 * - 若 base 已以 /v1 结尾 → `${base}/${resource}`
 * - 否则 → `${base}/v1/${resource}`
 */
const appendOpenAIPath = (base: string, resource: string): string => {
  const normalized = normalizeBaseUrl(base)
  if (normalized.endsWith('/v1')) return `${normalized}/${resource}`
  return `${normalized}/v1/${resource}`
}


/**
 * 按 connectionMode 选择上游基址。
 * - rag → ragUrl
 * - proxy → proxyUrl || DEFAULT_PROXY_URL
 * - direct → apiBaseUrl || DEFAULT_API_BASE_URL
 */
export const getServiceBaseUrl = (settings: Settings): string => {
  if (settings.connectionMode === 'rag') {
    return normalizeBaseUrl(settings.ragUrl)
  }
  const base = settings.connectionMode === 'proxy'
    ? settings.proxyUrl || DEFAULT_PROXY_URL
    : settings.apiBaseUrl || DEFAULT_API_BASE_URL
  return normalizeBaseUrl(base)

}

export const getChatCompletionsUrl = (settings: Settings) => {
  const base = getServiceBaseUrl(settings)
  if (base.endsWith('/chat/completions')) return base
  return appendOpenAIPath(base, 'chat/completions')
}

export const getModelsUrl = (settings: Settings) => appendOpenAIPath(getServiceBaseUrl(settings), 'models')

export const getHealthUrl = (settings: Settings) => `${getServiceBaseUrl(settings)}/health`

const isTokenHubBase = (settings: Settings) => {
  const base = getServiceBaseUrl(settings)
  return base.startsWith('/tokenhub') || /tokenhub\.tencentmaas\.(com|cn)/i.test(base)
}

const buildHeaders = (settings: Settings) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`
  }
  return headers
}

export const fetchProxyModels = async (proxyUrl?: string): Promise<ModelOption[]> => {
  const settings = useSettingStore.getState().settings
  const probeSettings: Settings = {
    ...settings,
    connectionMode: 'proxy',
    proxyUrl: proxyUrl || settings.proxyUrl || DEFAULT_PROXY_URL,
  }

  const res = await fetch(getModelsUrl(probeSettings))
  if (!res.ok) {
    throw new Error(`获取模型列表失败：${res.status}`)
  }

  const data = await res.json()
  const models = Array.isArray(data?.data) ? data.data : []

  if (models.length === 0) {
    throw new Error('代理服务未返回可用模型，请确认实训二已启动并配置了 API Key')
  }

  return models.map((item: { id: string }) => ({
    label: item.id,
    value: item.id,
    maxTokens: 16384,
  }))
}

export const testConnection = async (settings: Settings) => {
  if (settings.connectionMode === 'rag') {
    return testRagConnection(settings)
  }

  if (!isTokenHubBase(settings)) {
    const healthUrl = getHealthUrl(settings)
    const res = await fetch(healthUrl)
    if (res.ok) return true
  }

  const modelsUrl = getModelsUrl(settings)
  const modelsRes = await fetch(modelsUrl, {
    headers: buildHeaders(settings),
  })
  if (!modelsRes.ok) {
    let detail = ''
    try {
      const errBody = await modelsRes.json()
      detail =
        errBody?.error?.message_zh ||
        errBody?.error?.message ||
        errBody?.message ||
        errBody?.detail ||
        ''
    } catch {
      // ignore parse error
    }
    throw new Error(detail ? `连接失败：${modelsRes.status}（${detail}）` : `连接失败：${modelsRes.status}`)
  }
  return true
}

/**
 * 发起 OpenAI 兼容对话请求。
 * 要点：
 * 1. 用 getEffectiveModel 取模型名；直连模式必须有 apiKey
 * 2. body：model / messages / stream / max_tokens / temperature / top_p
 * 3. stream 时附加 stream_options: { include_usage: true }
 * 4. POST getChatCompletionsUrl(setting)；失败抛出可读错误
 * 5. stream=true 返回 Response；否则返回 json
 */
export const createChatCompletion = async (
  messages: Array<{ role: string; content: string }>
) : Promise<Response | ChatCompletion> => {
  const setting = useSettingStore.getState().settings
  const model = getEffectiveModel(setting)
  if (!model) throw new Error('请先选择或填写模型名称')
  if (setting.connectionMode === 'direct' && !setting.apiKey.trim()) {
    throw new Error('直连模式需要填写 API Key')
  }
  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: setting.stream,
    max_tokens: setting.maxTokens,
    temperature: setting.temperature,
    top_p: setting.topP,
  }
  if (setting.stream) payload.stream_options = { include_usage: true }
  const res = await fetch(getChatCompletionsUrl(setting), {
    method: 'POST',
    headers: buildHeaders(setting),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`请求错误：${res.status}`)
  return setting.stream ? res : await res.json()
}
