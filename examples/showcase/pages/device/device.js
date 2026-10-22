const { logBehavior } = require('../../utils/log.js')

const INFO_FIELDS = [
  'brand', 'model', 'system', 'platform', 'version', 'SDKVersion', 'language', 'theme', 'fontSizeSetting',
  'pixelRatio', 'screenWidth', 'screenHeight', 'windowWidth', 'windowHeight', 'statusBarHeight', 'safeArea'
]

const GROUPS = [
  { title: '系统', apis: ['getNetworkType', 'getBatteryInfo', 'getScreenBrightness', 'setScreenBrightness', 'setKeepScreenOn', 'vibrateShort'] },
  { title: '剪贴板与电话', apis: ['setClipboardData', 'getClipboardData', 'makePhoneCall'] },
  { title: '位置与扫码', apis: ['getLocation', 'chooseLocation', 'openLocation', 'scanCode'] },
  { title: '登录与授权', apis: ['login', 'checkSession', 'getUserProfile', 'getSetting', 'authorize', 'openSetting'] }
]

const SYNC_APIS = [
  'getWindowInfo', 'getDeviceInfo', 'getAppBaseInfo', 'getSystemSetting', 'getAppAuthorizeSetting',
  'getAccountInfoSync', 'getLaunchOptionsSync', 'getEnterOptionsSync'
]

const ARGS = {
  setScreenBrightness: { value: 0.5 },
  setKeepScreenOn: { keepScreenOn: true },
  vibrateShort: { type: 'medium' },
  setClipboardData: { data: 'wxa-runner showcase' },
  makePhoneCall: { phoneNumber: '10086' },
  getLocation: { type: 'gcj02' },
  openLocation: { latitude: 23.099994, longitude: 113.32452, name: 'T.I.T 创意园', address: '广州市海珠区' },
  getUserProfile: { desc: '演示 getUserProfile' },
  authorize: { scope: 'scope.userLocation' }
}

// 服务市场「服务场景AI」的 jokebot 接口，项目的 appid 要已在服务市场开通这项服务
const SERVICE_MARKET = { service: 'wxcae50ba710ca29d3', api: 'jokebot' }
const JOKE_MODES = [
  { mode: 1, name: '冷笑话' },
  { mode: 2, name: '普通笑话' },
  { mode: 3, name: '浪漫情话' },
  { mode: 4, name: '土味情话' },
  { mode: 5, name: '心灵鸡汤' }
]

const format = value => (typeof value === 'object' ? JSON.stringify(value) : String(value))

Page({
  behaviors: [logBehavior],
  data: { info: [], groups: GROUPS, syncApis: SYNC_APIS, jokeModes: JOKE_MODES },
  onLoad() {
    const info = Object.assign({}, wx.getDeviceInfo(), wx.getAppBaseInfo(), wx.getWindowInfo())
    const rows = INFO_FIELDS.map(key => ({ key, value: format(info[key]) }))
    rows.push({ key: '胶囊按钮', value: format(wx.getMenuButtonBoundingClientRect()) })
    this.setData({ info: rows })
  },
  callApi(e) {
    const api = e.currentTarget.dataset.api
    wx[api](Object.assign({}, ARGS[api], this.logResult(api)))
  },
  callSyncApi(e) {
    const api = e.currentTarget.dataset.api
    this.log(api, wx[api]())
  },
  invokeService(e) {
    // 3.7.0 及以前的基础库在浏览器里一访问 wx.serviceMarket 就同步抛错，放进 then 里才能记进日志
    Promise.resolve()
      .then(() => wx.serviceMarket.invokeService(Object.assign({ data: { mode: e.currentTarget.dataset.mode } }, SERVICE_MARKET)))
      .then(res => this.log('invokeService success', res))
      .catch(err => this.log('invokeService fail', { errCode: err.errCode, errMsg: err.errMsg || String(err), requestId: err.requestId }))
  }
})
