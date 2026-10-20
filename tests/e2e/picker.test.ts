/**
 * 端到端：picker 组件
 *
 * 点开 picker 后由宿主弹出选择器（和真机一样是页面之外的原生弹层），用户选完后页面收到 change。
 */

import { Frame } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { e2eReady, expectText, Runner, startRunner } from './runner';

const PICKER_WXML = `
<picker id="fruit" range="{{fruits}}" value="{{fruitIndex}}" header-text="选水果" bindchange="onFruitChange" bindcancel="onFruitCancel"><view>水果</view></picker>
<view id="fruit-result">{{fruitResult}}</view>
<picker id="date" mode="date" value="2024-01-31" start="2020-01-01" end="2025-12-31" bindchange="onDateChange"><view>日期</view></picker>
<view id="date-result">{{dateResult}}</view>
<picker id="time" mode="time" value="09:30" bindchange="onTimeChange"><view>时间</view></picker>
<view id="time-result">{{timeResult}}</view>
<picker id="food" mode="multiSelector" range="{{foods}}" value="{{foodIndex}}" bindcolumnchange="onFoodColumnChange" bindchange="onFoodChange"><view>食物</view></picker>
<view id="food-result">{{foodResult}}</view>
<picker id="region" mode="region" bindchange="onRegionChange"><view>地区</view></picker>
<view id="region-result">{{regionResult}}</view>
<picker id="city" mode="region" level="city" bindchange="onCityChange"><view>城市</view></picker>
<view id="city-result">{{cityResult}}</view>
`;

const PICKER_JS = `
const FOOD_KINDS = { 水果: ['苹果', '香蕉'], 蔬菜: ['白菜', '萝卜'] };
const describeRegion = detail => detail.value.join('/') + ' ' + detail.code.join(',') + ' ' + detail.postcode;

Page({
  data: {
    fruits: ['苹果', '香蕉', '橙子'], fruitIndex: 0, fruitResult: '',
    dateResult: '', timeResult: '',
    foods: [['水果', '蔬菜'], FOOD_KINDS['水果']], foodIndex: [0, 0], foodResult: '',
    regionResult: '', cityResult: ''
  },
  onFruitChange(e) { this.setData({ fruitIndex: Number(e.detail.value), fruitResult: 'change:' + e.detail.value }); },
  onFruitCancel() { this.setData({ fruitResult: 'cancel' }); },
  onDateChange(e) { this.setData({ dateResult: e.detail.value }); },
  onTimeChange(e) { this.setData({ timeResult: e.detail.value }); },
  onFoodColumnChange(e) {
    if (e.detail.column !== 0) return;
    const kind = this.data.foods[0][e.detail.value];
    this.setData({ foods: [this.data.foods[0], FOOD_KINDS[kind]], foodIndex: [e.detail.value, 0] });
  },
  onFoodChange(e) {
    const [kind, item] = e.detail.value;
    this.setData({ foodResult: this.data.foods[0][kind] + '/' + this.data.foods[1][item] });
  },
  onRegionChange(e) { this.setData({ regionResult: describeRegion(e.detail) }); },
  onCityChange(e) { this.setData({ cityResult: describeRegion(e.detail) }); }
});
`;

describe.skipIf(!e2eReady)('picker 选择器', () => {
  let runner: Runner;
  let frame: Frame;
  let hasRegionData = false;

  const sheet = () => runner.page.locator('.wxa-picker');
  const column = (index: number) => sheet().locator('.wxa-picker-column').nth(index);
  const items = (index: number) => column(index).locator('.wxa-picker-item').allTextContents();
  const pick = (index: number, text: string) =>
    column(index).locator('.wxa-picker-item', { hasText: new RegExp(`^${text}$`) }).click();
  const confirm = () => sheet().locator('.wxa-picker-confirm').click();
  /** 点开页面上的 picker，等宿主的选择器弹出 */
  const open = async (selector: string) => {
    await frame.click(selector);
    await sheet().waitFor();
  };

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/picker/picker'] },
      'pages/picker/picker.json': {},
      'pages/picker/picker.wxml': PICKER_WXML,
      'pages/picker/picker.js': PICKER_JS
    });
    hasRegionData = (await fetch(runner.base + '/__wxa__/region/districts')).ok;
  });

  afterAll(() => runner?.close());

  it('用户在选择器里选中第二项并确定，页面收到 change，选择器关闭', async () => {
    frame = await runner.open('/?path=pages/picker/picker');
    await open('#fruit');
    // header-text 仅安卓可用，模拟 iPhone 时和开发者工具一样不显示
    expect(await sheet().getByText('选水果').count()).toBe(0);
    expect(await items(0)).toEqual(['苹果', '香蕉', '橙子']);

    await pick(0, '香蕉');
    await confirm();
    await expectText(frame, '#fruit-result', 'change:1');
    expect(await sheet().count()).toBe(0);
  });

  it('用户点取消，页面收到 cancel 而不是 change', async () => {
    frame = await runner.open('/?path=pages/picker/picker');
    await open('#fruit');
    await sheet().locator('.wxa-picker-cancel').click();
    await expectText(frame, '#fruit-result', 'cancel');
    expect(await sheet().count()).toBe(0);
  });

  it('日期选择器：用户切到 2 月后日期只剩 29 天，确定后页面收到 2024-02-29', async () => {
    frame = await runner.open('/?path=pages/picker/picker');
    await open('#date');
    expect((await items(0)).at(-1)).toBe('2025年');
    expect((await items(2)).length).toBe(31);

    await pick(1, '02月');
    await vi.waitFor(async () => expect((await items(2)).length).toBe(29));
    await confirm();
    await expectText(frame, '#date-result', '2024-02-29');
  });

  it('时间选择器：用户选 18 点，页面收到 18:30', async () => {
    frame = await runner.open('/?path=pages/picker/picker');
    await open('#time');
    await pick(0, '18');
    await confirm();
    await expectText(frame, '#time-result', '18:30');
  });

  it('多列选择器：用户切换第一列后页面改写第二列，选择器跟着更新', async () => {
    frame = await runner.open('/?path=pages/picker/picker');
    await open('#food');
    expect(await items(1)).toEqual(['苹果', '香蕉']);

    await pick(0, '蔬菜');
    await vi.waitFor(async () => expect(await items(1)).toEqual(['白菜', '萝卜']));
    await pick(1, '萝卜');
    await confirm();
    await expectText(frame, '#food-result', '蔬菜/萝卜');
  });

  it('地区选择器：用户依次选择省、市、区，页面收到名称、编码和邮编', async ctx => {
    if (!hasRegionData) ctx.skip();
    frame = await runner.open('/?path=pages/picker/picker');
    await open('#region');
    await pick(0, '广东省');
    await pick(1, '广州市');
    await pick(2, '海珠区');
    await confirm();
    await expectText(frame, '#region-result', '广东省/广州市/海珠区 440000,440100,440105 510220');
  });

  it('只选到城市的地区选择器只有省、市两列', async ctx => {
    if (!hasRegionData) ctx.skip();
    frame = await runner.open('/?path=pages/picker/picker');
    await open('#city');
    await vi.waitFor(async () => expect(await sheet().locator('.wxa-picker-column').count()).toBe(2));
    await pick(0, '广东省');
    await pick(1, '深圳市');
    await confirm();
    await expectText(frame, '#city-result', '广东省/深圳市 440000,440300 518000');
  });
});
