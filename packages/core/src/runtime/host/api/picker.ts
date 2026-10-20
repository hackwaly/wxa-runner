/**
 * picker 组件背后的原生选择器
 *
 * 基础库把每列的选项文字交给宿主，宿主弹出选择器，再按基础库约定的格式返回用户的选择：
 *   selector       showPickerView        → { index }
 *   multiSelector  showMultiPickerView   → { current }，选择期间用户换列时派发 onMultiPickerViewChange，
 *                                          页面改了 range 后基础库调 updateMultiPickerView 换掉那一列
 *   date / time    showDatePickerView    → { value: 'YYYY-MM-DD' / 'HH:mm' }
 *   region         getRegionData 拿省市区数据后自己解析，再走 showMultiPickerView；
 *                  指定了 level 时走 showAddressPickerView → { value: { value, code, postcode } }
 *
 * 日期、地区这类列之间有联动的，联动规则在这里实现，选择器界面只负责显示列。
 */

import type { PickerOptions, PickerSession } from '../ui/Picker';
import { ApiHandler, fail, ok } from './registry';

export type RegionDataKind = 'districts' | 'streets';

export interface PickerApiOptions {
  showPicker(options: PickerOptions): PickerSession;
  /** 派发给渲染层的原生事件（渲染层里 WeixinJSBridge.on 收到） */
  emitToWebview(webviewId: number, event: string, data: unknown): void;
  /** 开发者工具自带的行政区划数据，districts 到区县，streets 到街道 */
  loadRegionData(kind: RegionDataKind): Promise<string>;
}

export async function fetchRegionData(kind: RegionDataKind): Promise<string> {
  const res = await fetch(`/__wxa__/region/${kind}`);
  if (!res.ok) throw new Error('没有找到行政区划数据，地区选择器需要本机微信开发者工具自带的数据');
  return res.text();
}

export function createPickerApis({ showPicker, emitToWebview, loadRegionData }: PickerApiOptions): Record<string, ApiHandler> {
  let multiPicker: PickerSession | null = null;
  let regionTree: Promise<RegionNode[]> | null = null;

  const loadRegionTree = () => {
    regionTree ??= loadRegionData('streets').then(parseRegionTree);
    // 失败了下次重新加载
    regionTree.catch(() => {
      regionTree = null;
    });
    return regionTree;
  };

  /** 弹出列之间有联动的选择器：用户改了某列后，后面各列按 model 重新生成 */
  const showCascade = (model: CascadeModel) => {
    const session: PickerSession = showPicker({
      columns: model.columns(),
      current: model.current(),
      onColumnChange(column, index) {
        model.select(column, index);
        const columns = model.columns();
        const current = model.current();
        for (let next = column + 1; next < columns.length; next++) session.setColumn(next, columns[next], current[next]);
      }
    });
    return session.result;
  };

  return {
    showPickerView: async (args, { api }) => {
      const result = await showPicker({
        columns: [labels(args.array)],
        current: [Number(args.current) || 0]
      }).result;
      return result ? ok(api, { index: result[0] }) : fail(api, 'cancel');
    },

    showMultiPickerView: async (args, { api, webviewId }) => {
      const session = showPicker({
        columns: (args.array || []).map(labels),
        current: (args.current || []).map((index: unknown) => Number(index) || 0),
        onColumnChange: (column, current) => emitToWebview(webviewId, 'onMultiPickerViewChange', { column, current })
      });
      multiPicker = session;
      const result = await session.result;
      if (multiPicker === session) multiPicker = null;
      return result ? ok(api, { current: result }) : fail(api, 'cancel');
    },

    updateMultiPickerView: (args, { api }) => {
      if (!multiPicker) return fail(api, 'no picker is showing');
      multiPicker.setColumn(Number(args.column), labels(args.array), Number(args.current) || 0);
      return ok(api);
    },

    showDatePickerView: async (args, { api }) => {
      const model = new DateCascade(args.mode === 'time' ? 'time' : 'date', args.fields, args.range || {}, String(args.current || ''));
      const result = await showCascade(model);
      return result ? ok(api, { value: model.value() }) : fail(api, 'cancel');
    },

    showAddressPickerView: async (args, { api }) => {
      let tree: RegionNode[];
      try {
        tree = await loadRegionTree();
      } catch (error) {
        return fail(api, (error as Error).message);
      }
      const model = new RegionCascade(tree, REGION_LEVELS[args.mode] || 3, args.current || []);
      const result = await showCascade(model);
      return result ? ok(api, { value: model.value() }) : fail(api, 'cancel');
    },

    getRegionData: async (_args, { api }) => {
      try {
        return ok(api, { data: await loadRegionData('districts') });
      } catch (error) {
        return fail(api, (error as Error).message);
      }
    }
  };
}

function labels(items: unknown): string[] {
  return Array.isArray(items) ? items.map(item => String(item)) : [];
}

interface CascadeModel {
  columns(): string[][];
  current(): number[];
  select(column: number, index: number): void;
}

// -----------------------------------------------------------------------------
// 日期与时间
// -----------------------------------------------------------------------------

const DEFAULT_DATE_RANGE = { start: [1900, 1, 1], end: [2100, 12, 31] };
const DATE_DEPTH: Record<string, number> = { year: 1, month: 2, day: 3 };

/**
 * 每列是一段连续的数字（年、月、日或时、分）。某列的取值范围取决于前面各列：
 * 前面各列都落在 start 上时，这一列不能早于 start；end 同理；日的上限还取决于年月。
 * 改了某列后，后面各列保持原值，超出新范围时落到最近的边界（1 月 31 日切到 2 月变成 29 日）。
 */
class DateCascade implements CascadeModel {
  private readonly depth: number;
  private readonly min: number[];
  private readonly max: number[];
  private readonly parts: number[] = [];

  constructor(private readonly mode: 'date' | 'time', fields: unknown, range: { start?: string; end?: string }, current: string) {
    this.depth = mode === 'time' ? 2 : DATE_DEPTH[String(fields)] || 3;
    const lowest = mode === 'time' ? [0, 0] : DEFAULT_DATE_RANGE.start;
    const highest = mode === 'time' ? [23, 59] : DEFAULT_DATE_RANGE.end;
    this.min = fillParts(parseParts(range.start), lowest);
    this.max = fillParts(parseParts(range.end), highest);
    // 早于 start 或晚于 end 时整体落到那个边界，而不是逐列裁剪（2019-06-01 → 2020-03-15，而非 2020-06-01）
    let initial = fillParts(parseParts(current), lowest);
    if (compareParts(initial, this.min, this.depth) < 0) initial = this.min;
    else if (compareParts(initial, this.max, this.depth) > 0) initial = this.max;
    for (let column = 0; column < this.depth; column++) {
      const [low, high] = this.bounds(column);
      this.parts[column] = clamp(initial[column], low, high);
    }
  }

  columns(): string[][] {
    return this.parts.map((_, column) => {
      const [low, high] = this.bounds(column);
      return Array.from({ length: high - low + 1 }, (__, offset) => this.label(column, low + offset));
    });
  }

  current(): number[] {
    return this.parts.map((value, column) => value - this.bounds(column)[0]);
  }

  select(column: number, index: number) {
    this.parts[column] = this.bounds(column)[0] + index;
    for (let next = column + 1; next < this.depth; next++) {
      const [low, high] = this.bounds(next);
      this.parts[next] = clamp(this.parts[next], low, high);
    }
  }

  value(): string {
    if (this.mode === 'time') return this.parts.map(pad).join(':');
    return this.parts.map((value, column) => (column === 0 ? String(value) : pad(value))).join('-');
  }

  private bounds(column: number): [number, number] {
    const before = this.parts.slice(0, column);
    let [low, high] = this.naturalBounds(column);
    if (before.every((value, i) => value === this.min[i])) low = Math.max(low, this.min[column]);
    if (before.every((value, i) => value === this.max[i])) high = Math.min(high, this.max[column]);
    return [low, Math.max(low, high)];
  }

  private naturalBounds(column: number): [number, number] {
    if (this.mode === 'time') return column === 0 ? [0, 23] : [0, 59];
    if (column === 0) return [this.min[0], this.max[0]];
    if (column === 1) return [1, 12];
    return [1, new Date(this.parts[0], this.parts[1], 0).getDate()];
  }

  private label(column: number, value: number): string {
    if (this.mode === 'time') return pad(value);
    return column === 0 ? value + '年' : pad(value) + ['月', '日'][column - 1];
  }
}

function parseParts(text: string | undefined): number[] {
  return String(text || '').split(/[-:]/).filter(Boolean).map(Number).filter(part => Number.isInteger(part));
}

function fillParts(parts: number[], defaults: number[]): number[] {
  return parts.length ? defaults.map((value, i) => parts[i] ?? value) : defaults;
}

function compareParts(a: number[], b: number[], depth: number): number {
  for (let i = 0; i < depth; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// -----------------------------------------------------------------------------
// 地区
// -----------------------------------------------------------------------------

const REGION_LEVELS: Record<string, number> = { province: 1, city: 2, region: 3, 'sub-district': 4 };

interface RegionNode {
  name: string;
  code: string;
  postcode: string;
  children: RegionNode[];
}

/** 数据每行是「编码、名称、邮编」，以 tab 分隔，名称前的 tab 个数就是层级 */
function parseRegionTree(text: string): RegionNode[] {
  const roots: RegionNode[] = [];
  const lastAtDepth: RegionNode[] = [];
  for (const line of text.split('\n')) {
    const match = /^(\d+)(\t+)([^\t]+)\t(\d+)/.exec(line.trimEnd());
    if (!match) continue;
    const depth = match[2].length;
    const node: RegionNode = { code: match[1], name: match[3].trim(), postcode: match[4], children: [] };
    if (depth === 1) roots.push(node);
    else lastAtDepth[depth - 2]?.children.push(node);
    lastAtDepth[depth - 1] = node;
    lastAtDepth.length = depth;
  }
  return roots;
}

/** 省、市、区、街道逐级联动：改了上级后，下级回到新上级的第一项 */
class RegionCascade implements CascadeModel {
  private readonly path: number[];

  constructor(private readonly tree: RegionNode[], private readonly levels: number, names: unknown[]) {
    this.path = [];
    for (let level = 0; level < levels; level++) {
      const index = this.options(level).findIndex(node => node.name === names[level]);
      this.path[level] = Math.max(0, index);
    }
  }

  columns(): string[][] {
    return this.path.map((_, level) => this.options(level).map(node => node.name));
  }

  current(): number[] {
    return [...this.path];
  }

  select(column: number, index: number) {
    this.path[column] = index;
    for (let level = column + 1; level < this.levels; level++) this.path[level] = 0;
  }

  value(): { value: string[]; code: string[]; postcode: string } {
    const nodes = this.selectedNodes();
    return {
      value: nodes.map(node => node.name),
      code: nodes.map(node => node.code),
      postcode: nodes.at(-1)?.postcode ?? ''
    };
  }

  /** 某一级可选的节点：上一级选中节点的下级 */
  private options(level: number): RegionNode[] {
    if (level === 0) return this.tree;
    return this.selectedNodes(level).at(-1)?.children ?? [];
  }

  private selectedNodes(levels = this.levels): RegionNode[] {
    const nodes: RegionNode[] = [];
    let options = this.tree;
    for (let level = 0; level < levels; level++) {
      const node = options[this.path[level]];
      if (!node) break;
      nodes.push(node);
      options = node.children;
    }
    return nodes;
  }
}
