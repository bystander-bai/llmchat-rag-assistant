import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import mdLinkAttributes from 'markdown-it-link-attributes'
import { full as emoji } from 'markdown-it-emoji'
import 'highlight.js/styles/atom-one-dark.css'
import copyIcon from '@/assets/photo/复制.png'

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  highlight: function (str, lang): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        return `
          <div class="code-block">
            <div class="code-header">
              <span class="code-lang">${lang}</span>
              <div class="code-actions">
                <button class="code-action-btn" data-action="copy" data-tooltip="复制">
                  <img src="${copyIcon}" alt="copy" />
                </button>
              </div>
            </div>
            <pre class="hljs"><code>${highlighted}</code></pre>
          </div>
        `.trim()
      } catch (__) {
        // ignore
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  },
})

md.use(mdLinkAttributes, {
  attrs: {
    target: '_blank',
    rel: 'noopener',
  },
})

md.use(emoji)

export const renderMarkdown = (content: string): string => {
  if (!content) return ''
  return md.render(content)
}
