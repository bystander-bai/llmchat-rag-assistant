import {
  useSettingStore,
  DEFAULT_RAG_URL,
  type Settings,
} from '../stores/setting'

const normalizeBaseUrl = (url: string) => url.trim().replace(/\/+$/, '')

export const getRagBaseUrl = (settings: Settings) =>
  normalizeBaseUrl(settings.ragUrl || DEFAULT_RAG_URL)

export interface RagSource {
  source?: string
  metadata?: Record<string, unknown>
  preview?: string
}

export interface RagStep {
  node: string
  regeneration?: number
  retrieval?: number
}

export interface RagChatResponse {
  session_id: string
  answer: string
  sources: RagSource[]
  steps: RagStep[]
}


export const createRagChat = async (
  question: string,
  sessionId?: string | null,
  regenerate = false
): Promise<RagChatResponse> => {
  const settings = useSettingStore.getState().settings
  const questionText = question.trim()

  if (!questionText) {
    throw new Error('问题不能为空')
  }

  const res = await fetch(`${getRagBaseUrl(settings)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: questionText,
      session_id: sessionId || null,
      ...(regenerate ? { regenerate: true } : {}),
    }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const body: unknown = await res.json()
      if (body && typeof body === 'object' && 'detail' in body) {
        const value = body.detail
        if (typeof value === 'string') {
          detail = value.trim()
        } else if (Array.isArray(value)) {
          detail = value
            .map((item: unknown) =>
              item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string'
                ? item.msg
                : ''
            )
            .filter(Boolean)
            .join('；')
        }
      }
    } catch {
      // 非 JSON 错误页仍显示 HTTP 状态，避免解析错误掩盖请求失败。
    }
    throw new Error(`RAG 请求错误：${res.status}${detail ? `，${detail}` : ''}`)
  }

  return await res.json()
}

// 显式清空 RAG 会话；重新生成使用 createRagChat 的 regenerate 参数。
export const resetRagSession = async (sessionId: string) => {
  const settings = useSettingStore.getState().settings
  const url = `${getRagBaseUrl(settings)}/chat/reset?session_id=${encodeURIComponent(sessionId)}`

  const res = await fetch(url, { method: 'POST' })

  if (!res.ok) {
    throw new Error(`重置 RAG 会话失败：${res.status}`)
  }
}

export const testRagConnection = async (settings: Settings) => {
  const res = await fetch(`${getRagBaseUrl(settings)}/health`)
  if (!res.ok) {
    throw new Error(`连接失败：${res.status}`)
  }
  return true
}
