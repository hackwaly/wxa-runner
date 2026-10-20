const DEFAULT_SRC = 'https://open-wxa.github.io/wxa-runner/'

Page({
  data: { src: '' },
  onLoad(query) {
    this.setData({ src: query.src ? decodeURIComponent(query.src) : DEFAULT_SRC })
  },
  // web-view 铺满整个页面，放不下日志：事件显示在导航栏标题上，完整的 detail 打到控制台
  onEvent(e) {
    console.log('[showcase] web-view', e.type, e.detail)
    wx.setNavigationBarTitle({ title: `${e.type} ${e.detail.src || e.detail.errMsg || ''}` })
  }
})
