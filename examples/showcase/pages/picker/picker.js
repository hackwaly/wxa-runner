const { logBehavior } = require('../../utils/log.js')

// 多列选择器：第二列随第一列变化
const KINDS = ['动物', '植物']
const NAMES = [['猫', '狗', '兔'], ['玫瑰', '松树', '竹子', '仙人掌']]

const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i)

Page({
  behaviors: [logBehavior],
  data: {
    fruits: ['苹果', '香蕉', '橙子', '葡萄'],
    fruitIndex: 0,
    cities: [{ id: 1, name: '北京' }, { id: 2, name: '上海' }, { id: 3, name: '广州' }],
    cityIndex: 2,
    multiArray: [KINDS, NAMES[0]],
    multiIndex: [0, 0],
    time: '12:30',
    date: '2024-02-15',
    month: '2024-02',
    region: ['广东省', '广州市', '海珠区'],
    cityRegion: ['广东省', '广州市'],
    streetRegion: ['广东省', '广州市', '海珠区', '赤岗街道'],
    years: range(2020, 2030),
    months: range(1, 12),
    days: range(1, 31),
    pickerViewValue: [4, 1, 14]
  },
  // 各个 picker 的 change：记日志，并把值写回 data-key 指定的字段
  onChange(e) {
    this.log(e.type + ' ' + e.currentTarget.dataset.key, e.detail)
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value })
  },
  onColumnChange(e) {
    this.log('columnchange', e.detail)
    const { column, value } = e.detail
    const multiIndex = this.data.multiIndex.slice()
    multiIndex[column] = value
    if (column === 0) {
      multiIndex[1] = 0
      this.setData({ multiArray: [KINDS, NAMES[value]], multiIndex })
    } else {
      this.setData({ multiIndex })
    }
  }
})
