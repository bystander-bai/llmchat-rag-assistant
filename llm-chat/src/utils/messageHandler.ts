import { FileItem } from '../stores/chat'

interface CompletionMessage {
  content?: string | null
  reasoning_content?: string | null
}

export interface ChatCompletion {
  choices: { message: CompletionMessage }[]
  usage?: { completion_tokens?: number }
  speed?: number | string
}

interface ChatChunk {
  choices?: { delta?: CompletionMessage }[]
  usage?: { completion_tokens?: number }
  error?: string | { message?: string }
}

export interface MessageData {
  id: number
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string
  files?: FileItem[]
  completion_tokens?: number
  speed?: number
  loading?: boolean
}

let messageIdCounter = 0

export const messageHandler = {
  formatMessage(
    role: 'user' | 'assistant',
    content: string,
    reasoning_content: string = '',
    files: FileItem[] = []
  ): MessageData {
    return {
      id: Date.now() + messageIdCounter++,
      role,
      content,
      reasoning_content,
      files,
      completion_tokens: 0,
      speed: 0,
      loading: false,
    }
  },

  
  async handleStreamResponse(
    response: Response,
    updateCallback: (content: string, reasoning_content: string, tokens: number, speed: string) => void
  ) {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('SSE 响应缺少可读取的数据流')

    const decoder = new TextDecoder('utf-8', { fatal: true })
    let text = '', think = '', buffer = '', completionTokens = 0
    let doneReceived = false
    let streamEnded = false
    const startTime = Date.now()
    const emitUpdate = () => {
      const elapsedSec = (Date.now() - startTime) / 1000
      const speed = completionTokens > 0 && elapsedSec > 0
        ? (completionTokens / elapsedSec).toFixed(1) : '0'
      updateCallback(text, think, completionTokens, speed)
    }
    const processLine = (rawLine: string) => {
      const trimmed = rawLine.trim()
      // 忽略 SSE 心跳注释、空行及 event/id 等非 data 字段。
      if (!trimmed || trimmed.startsWith(':')) return false
      if (!trimmed.startsWith('data:')) return false

      const payload = trimmed.slice('data:'.length).trimStart()
      if (payload === '[DONE]') {
        doneReceived = true
        return true
      }
      if (!payload) return false

      let data: ChatChunk
      try {
        data = JSON.parse(payload)
      } catch (error) {
        const detail = error instanceof Error ? error.message : '未知解析错误'
        throw new Error(`SSE 数据解析失败：${detail}`)
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('SSE 数据格式错误：期望 JSON 对象')
      }
      if (data.error) {
        const detail = typeof data.error === 'string' ? data.error : data.error.message
        throw new Error(`SSE 上游错误：${detail || '未知错误'}`)
      }

      const delta = data.choices?.[0]?.delta
      if (delta?.content) text += delta.content
      if (delta?.reasoning_content) think += delta.reasoning_content
      if (typeof data.usage?.completion_tokens === 'number') {
        completionTokens = data.usage.completion_tokens
      }
      emitUpdate()
      return false
    }

    const processLines = (flush = false) => {
      const lines = buffer.split('\n')
      if (flush) {
        buffer = ''
      } else {
        buffer = lines.pop() ?? ''
      }

      for (const line of lines) {
        if (processLine(line)) return true
      }
      return false
    }

    try {
      while (!doneReceived) {
        const { done, value } = await reader.read()
        if (done) {
          streamEnded = true
          break
        }
        buffer += decoder.decode(value, { stream: true })
        if (processLines()) break
      }

      // 刷新解码器并处理无换行的最后一条数据，避免丢失正文或用量。
      if (!doneReceived) {
        buffer += decoder.decode()
        if (buffer) processLines(true)
      }
    } finally {
      try {
        // [DONE] 或解析失败后停止消费，并保留原始错误供页面显示。
        if (!streamEnded) await reader.cancel()
      } catch {
        // 流已出错时 cancel 也可能失败，不覆盖 read/解析/回调的错误。
      } finally {
        reader.releaseLock()
      }
    }
  },

  // 已实现：非流式一次取出 message.content / reasoning_content
  handleNormalResponse(
    response: ChatCompletion,
    updateCallback: (content: string, reasoning_content: string, tokens: number, speed: string) => void
  ) {
    const msg = response.choices?.[0]?.message
    if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) {
      throw new Error('模型未返回有效回复，请重试')
    }
    updateCallback(
      msg.content,
      msg.reasoning_content ?? '',
      response.usage?.completion_tokens ?? 0,
      String(response.speed ?? '0')
    )
  },

  async handleResponse(
    response: Response | ChatCompletion,
    isStream: boolean,
    updateCallback: (content: string, reasoning_content: string, tokens: number, speed: string) => void
  ) {
    if (isStream) {
      if (!(response instanceof Response)) throw new Error('流式响应格式错误')
      await this.handleStreamResponse(response, updateCallback)
    } else {
      if (response instanceof Response) throw new Error('非流式响应格式错误')
      this.handleNormalResponse(response, updateCallback)
    }
  },
}
