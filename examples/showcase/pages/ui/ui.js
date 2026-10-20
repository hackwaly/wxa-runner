const { logBehavior } = require('../../utils/log.js')

// 第一项是 app.json 里的初始颜色
const NAV_COLORS = [
  { frontColor: '#ffffff', backgroundColor: '#07c160' },
  { frontColor: '#000000', backgroundColor: '#ffffff' },
  { frontColor: '#ffffff', backgroundColor: '#1677ff' }
]

Page({
  behaviors: [logBehavior],
  toast(e) {
    const icon = e.currentTarget.dataset.icon
    wx.showToast(Object.assign({ title: 'icon: ' + icon, icon }, this.logResult('showToast')))
  },
  toastLongText() {
    wx.showToast(Object.assign({
      title: 'icon 为 none 时最多显示两行文字，这是一段比较长的提示，看看两边在哪里截断',
      icon: 'none',
      duration: 3000
    }, this.logResult('showToast')))
  },
  toastImage() {
    wx.showToast(Object.assign({ title: '自定义图标', image: '/assets/logo.png' }, this.logResult('showToast')))
  },
  toastMask() {
    wx.showToast(Object.assign({ title: '遮罩 3 秒', icon: 'loading', mask: true, duration: 3000 }, this.logResult('showToast')))
  },
  hideToast() {
    wx.hideToast(this.logResult('hideToast'))
  },
  loading() {
    wx.showLoading(Object.assign({ title: '2 秒后关闭', mask: true }, this.logResult('showLoading')))
    setTimeout(() => wx.hideLoading(this.logResult('hideLoading')), 2000)
  },
  modal() {
    wx.showModal(Object.assign({
      title: '标题',
      content: '正文内容，写得长一点，看看换行和对齐是否一致',
      confirmText: '好的',
      cancelText: '算了',
      confirmColor: '#07c160',
      cancelColor: '#999999'
    }, this.logResult('showModal')))
  },
  modalNoCancel() {
    wx.showModal(Object.assign({ title: '只有确定', content: 'showCancel: false', showCancel: false }, this.logResult('showModal')))
  },
  modalEditable() {
    wx.showModal(Object.assign({ title: '可输入', editable: true, placeholderText: '写点什么' }, this.logResult('showModal')))
  },
  actionSheet() {
    wx.showActionSheet(Object.assign({
      alertText: 'alertText 说明文字',
      itemList: ['选项一', '选项二', '选项三'],
      itemColor: '#07c160'
    }, this.logResult('showActionSheet')))
  },
  setTitle() {
    this.titleCount = (this.titleCount || 0) + 1
    wx.setNavigationBarTitle(Object.assign({ title: `第 ${this.titleCount} 次改标题` }, this.logResult('setNavigationBarTitle')))
  },
  setNavColor() {
    this.colorIndex = ((this.colorIndex || 0) + 1) % NAV_COLORS.length
    wx.setNavigationBarColor(Object.assign({}, NAV_COLORS[this.colorIndex], {
      animation: { duration: 300, timingFunc: 'easeIn' }
    }, this.logResult('setNavigationBarColor')))
  },
  navLoading() {
    wx.showNavigationBarLoading(this.logResult('showNavigationBarLoading'))
    setTimeout(() => wx.hideNavigationBarLoading(this.logResult('hideNavigationBarLoading')), 2000)
  },
  startPullDownRefresh() {
    wx.startPullDownRefresh(this.logResult('startPullDownRefresh'))
  },
  onPullDownRefresh() {
    this.log('onPullDownRefresh')
    setTimeout(() => wx.stopPullDownRefresh(this.logResult('stopPullDownRefresh')), 1000)
  },
  setBackground() {
    wx.setBackgroundColor(Object.assign({ backgroundColorTop: '#07c160', backgroundColorBottom: '#1677ff' }, this.logResult('setBackgroundColor')))
    wx.setBackgroundTextStyle(Object.assign({ textStyle: 'light' }, this.logResult('setBackgroundTextStyle')))
  }
})
