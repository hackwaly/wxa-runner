const { logBehavior } = require('../../utils/log.js')

const TIT = { latitude: 23.099994, longitude: 113.32452 }
const CANTON_TOWER = { latitude: 23.106467, longitude: 113.324494 }
const EXTRA_MARKER_ID = 3

Page({
  behaviors: [logBehavior],
  data: {
    latitude: TIT.latitude,
    longitude: TIT.longitude,
    markers: [
      {
        id: 1,
        latitude: TIT.latitude,
        longitude: TIT.longitude,
        title: 'T.I.T 创意园',
        iconPath: '/assets/logo.png',
        width: 32,
        height: 32,
        callout: { content: '点气泡触发 callouttap', display: 'ALWAYS', padding: 8, borderRadius: 6, fontSize: 12, color: '#333333', bgColor: '#ffffff' }
      },
      {
        id: 2,
        latitude: CANTON_TOWER.latitude,
        longitude: CANTON_TOWER.longitude,
        title: '广州塔',
        iconPath: '/assets/logo.png',
        width: 32,
        height: 32,
        label: { content: '点 label 触发 labeltap', fontSize: 12, color: '#07c160', bgColor: '#ffffff', padding: 4, borderRadius: 4, anchorX: -50, anchorY: 4 }
      }
    ],
    polyline: [{ points: [TIT, CANTON_TOWER], color: '#1677ffcc', width: 4 }],
    circles: [{ latitude: TIT.latitude, longitude: TIT.longitude, radius: 200, color: '#07c160aa', fillColor: '#07c16022', strokeWidth: 1 }]
  },
  onReady() {
    this.map = wx.createMapContext('map')
  },
  callMap(e) {
    const method = e.currentTarget.dataset.method
    this.map[method](this.logResult(method))
  },
  moveToCurrent() {
    this.map.moveToLocation(this.logResult('moveToLocation（当前位置）'))
  },
  moveToTower() {
    this.map.moveToLocation(Object.assign({}, CANTON_TOWER, this.logResult('moveToLocation（广州塔）')))
  },
  includePoints() {
    this.map.includePoints(Object.assign({ points: [TIT, CANTON_TOWER], padding: [60, 60, 60, 60] }, this.logResult('includePoints')))
  },
  translateMarker() {
    this.markerMoved = !this.markerMoved
    this.map.translateMarker(Object.assign({
      markerId: 1,
      destination: this.markerMoved ? { latitude: 23.1032, longitude: 113.3345 } : TIT,
      autoRotate: false,
      duration: 1000,
      animationEnd: () => this.log('translateMarker animationEnd')
    }, this.logResult('translateMarker')))
  },
  addMarker() {
    this.map.addMarkers(Object.assign({
      markers: [{ id: EXTRA_MARKER_ID, latitude: 23.0965, longitude: 113.33, iconPath: '/assets/logo.png', width: 24, height: 24 }],
      clear: false
    }, this.logResult('addMarkers')))
  },
  removeMarker() {
    this.map.removeMarkers(Object.assign({ markerIds: [EXTRA_MARKER_ID] }, this.logResult('removeMarkers')))
  }
})
