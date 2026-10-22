const { logBehavior } = require('../../utils/log.js')

const webview = url => '/pages/webview/webview?src=' + encodeURIComponent(url)

const GROUPS = [
  {
    title: '媒体',
    items: [
      { url: '/pages/video/video', name: 'video 视频', desc: '包内与网络视频、VideoContext、弹幕、全屏、cover-view' },
      { url: '/pages/audio/audio', name: '音频', desc: 'InnerAudioContext（包内 / 网络）、audio 组件、背景音频' },
      { url: '/pages/camera/camera', name: 'camera 相机', desc: '拍照、录像、切换摄像头和闪光灯' },
      { url: '/pages/image/image', name: '图片与文件', desc: '选图、预览、图片信息、保存到相册、下载与保存文件、image 的 mode' }
    ]
  },
  {
    title: '绘制与地图',
    items: [
      { url: '/pages/canvas/canvas', name: 'canvas 画布', desc: '2d、旧版 canvas-id、webgl、导出图片、手指画线' },
      { url: '/pages/map/map', name: 'map 地图', desc: '标记点、气泡、折线、MapContext、地图事件' }
    ]
  },
  {
    title: '表单与交互',
    items: [
      { url: '/pages/form/form', name: '表单组件', desc: 'input、textarea、switch、slider、checkbox、radio、editor、form 提交' },
      { url: '/pages/picker/picker', name: 'picker 选择器', desc: '普通、多列联动、时间、日期、省市区、picker-view' },
      { url: '/pages/gesture/gesture', name: '滚动与手势', desc: '点击与长按、事件冒泡、scroll-view、swiper、movable-view、页面滚动' }
    ]
  },
  {
    title: '界面与系统',
    items: [
      { url: '/pages/ui/ui', name: '界面 API', desc: 'toast、loading、modal、actionSheet、导航栏、下拉刷新' },
      { url: '/pages/device/device', name: '设备与开放接口', desc: '系统信息、剪贴板、定位、扫码、登录与授权、服务市场' },
      { url: '/pages/route/route', name: '路由与生命周期', desc: 'redirectTo、reLaunch、页面栈、onShow / onHide / onUnload' }
    ]
  },
  {
    title: '插件',
    items: [
      { url: '/pages/plugin/plugin', name: '快递跟踪插件', desc: 'plugin:// 插件页面：wx.navigateTo 与 navigator 组件' }
    ]
  },
  {
    title: 'web-view（事件显示在导航栏标题上）',
    items: [
      { url: webview('https://open-wxa.github.io/wxa-runner/'), name: '允许嵌入的网页', desc: 'wxa-runner 文档站' },
      { url: webview('https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html'), name: '禁止嵌入的网页', desc: '设置了 X-Frame-Options 的微信文档' }
    ]
  }
]

const TAB_STYLES = [
  { color: '#999999', selectedColor: '#07c160', backgroundColor: '#ffffff', borderStyle: 'black' },
  { color: '#bbbbbb', selectedColor: '#ffd666', backgroundColor: '#1e1e1e', borderStyle: 'white' }
]

Page({
  behaviors: [logBehavior],
  data: { groups: GROUPS },
  onTabItemTap(item) {
    this.log('onTabItemTap', item)
  },
  setBadge() {
    wx.setTabBarBadge(Object.assign({ index: 2, text: '9' }, this.logResult('setTabBarBadge')))
  },
  removeBadge() {
    wx.removeTabBarBadge(Object.assign({ index: 2 }, this.logResult('removeTabBarBadge')))
  },
  showRedDot() {
    wx.showTabBarRedDot(Object.assign({ index: 0 }, this.logResult('showTabBarRedDot')))
  },
  hideRedDot() {
    wx.hideTabBarRedDot(Object.assign({ index: 0 }, this.logResult('hideTabBarRedDot')))
  },
  hideTabBar() {
    wx.hideTabBar(Object.assign({ animation: true }, this.logResult('hideTabBar')))
  },
  showTabBar() {
    wx.showTabBar(Object.assign({ animation: true }, this.logResult('showTabBar')))
  },
  toggleStyle() {
    this.styleIndex = ((this.styleIndex || 0) + 1) % TAB_STYLES.length
    wx.setTabBarStyle(Object.assign({}, TAB_STYLES[this.styleIndex], this.logResult('setTabBarStyle')))
  },
  toggleItem() {
    this.itemRenamed = !this.itemRenamed
    wx.setTabBarItem(Object.assign({ index: 1, text: this.itemRenamed ? '改过的' : '能力' }, this.logResult('setTabBarItem')))
  }
})
