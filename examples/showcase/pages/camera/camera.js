const { logBehavior } = require('../../utils/log.js')

const FLASHES = ['auto', 'on', 'off', 'torch']

Page({
  behaviors: [logBehavior],
  data: { position: 'back', flash: 'auto', recording: false, photo: '', video: '', thumb: '' },
  onReady() {
    this.camera = wx.createCameraContext()
  },
  takePhoto() {
    this.camera.takePhoto({
      quality: 'high',
      success: res => {
        this.log('takePhoto success', res)
        this.setData({ photo: res.tempImagePath })
      },
      fail: err => this.log('takePhoto fail', err)
    })
  },
  startRecord() {
    this.camera.startRecord({
      success: res => {
        this.log('startRecord success', res)
        this.setData({ recording: true })
      },
      fail: err => this.log('startRecord fail', err),
      // 录满 30 秒自动停止
      timeoutCallback: res => {
        this.log('startRecord timeout', res)
        this.setData({ recording: false, video: res.tempVideoPath, thumb: res.tempThumbPath })
      }
    })
  },
  stopRecord() {
    this.camera.stopRecord({
      success: res => {
        this.log('stopRecord success', res)
        this.setData({ recording: false, video: res.tempVideoPath, thumb: res.tempThumbPath })
      },
      fail: err => this.log('stopRecord fail', err)
    })
  },
  switchPosition() {
    this.setData({ position: this.data.position === 'back' ? 'front' : 'back' })
  },
  cycleFlash() {
    this.setData({ flash: FLASHES[(FLASHES.indexOf(this.data.flash) + 1) % FLASHES.length] })
  }
})
