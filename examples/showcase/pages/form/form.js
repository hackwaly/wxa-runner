const { logBehavior } = require('../../utils/log.js')

Page({
  behaviors: [logBehavior],
  data: {
    sliderValue: 30,
    fruits: [
      { value: 'apple', name: '苹果', checked: true },
      { value: 'banana', name: '香蕉' },
      { value: 'orange', name: '橙子' }
    ],
    sizes: [
      { value: 's', name: '小' },
      { value: 'm', name: '中', checked: true },
      { value: 'l', name: '大' }
    ]
  },
  // 拖动中连续触发，只显示不记日志
  onSliderChanging(e) {
    this.setData({ sliderValue: e.detail.value })
  },
  onEditorReady() {
    wx.createSelectorQuery().select('#editor').context(res => {
      this.editor = res.context
      this.log('editor ready')
    }).exec()
  },
  editorBold() {
    this.editor.format('bold')
  },
  editorHeader() {
    this.editor.format('header', 'H2')
  },
  editorImage() {
    this.editor.insertImage(Object.assign({ src: '/assets/logo.png', width: '64px', height: '64px' }, this.logResult('insertImage')))
  },
  editorContents() {
    this.editor.getContents(this.logResult('getContents'))
  },
  editorClear() {
    this.editor.clear(this.logResult('clear'))
  }
})
