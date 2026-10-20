const { logBehavior } = require('../../utils/log.js')

function queryCanvas(selector, callback) {
  wx.createSelectorQuery().select(selector).fields({ node: true, size: true }).exec(res => {
    const { node, width, height } = res[0]
    const dpr = wx.getWindowInfo().pixelRatio
    node.width = width * dpr
    node.height = height * dpr
    callback(node, width, height, dpr)
  })
}

Page({
  behaviors: [logBehavior],
  data: { exported2d: '', exportedLegacy: '' },
  onReady() {
    queryCanvas('#canvas2d', (canvas, width, height, dpr) => {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d')
      this.ctx.scale(dpr, dpr)
      this.size = { width, height }
      this.draw2d()
    })
    this.drawLegacy()
    this.drawWebgl()
  },
  draw2d() {
    const { ctx } = this
    const { width, height } = this.size
    ctx.clearRect(0, 0, width, height)
    const gradient = ctx.createLinearGradient(0, 0, width, 0)
    gradient.addColorStop(0, '#07c160')
    gradient.addColorStop(1, '#1677ff')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, 40)
    ctx.fillStyle = '#ff4d4f'
    ctx.beginPath()
    ctx.arc(40, 90, 30, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#333'
    ctx.font = '16px sans-serif'
    ctx.fillText('type="2d" 画布', 90, 95)
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    const image = this.canvas.createImage()
    image.onload = () => {
      ctx.drawImage(image, width - 74, 50, 64, 64)
      this.log('createImage onload', { width: image.width, height: image.height })
    }
    image.onerror = err => this.log('createImage onerror', err)
    image.src = '/assets/logo.png'
  },
  onTouchStart(e) {
    const { x, y } = e.touches[0]
    this.log('touchstart', { x, y })
    this.ctx.beginPath()
    this.ctx.moveTo(x, y)
  },
  onTouchMove(e) {
    const { x, y } = e.touches[0]
    this.ctx.lineTo(x, y)
    this.ctx.stroke()
  },
  export2d() {
    wx.canvasToTempFilePath({
      canvas: this.canvas,
      success: res => {
        this.log('canvasToTempFilePath（2d）success', res)
        this.setData({ exported2d: res.tempFilePath })
      },
      fail: err => this.log('canvasToTempFilePath（2d）fail', err)
    })
  },
  drawLegacy() {
    const ctx = wx.createCanvasContext('legacy')
    ctx.setFillStyle('#07c160')
    ctx.fillRect(10, 10, 120, 60)
    ctx.setFillStyle('#333333')
    ctx.setFontSize(16)
    ctx.fillText('canvas-id 画布', 10, 100)
    ctx.drawImage('/assets/logo.png', 150, 10, 64, 64)
    ctx.draw(false, () => this.log('canvas-id draw 回调'))
  },
  exportLegacy() {
    wx.canvasToTempFilePath({
      canvasId: 'legacy',
      success: res => {
        this.log('canvasToTempFilePath（canvas-id）success', res)
        this.setData({ exportedLegacy: res.tempFilePath })
      },
      fail: err => this.log('canvasToTempFilePath（canvas-id）fail', err)
    })
  },
  // 绿底上画一个黄色三角形
  drawWebgl() {
    queryCanvas('#webgl', canvas => {
      const gl = canvas.getContext('webgl')
      if (!gl) return this.log('webgl 不可用：getContext 返回 null')
      const shader = (type, source) => {
        const result = gl.createShader(type)
        gl.shaderSource(result, source)
        gl.compileShader(result)
        return result
      }
      const program = gl.createProgram()
      gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'))
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float; void main() { gl_FragColor = vec4(1.0, 0.82, 0.4, 1.0); }'))
      gl.linkProgram(program)
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0.8, -0.8, -0.8, 0.8, -0.8]), gl.STATIC_DRAW)
      const position = gl.getAttribLocation(program, 'p')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0.03, 0.76, 0.38, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.log('webgl 绘制完成', { width: canvas.width, height: canvas.height })
    })
  }
})
