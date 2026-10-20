const { logBehavior } = require('../../utils/log.js')

const SOURCES = [
  { name: '包内 mp4', src: '/assets/clip.mp4' },
  { name: '网络 mp4（微信文档示例）', src: 'http://wxsnsdy.tc.qq.com/105/20210/snsdyvideodownload?filekey=30280201010421301f0201690402534804102ca905ce620b1241b726bc41dcff44e00204012882540400&bizid=1023&hy=SH&fileparam=302c020101042530230204136ffd93020457e3c4ff02024ef202031e8d7f02030f42400204045a320a0201000400' },
  { name: '网络 mp4（MDN）', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
  { name: '不存在的地址', src: 'https://example.com/not-found.mp4' }
]
const RATES = [1, 1.5, 2, 0.5]
const OBJECT_FITS = ['contain', 'fill', 'cover']

Page({
  behaviors: [logBehavior],
  data: {
    sources: SOURCES,
    current: 0,
    src: SOURCES[0].src,
    position: '0.0',
    duration: '-',
    rate: 1,
    controls: true,
    muted: false,
    loop: false,
    objectFit: 'contain',
    danmuList: [
      { text: '第 1 秒的弹幕', color: '#ff4d4f', time: 1 },
      { text: '第 3 秒的弹幕', color: '#52c41a', time: 3 }
    ]
  },
  onReady() {
    this.video = wx.createVideoContext('player')
  },
  selectSource(e) {
    const current = Number(e.currentTarget.dataset.index)
    this.setData({ current, src: SOURCES[current].src, position: '0.0', duration: '-' })
  },
  // 每秒好几次，只显示不记日志
  onTimeUpdate(e) {
    this.setData({ position: e.detail.currentTime.toFixed(1), duration: e.detail.duration.toFixed(1) })
  },
  play() {
    this.video.play()
  },
  pause() {
    this.video.pause()
  },
  stop() {
    this.video.stop()
  },
  seek() {
    this.video.seek(3)
  },
  cycleRate() {
    const rate = RATES[(RATES.indexOf(this.data.rate) + 1) % RATES.length]
    this.video.playbackRate(rate)
    this.setData({ rate })
  },
  fullScreen() {
    this.video.requestFullScreen({ direction: 90 })
    setTimeout(() => this.video.exitFullScreen(), 3000)
  },
  sendDanmu() {
    this.video.sendDanmu({ text: 'sendDanmu 发的弹幕', color: '#ffffff' })
  },
  toggle(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [key]: !this.data[key] })
  },
  cycleObjectFit() {
    this.setData({ objectFit: OBJECT_FITS[(OBJECT_FITS.indexOf(this.data.objectFit) + 1) % OBJECT_FITS.length] })
  }
})
