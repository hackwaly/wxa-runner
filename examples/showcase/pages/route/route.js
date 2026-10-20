const { createLine, MAX_LINES } = require('../../utils/log.js')

// 记录放在模块里，跨页面实例保留：重新打开这个页面时，还能看到上一个实例的 onHide / onUnload
let records = []
let instanceCount = 0

const ROUTES = [
  { method: 'navigateTo', url: '/pages/route/route?from=navigateTo', name: 'navigateTo 再开一个本页' },
  { method: 'redirectTo', url: '/pages/route/route?from=redirectTo', name: 'redirectTo 本页' },
  { method: 'navigateBack', name: 'navigateBack' },
  { method: 'reLaunch', url: '/pages/route/route?from=reLaunch', name: 'reLaunch 本页' },
  { method: 'reLaunch', url: '/pages/index/index', name: 'reLaunch 首页' },
  { method: 'switchTab', url: '/pages/mine/mine', name: 'switchTab「我的」' }
]

// 这几个应该失败，对照两边的 errMsg
const INVALID_ROUTES = [
  { method: 'navigateTo', url: '/pages/mine/mine', name: 'navigateTo tabBar 页' },
  { method: 'switchTab', url: '/pages/detail/detail', name: 'switchTab 非 tabBar 页' },
  { method: 'navigateTo', url: '/pages/nope/nope', name: 'navigateTo 不存在的页面' }
]

Page({
  data: { instance: 0, stack: '', logs: [], routes: ROUTES, invalidRoutes: INVALID_ROUTES },
  onLoad(query) {
    this.instance = ++instanceCount
    this.setData({ instance: this.instance })
    this.record('onLoad', query)
    this.onAppShow = res => this.record('wx.onAppShow', res)
    this.onAppHide = res => this.record('wx.onAppHide', res)
    wx.onAppShow(this.onAppShow)
    wx.onAppHide(this.onAppHide)
  },
  onShow() {
    this.record('onShow')
    this.setData({ stack: getCurrentPages().map(page => page.route).join(' → ') })
  },
  onReady() {
    this.record('onReady')
  },
  onHide() {
    this.record('onHide')
  },
  onUnload() {
    this.unloaded = true
    this.record('onUnload')
    wx.offAppShow(this.onAppShow)
    wx.offAppHide(this.onAppHide)
  },
  record(name, detail) {
    records = [createLine(`#${this.instance} ${name}`, detail)].concat(records).slice(0, MAX_LINES)
    // 关闭后不再更新界面，下一个实例打开时一起显示
    if (!this.unloaded) this.setData({ logs: records })
  },
  clearLog() {
    records = []
    this.setData({ logs: [] })
  },
  go(e) {
    const { method, url } = e.currentTarget.dataset
    wx[method]({
      url,
      success: res => this.record(method + ' success', res),
      fail: err => this.record(method + ' fail', err)
    })
  }
})
