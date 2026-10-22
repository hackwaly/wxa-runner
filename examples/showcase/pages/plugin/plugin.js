const { logBehavior } = require('../../utils/log.js')

// 快递100「快递跟踪」插件（provider wx6885acbedba59c14），在 app.json 里声明为 kdPlugin。
// 项目的 appid 要已在管理后台添加了这个插件，并经插件开发者通过
const APP_NAME = 'wxa-runner showcase'

const COMPANIES = [
  { code: '', name: '自动识别' },
  { code: 'shunfeng', name: '顺丰' },
  { code: 'zhongtong', name: '中通' },
  { code: 'yuantong', name: '圆通' },
  { code: 'yunda', name: '韵达' },
  { code: 'jd', name: '京东' },
  { code: 'ems', name: 'EMS' }
]

function pluginUrl(num, com) {
  const query = { num, appName: APP_NAME }
  if (com) query.com = com
  const search = Object.keys(query).map(key => `${key}=${encodeURIComponent(query[key])}`).join('&')
  return `plugin://kdPlugin/index?${search}`
}

Page({
  behaviors: [logBehavior],
  data: { num: 'SF1234567890', companies: COMPANIES, companyIndex: 1, url: '' },
  onLoad() {
    this.updateUrl()
  },
  onNumInput(e) {
    this.setData({ num: e.detail.value })
    this.updateUrl()
  },
  onCompanyChange(e) {
    this.setData({ companyIndex: Number(e.detail.value) })
    this.updateUrl()
  },
  updateUrl() {
    this.setData({ url: pluginUrl(this.data.num, COMPANIES[this.data.companyIndex].code) })
  },
  navigateToPlugin() {
    wx.navigateTo(Object.assign({ url: this.data.url }, this.logResult('navigateTo')))
  }
})
