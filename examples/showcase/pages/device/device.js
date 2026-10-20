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

const format = value => (typeof value === 'object' ? JSON.stringify(value) : String(value))

Page({
  behaviors: [logBehavior],
  data: { info: [], groups: GROUPS, syncApis: SYNC_APIS },
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
  }
})
