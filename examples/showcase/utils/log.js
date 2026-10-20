// 演示页共用的事件日志，由 log-panel 组件显示在页面底部：新的在上，带毫秒时间，
// 在开发者工具和浏览器里对照事件的先后和参数
const MAX_LINES = 100
const MAX_DETAIL_LENGTH = 300

let nextId = 1

function time() {
  const now = new Date()
  const pad = (n, width) => String(n).padStart(width || 2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
}

function formatDetail(detail) {
  if (detail === undefined) return ''
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
  return ' ' + (text.length > MAX_DETAIL_LENGTH ? text.slice(0, MAX_DETAIL_LENGTH) + '…' : text)
}

/** 生成一条日志，完整的 detail 同时打到控制台 */
function createLine(name, detail) {
  console.log('[showcase]', name, detail === undefined ? '' : detail)
  return { id: nextId++, text: `${time()} ${name}${formatDetail(detail)}` }
}

const logBehavior = Behavior({
  data: { logs: [] },
  methods: {
    log(name, detail) {
      this.setData({ logs: [createLine(name, detail)].concat(this.data.logs).slice(0, MAX_LINES) })
    },
    clearLog() {
      this.setData({ logs: [] })
    },
    /** 组件事件直接绑到这里：记下事件名和 detail */
    onEvent(e) {
      this.log(e.type, e.detail)
    },
    /** 作为 API 的 success / fail，把结果记进日志 */
    logResult(api) {
      return {
        success: res => this.log(api + ' success', res),
        fail: err => this.log(api + ' fail', err)
      }
    }
  }
})

module.exports = { logBehavior, createLine, MAX_LINES }
