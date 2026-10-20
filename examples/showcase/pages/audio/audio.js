const { logBehavior } = require('../../utils/log.js')

const NETWORK_MP3 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3'
const SOURCES = [
  { name: '包内 mp3（四个音）', src: '/assets/scale.mp3' },
  { name: '网络 mp3（MDN）', src: NETWORK_MP3 },
  { name: '不存在的地址', src: 'https://example.com/not-found.mp3' }
]
const AUDIO_EVENTS = ['Canplay', 'Play', 'Pause', 'Stop', 'Ended', 'Error', 'Waiting', 'Seeking', 'Seeked']
const VOLUMES = [1, 0.3]
const RATES = [1, 1.5, 0.5]

Page({
  behaviors: [logBehavior],
  data: {
    sources: SOURCES,
    current: 0,
    position: '0.0',
    duration: '-',
    loop: false,
    volume: 1,
    rate: 1,
    backgroundPosition: '-'
  },
  onLoad() {
    const audio = wx.createInnerAudioContext()
    AUDIO_EVENTS.forEach(name => audio['on' + name](res => this.log('InnerAudioContext ' + name.toLowerCase(), res)))
    audio.onTimeUpdate(() => this.setData({
      position: audio.currentTime.toFixed(1),
      duration: audio.duration ? audio.duration.toFixed(1) : '-'
    }))
    audio.src = SOURCES[0].src
    this.audio = audio
  },
  onUnload() {
    this.audio.destroy()
  },
  selectSource(e) {
    const current = Number(e.currentTarget.dataset.index)
    this.audio.stop()
    this.audio.src = SOURCES[current].src
    this.setData({ current, position: '0.0', duration: '-' })
  },
  play() {
    this.audio.play()
  },
  pause() {
    this.audio.pause()
  },
  stop() {
    this.audio.stop()
  },
  seek() {
    this.audio.seek(2)
  },
  toggleLoop() {
    this.audio.loop = !this.data.loop
    this.setData({ loop: this.audio.loop })
  },
  cycleVolume() {
    const volume = VOLUMES[(VOLUMES.indexOf(this.data.volume) + 1) % VOLUMES.length]
    this.audio.volume = volume
    this.setData({ volume })
  },
  cycleRate() {
    const rate = RATES[(RATES.indexOf(this.data.rate) + 1) % RATES.length]
    this.audio.playbackRate = rate
    this.setData({ rate })
  },
  backgroundAudio() {
    const manager = wx.getBackgroundAudioManager()
    if (!this.backgroundBound) {
      this.backgroundBound = true
      AUDIO_EVENTS.forEach(name => manager['on' + name](res => this.log('BackgroundAudioManager ' + name.toLowerCase(), res)))
      manager.onTimeUpdate(() => this.setData({ backgroundPosition: manager.currentTime.toFixed(1) + ' / ' + (manager.duration || 0).toFixed(1) }))
    }
    return manager
  },
  playBackground() {
    const manager = this.backgroundAudio()
    manager.title = 'showcase 背景音频'
    manager.singer = 'wxa-runner'
    manager.coverImgUrl = 'https://open-wxa.github.io/wxa-runner/logo.png'
    // 设置 src 后自动开始播放
    manager.src = NETWORK_MP3
  },
  pauseBackground() {
    this.backgroundAudio().pause()
  },
  stopBackground() {
    this.backgroundAudio().stop()
  }
})
