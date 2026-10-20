const { logBehavior } = require('../../utils/log.js')

const NETWORK_IMAGES = ['https://open-wxa.github.io/wxa-runner/og.png', 'https://open-wxa.github.io/wxa-runner/logo.png']
const MODES = ['scaleToFill', 'aspectFit', 'aspectFill', 'widthFix', 'heightFix', 'center', 'top left', 'bottom right']

Page({
  behaviors: [logBehavior],
  data: { modes: MODES, chosen: [], downloaded: '', saved: '' },
  chooseImage() {
    wx.chooseImage({
      count: 3,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        this.log('chooseImage success', res)
        this.setData({ chosen: res.tempFilePaths })
      },
      fail: err => this.log('chooseImage fail', err)
    })
  },
  chooseMediaImage() {
    wx.chooseMedia({
      count: 3,
      mediaType: ['image'],
      success: res => {
        this.log('chooseMedia success', res)
        this.setData({ chosen: res.tempFiles.map(file => file.tempFilePath) })
      },
      fail: err => this.log('chooseMedia fail', err)
    })
  },
  chooseMediaVideo() {
    wx.chooseMedia(Object.assign({ count: 1, mediaType: ['video'] }, this.logResult('chooseMedia（视频）')))
  },
  // 有选好的图片时预览它们，否则预览网络图片
  preview(e) {
    const urls = this.data.chosen.length ? this.data.chosen : NETWORK_IMAGES
    const current = urls[Number(e.currentTarget.dataset.index) || 0]
    wx.previewImage(Object.assign({ urls, current }, this.logResult('previewImage')))
  },
  imageInfo(e) {
    const from = e.currentTarget.dataset.from
    const src = { package: '/assets/logo.png', network: NETWORK_IMAGES[0], chosen: this.data.chosen[0] }[from]
    if (!src) return wx.showToast({ title: '先选一张图片', icon: 'none' })
    wx.getImageInfo(Object.assign({ src }, this.logResult('getImageInfo')))
  },
  saveToAlbum() {
    const filePath = this.data.chosen[0] || this.data.downloaded
    if (!filePath) return wx.showToast({ title: '先选图片或下载图片', icon: 'none' })
    wx.saveImageToPhotosAlbum(Object.assign({ filePath }, this.logResult('saveImageToPhotosAlbum')))
  },
  download() {
    wx.downloadFile({
      url: NETWORK_IMAGES[0],
      success: res => {
        this.log('downloadFile success', res)
        this.setData({ downloaded: res.tempFilePath })
      },
      fail: err => this.log('downloadFile fail', err)
    })
  },
  fileInfo() {
    const filePath = this.data.downloaded || this.data.saved
    if (!filePath) return wx.showToast({ title: '先下载图片', icon: 'none' })
    wx.getFileInfo(Object.assign({ filePath }, this.logResult('getFileInfo')))
  },
  saveFile() {
    if (!this.data.downloaded) return wx.showToast({ title: '先下载图片', icon: 'none' })
    wx.saveFile({
      tempFilePath: this.data.downloaded,
      success: res => {
        this.log('saveFile success', res)
        // 保存后原来的临时文件就没了
        this.setData({ saved: res.savedFilePath, downloaded: '' })
      },
      fail: err => this.log('saveFile fail', err)
    })
  },
  savedFileList() {
    wx.getSavedFileList(this.logResult('getSavedFileList'))
  },
  removeSavedFile() {
    if (!this.data.saved) return wx.showToast({ title: '还没有保存的文件', icon: 'none' })
    wx.removeSavedFile({
      filePath: this.data.saved,
      success: res => {
        this.log('removeSavedFile success', res)
        this.setData({ saved: '' })
      },
      fail: err => this.log('removeSavedFile fail', err)
    })
  }
})
