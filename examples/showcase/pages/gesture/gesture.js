const { logBehavior } = require('../../utils/log.js')

const range = n => Array.from({ length: n }, (_, i) => i + 1)

Page({
  behaviors: [logBehavior],
  data: {
    rows: range(30),
    intoView: '',
    scrollTop: 0,
    refreshing: false,
    colors: ['#07c160', '#1677ff', '#fa8c16', '#eb2f96'],
    autoplay: false,
    move: 'x=0 y=0',
    pageScrollTop: 0
  },
  onTouch(e) {
    const touch = e.changedTouches[0]
    this.log(e.type, { touches: e.touches.length, clientX: Math.round(touch.clientX), clientY: Math.round(touch.clientY) })
  },
  onOuterTap(e) {
    this.log('外层 tap', { target: e.target.id, currentTarget: e.currentTarget.id })
  },
  onInnerTap(e) {
    this.log(e.currentTarget.id + ' tap')
  },
  // 滚动中连续触发，只显示不记日志
  onScroll(e) {
    this.setData({ scrollTop: Math.round(e.detail.scrollTop) })
  },
  scrollIntoView(e) {
    this.setData({ intoView: e.currentTarget.dataset.target })
  },
  onRefresh() {
    this.log('refresherrefresh')
    this.setData({ refreshing: true })
    setTimeout(() => this.setData({ refreshing: false }), 1000)
  },
  toggleAutoplay() {
    this.setData({ autoplay: !this.data.autoplay })
  },
  onMove(e) {
    const { x, y, source } = e.detail
    this.setData({ move: `x=${Math.round(x)} y=${Math.round(y)} source=${source}` })
  },
  onPageScroll(e) {
    const top = Math.round(e.scrollTop)
    if (top !== this.data.pageScrollTop) this.setData({ pageScrollTop: top })
  },
  onReachBottom() {
    this.log('onReachBottom')
  },
  pageScrollTo(e) {
    const target = e.currentTarget.dataset.target === 'top' ? { scrollTop: 0 } : { selector: '#page-bottom' }
    wx.pageScrollTo(Object.assign(target, { duration: 300 }, this.logResult('pageScrollTo')))
  }
})
