/**
 * 选择器弹层：从底部弹出，若干列可滚动的选项，中间一行是选中项
 *
 * 外观照开发者工具模拟 iPhone 时的 WeUI picker。header-text 不显示：官方文档注明它仅安卓可用，
 * 开发者工具模拟 iPhone 时也不显示。
 * 用户可以滚动到某一项，也可以直接点它。列之间的联动（日期的天数、省市区）不在这里，
 * 由调用方在 onColumnChange 里用 setColumn 换掉后面的列。
 */

import { element } from './dom';
import { PICKER_ITEM_HEIGHT } from './styles';

export interface PickerOptions {
  /** 每列的选项文字 */
  columns: string[][];
  /** 每列初始选中的下标 */
  current: number[];
  /** 用户改变某列的选中项后调用；setColumn 引起的变化不会触发 */
  onColumnChange?: (column: number, index: number) => void;
}

export interface PickerSession {
  /** 确定时为各列选中的下标，取消时为 null */
  result: Promise<number[] | null>;
  /** 替换某列的选项和选中项 */
  setColumn(column: number, items: string[], current: number): void;
}

/** 滚动停下多久后按位置确定选中项 */
const SCROLL_SETTLE_DELAY = 100;

export function openPicker(container: HTMLElement, options: PickerOptions): PickerSession {
  let resolve!: (value: number[] | null) => void;
  const result = new Promise<number[] | null>(done => {
    resolve = done;
  });

  const layer = element('div', 'wxa-picker-layer');
  const mask = element('div', 'wxa-mask is-dim');
  const sheet = element('div', 'wxa-picker');
  sheet.setAttribute('role', 'dialog');
  const header = element('div', 'wxa-picker-header');
  const cancel = element('button', 'wxa-picker-cancel', '取消');
  const confirm = element('button', 'wxa-picker-confirm', '确定');
  header.append(cancel, confirm);
  const body = element('div', 'wxa-picker-body');
  const columns = options.columns.map((_, index) => new PickerColumn(next => options.onColumnChange?.(index, next)));
  body.append(...columns.map(column => column.el), element('div', 'wxa-picker-mask'), element('div', 'wxa-picker-indicator'));
  sheet.append(header, body);
  layer.append(mask, sheet);
  container.appendChild(layer);
  // 滚动位置要在元素进入文档后才能设置
  columns.forEach((column, index) => column.setItems(options.columns[index], options.current[index] ?? 0));

  const close = (value: number[] | null) => {
    layer.remove();
    resolve(value);
  };
  cancel.addEventListener('click', () => close(null));
  mask.addEventListener('click', () => close(null));
  confirm.addEventListener('click', () => {
    // 还在滚动中的列先按当前位置定下来，联动的列随之更新
    columns.forEach(column => column.settle());
    close(columns.map(column => column.index));
  });

  return {
    result,
    setColumn(column, items, current) {
      columns[column]?.setItems(items, current);
    }
  };
}

class PickerColumn {
  readonly el = element('div', 'wxa-picker-column');
  index = 0;
  private items: HTMLElement[] = [];
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onUserChange: (index: number) => void) {
    this.el.addEventListener('scroll', () => {
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.settle(), SCROLL_SETTLE_DELAY);
    });
    this.el.addEventListener('click', event => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('.wxa-picker-item');
      if (item) this.choose(Number(item.dataset.index));
    });
  }

  setItems(labels: string[], current: number) {
    this.items = labels.map((label, index) => {
      const item = element('div', 'wxa-picker-item', label);
      item.dataset.index = String(index);
      return item;
    });
    this.el.replaceChildren(...this.items);
    this.show(Math.min(Math.max(0, current), Math.max(0, labels.length - 1)));
  }

  /** 滚动停下后，选中停在中间那一行的项 */
  settle() {
    clearTimeout(this.settleTimer);
    if (!this.items.length) return;
    const index = Math.min(this.items.length - 1, Math.max(0, Math.round(this.el.scrollTop / PICKER_ITEM_HEIGHT)));
    this.choose(index);
  }

  private choose(index: number) {
    const changed = index !== this.index;
    this.show(index);
    if (changed) this.onUserChange(index);
  }

  private show(index: number) {
    this.items[this.index]?.classList.remove('is-selected');
    this.index = index;
    this.items[index]?.classList.add('is-selected');
    this.el.scrollTo({ top: index * PICKER_ITEM_HEIGHT, behavior: 'instant' });
  }
}
