/**
 * picker 组件背后的原生选择器
 *
 * 基础库把各列选项交给宿主，宿主弹出选择器，再按基础库约定的格式返回用户的选择。
 * 这里用一个假的选择器界面模拟用户：按文字点选某一项、确定、取消。
 */

import { describe, expect, it } from 'vitest';
import { createPickerApis } from '../../packages/core/src/runtime/host/api/picker';
import type { PickerOptions, PickerSession } from '../../packages/core/src/runtime/host/ui/Picker';

function fakePickerUser() {
  let options: PickerOptions | null = null;
  let columns: string[][] = [];
  let current: number[] = [];
  let settle: (value: number[] | null) => void = () => undefined;
  let markOpened: () => void = () => undefined;
  const opened = new Promise<void>(resolve => {
    markOpened = resolve;
  });

  return {
    /** 选择器弹出后 resolve */
    opened,
    showPicker(next: PickerOptions): PickerSession {
      options = next;
      columns = next.columns.map(column => [...column]);
      current = [...next.current];
      markOpened();
      return {
        result: new Promise(resolve => {
          settle = resolve;
        }),
        setColumn(column, items, index) {
          columns[column] = [...items];
          current[column] = index;
        }
      };
    },
    get columns() {
      return columns;
    },
    /** 每列当前选中项的文字 */
    get selected() {
      return current.map((index, column) => columns[column][index]);
    },
    pick(column: number, label: string) {
      const index = columns[column].indexOf(label);
      if (index < 0) throw new Error(`第 ${column} 列没有「${label}」，只有：${columns[column].join(' ')}`);
      current[column] = index;
      options?.onColumnChange?.(column, index);
    },
    confirm() {
      settle([...current]);
    },
    cancel() {
      settle(null);
    }
  };
}

type RegionData = Partial<Record<'districts' | 'streets', string>>;

function setup(regionData: RegionData = {}) {
  const user = fakePickerUser();
  const events: Array<[number, string, unknown]> = [];
  const apis = createPickerApis({
    showPicker: options => user.showPicker(options),
    emitToWebview: (webviewId, event, data) => events.push([webviewId, event, data]),
    loadRegionData: async kind => {
      const data = regionData[kind];
      if (data === undefined) throw new Error('没有找到开发者工具自带的行政区划数据');
      return data;
    }
  });
  const call = (api: string, args: object = {}, webviewId = 1) =>
    Promise.resolve(apis[api](args, { api, from: 'webview', webviewId })) as Promise<any>;
  return { user, events, call };
}

// 与开发者工具自带的 region_sub_strict 格式相同：编码、按层级缩进的名称、邮编，以 tab 分隔
const STREETS = [
  '110000000\t北京市\t100000',
  '110100000\t\t北京市\t100000',
  '110101000\t\t\t东城区\t100010',
  '110101001\t\t\t\t东华门街道\t100010',
  '440000000\t广东省\t000000',
  '440100000\t\t广州市\t510000',
  '440105000\t\t\t海珠区\t510220',
  '440105001\t\t\t\t赤岗街道\t510220',
  '440105002\t\t\t\t新港街道\t510220',
  '440300000\t\t深圳市\t518000',
  '440303000\t\t\t罗湖区\t518000'
].join('\n');

describe('普通选择器', () => {
  it('用户选中第二项并确定，返回该项的下标', async () => {
    const { user, call } = setup();
    const result = call('showPickerView', { array: ['苹果', '香蕉', '橙子'], current: 0 });
    expect(user.columns).toEqual([['苹果', '香蕉', '橙子']]);

    user.pick(0, '香蕉');
    user.confirm();
    await expect(result).resolves.toEqual({ errMsg: 'showPickerView:ok', index: 1 });
  });

  it('用户取消时返回 cancel', async () => {
    const { user, call } = setup();
    const result = call('showPickerView', { array: ['苹果'], current: 0 });
    user.cancel();
    await expect(result).resolves.toEqual({ errMsg: 'showPickerView:fail cancel' });
  });
});

describe('多列选择器', () => {
  it('用户切换某一列时通知发起调用的页面', async () => {
    const { user, events, call } = setup();
    call('showMultiPickerView', { array: [['水果', '蔬菜'], ['苹果', '香蕉']], current: [0, 1] }, 3);
    expect(user.selected).toEqual(['水果', '香蕉']);

    user.pick(0, '蔬菜');
    expect(events).toEqual([[3, 'onMultiPickerViewChange', { column: 0, current: 1 }]]);
  });

  it('页面改写某一列后选择器显示新的选项，确定后返回各列下标', async () => {
    const { user, call } = setup();
    const result = call('showMultiPickerView', { array: [['水果', '蔬菜'], ['苹果', '香蕉']], current: [0, 0] });
    user.pick(0, '蔬菜');

    await expect(call('updateMultiPickerView', { column: 1, array: ['白菜', '萝卜'], current: 0 }))
      .resolves.toEqual({ errMsg: 'updateMultiPickerView:ok' });
    expect(user.columns[1]).toEqual(['白菜', '萝卜']);

    user.pick(1, '萝卜');
    user.confirm();
    await expect(result).resolves.toEqual({ errMsg: 'showMultiPickerView:ok', current: [1, 1] });
  });

  it('没有打开的多列选择器时改写列失败', async () => {
    const { call } = setup();
    await expect(call('updateMultiPickerView', { column: 0, array: ['a'], current: 0 }))
      .resolves.toMatchObject({ errMsg: expect.stringMatching(/^updateMultiPickerView:fail/) });
  });
});

describe('日期选择器', () => {
  const date = (current: string, extra: object = {}) =>
    ({ mode: 'date', fields: 'day', current, range: { start: '', end: '' }, ...extra });

  it('按天选择时显示年、月、日三列，月和日补零显示（与开发者工具一致），确定后得到补零的日期', async () => {
    const { user, call } = setup();
    const result = call('showDatePickerView', date('2024-1-5'));
    expect(user.columns.length).toBe(3);
    expect(user.selected).toEqual(['2024年', '01月', '05日']);

    user.confirm();
    await expect(result).resolves.toEqual({ errMsg: 'showDatePickerView:ok', value: '2024-01-05' });
  });

  it('切换到 2 月后日期列按闰年只剩 29 天，原先选中的 31 日落到 29 日', async () => {
    const { user, call } = setup();
    const result = call('showDatePickerView', date('2024-01-31'));
    expect(user.columns[2].length).toBe(31);

    user.pick(1, '02月');
    expect(user.columns[2].length).toBe(29);
    expect(user.selected).toEqual(['2024年', '02月', '29日']);

    user.pick(0, '2023年');
    expect(user.columns[2].length).toBe(28);
    user.confirm();
    await expect(result).resolves.toMatchObject({ value: '2023-02-28' });
  });

  it('start 和 end 之外的日期不可选，初始值超出范围时选中最近的边界', async () => {
    const { user, call } = setup();
    const result = call('showDatePickerView', date('2019-06-01', { range: { start: '2020-03-15', end: '2021-02-10' } }));
    expect(user.columns[0]).toEqual(['2020年', '2021年']);
    expect(user.columns[1][0]).toBe('03月');
    expect(user.columns[2][0]).toBe('15日');
    expect(user.selected).toEqual(['2020年', '03月', '15日']);

    user.pick(0, '2021年');
    expect(user.columns[1]).toEqual(['01月', '02月']);
    expect(user.selected).toEqual(['2021年', '02月', '10日']);
    user.confirm();
    await expect(result).resolves.toMatchObject({ value: '2021-02-10' });
  });

  it('按月选择只有年、月两列，结果为 YYYY-MM；按年选择只有一列', async () => {
    const { user, call } = setup();
    const month = call('showDatePickerView', date('2024-03', { fields: 'month' }));
    expect(user.selected).toEqual(['2024年', '03月']);
    user.confirm();
    await expect(month).resolves.toMatchObject({ value: '2024-03' });

    const other = setup();
    const year = other.call('showDatePickerView', date('2024', { fields: 'year' }));
    expect(other.user.selected).toEqual(['2024年']);
    other.user.confirm();
    await expect(year).resolves.toMatchObject({ value: '2024' });
  });

  it('时间选择器得到 HH:mm，可选范围遵守 start 和 end', async () => {
    const { user, call } = setup();
    const result = call('showDatePickerView', { mode: 'time', current: '09:30', range: { start: '08:00', end: '18:45' } });
    expect(user.columns[0]).toEqual(['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18']);
    expect(user.selected).toEqual(['09', '30']);

    user.pick(0, '18');
    expect(user.columns[1].at(-1)).toBe('45');
    user.confirm();
    await expect(result).resolves.toEqual({ errMsg: 'showDatePickerView:ok', value: '18:30' });
  });

  it('用户取消时返回 cancel', async () => {
    const { user, call } = setup();
    const result = call('showDatePickerView', date('2024-01-01'));
    user.cancel();
    await expect(result).resolves.toEqual({ errMsg: 'showDatePickerView:fail cancel' });
  });
});

describe('地区选择器', () => {
  it('省市区数据原样交给基础库解析', async () => {
    const { call } = setup({ districts: '440000\t广东省 0\n440100\t　　广州市 510000' });
    await expect(call('getRegionData')).resolves.toEqual({
      errMsg: 'getRegionData:ok',
      data: '440000\t广东省 0\n440100\t　　广州市 510000'
    });
  });

  it('level 为 city 时只有省、市两列，结果给出名称、编码和邮编', async () => {
    const { user, call } = setup({ streets: STREETS });
    const result = call('showAddressPickerView', { mode: 'city', current: [] });
    await user.opened;
    expect(user.columns).toEqual([['北京市', '广东省'], ['北京市']]);

    user.pick(0, '广东省');
    expect(user.columns[1]).toEqual(['广州市', '深圳市']);
    user.pick(1, '深圳市');
    user.confirm();
    await expect(result).resolves.toEqual({
      errMsg: 'showAddressPickerView:ok',
      value: { value: ['广东省', '深圳市'], code: ['440000000', '440300000'], postcode: '518000' }
    });
  });

  it('选到街道时有四列，按初始名称选中，切换上级后下级回到第一项', async () => {
    const { user, call } = setup({ streets: STREETS });
    const result = call('showAddressPickerView', { mode: 'sub-district', current: ['广东省', '广州市', '海珠区', '新港街道'] });
    await user.opened;
    expect(user.selected).toEqual(['广东省', '广州市', '海珠区', '新港街道']);

    user.pick(1, '深圳市');
    expect(user.selected).toEqual(['广东省', '深圳市', '罗湖区', undefined]);
    user.pick(1, '广州市');
    expect(user.selected).toEqual(['广东省', '广州市', '海珠区', '赤岗街道']);
    user.confirm();
    await expect(result).resolves.toMatchObject({
      value: { value: ['广东省', '广州市', '海珠区', '赤岗街道'], code: ['440000000', '440100000', '440105000', '440105001'], postcode: '510220' }
    });
  });

  it('本机没有行政区划数据时打开失败并说明原因', async () => {
    const { call } = setup();
    await expect(call('showAddressPickerView', { mode: 'city', current: [] }))
      .resolves.toMatchObject({ errMsg: expect.stringMatching(/^showAddressPickerView:fail .*行政区划/) });
    await expect(call('getRegionData'))
      .resolves.toMatchObject({ errMsg: expect.stringMatching(/^getRegionData:fail .*行政区划/) });
  });
});
