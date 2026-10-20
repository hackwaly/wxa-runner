/**
 * 端到端：画布与相机
 *
 * 旧版 canvas（canvas-id）的绘制指令由逻辑层发出、不指定目标页面；
 * 导出图片和拍照得到的临时文件要能直接作为 image 的 src 显示，也要能画到旧版 canvas 上。
 *
 * type="2d" 和 webgl 画布由基础库建在逻辑层的文档里，宿主把它们搬进页面里的 wx-canvas，和真机一样参与页面的层级。
 * 用户看到的效果只有截图能验证。
 */

import http from 'http';
import type { AddressInfo } from 'net';
import type { Frame, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import zlib from 'zlib';
import { png } from '../helpers';
import { e2eReady, expectText, Runner, startRunner } from './runner';

const CANVAS_WXML = `
<canvas canvas-id="legacy" style="width:100px;height:100px"></canvas>
<canvas type="2d" id="modern" style="width:120px;height:80px"></canvas>
<view id="drawn">{{drawn}}</view>
<view id="legacy-pixel">{{legacyPixel}}</view>
<image wx:if="{{exportedFile}}" src="{{exportedFile}}" bindload="onExportedLoad" binderror="onExportedError" style="width:120px;height:80px"></image>
<view id="exported">{{exported}}</view>
<image wx:if="{{legacyFile}}" src="{{legacyFile}}" bindload="onLegacyExportedLoad" style="width:100px;height:100px"></image>
<view id="legacy-exported">{{legacyExported}}</view>
`;

const CANVAS_JS = `
Page({
  data: { drawn: '', legacyPixel: '', exportedFile: '', exported: '', legacyFile: '', legacyExported: '' },
  onReady() {
    const ctx = wx.createCanvasContext('legacy', this);
    ctx.setFillStyle('#ff0000');
    ctx.fillRect(0, 0, 100, 100);
    ctx.draw(false, () => {
      this.setData({ drawn: 'yes' });
      wx.canvasGetImageData({
        canvasId: 'legacy', x: 50, y: 50, width: 1, height: 1,
        success: res => this.setData({ legacyPixel: Array.from(res.data).join(',') }),
        fail: err => this.setData({ legacyPixel: err.errMsg })
      }, this);
      wx.canvasToTempFilePath({
        canvasId: 'legacy',
        success: r => this.setData({ legacyFile: r.tempFilePath, legacyExported: r.tempFilePath ? '' : 'empty path' }),
        fail: err => this.setData({ legacyExported: 'fail ' + err.errMsg })
      }, this);
    });

    wx.createSelectorQuery().select('#modern').fields({ node: true, size: true }).exec(([res]) => {
      const canvas = res.node;
      const c = canvas.getContext('2d');
      c.fillStyle = '#00ff00';
      c.fillRect(0, 0, canvas.width, canvas.height);
      wx.canvasToTempFilePath({
        canvas,
        success: r => this.setData({ exportedFile: r.tempFilePath, exported: r.tempFilePath ? '' : 'empty path' }),
        fail: err => this.setData({ exported: 'fail ' + err.errMsg })
      });
    });
  },
  onExportedLoad(e) { this.setData({ exported: 'loaded ' + e.detail.width + 'x' + e.detail.height }); },
  onExportedError(e) { this.setData({ exported: 'error ' + e.detail.errMsg }); },
  onLegacyExportedLoad(e) { this.setData({ legacyExported: 'loaded ' + e.detail.width + 'x' + e.detail.height }); }
});
`;

// 先导出一张纯蓝的临时文件，再分别画到页面里和组件里的旧版画布上，读回中心像素
const REDRAW_WXML = `
<canvas canvas-id="source" style="width:40px;height:40px"></canvas>
<canvas canvas-id="page-redraw" style="width:40px;height:40px"></canvas>
<painter src="{{sourceFile}}" bindpainted="onComponentPainted"></painter>
<view id="page-pixel">{{pagePixel}}</view>
<view id="component-pixel">{{componentPixel}}</view>
`;

const REDRAW_JS = `
Page({
  data: { sourceFile: '', pagePixel: '', componentPixel: '' },
  onReady() {
    const source = wx.createCanvasContext('source', this);
    source.setFillStyle('#0000ff');
    source.fillRect(0, 0, 40, 40);
    source.draw(false, () => wx.canvasToTempFilePath({
      canvasId: 'source',
      success: res => {
        this.setData({ sourceFile: res.tempFilePath });
        this.paint(res.tempFilePath);
      },
      fail: err => this.setData({ pagePixel: 'export fail ' + err.errMsg })
    }, this));
  },
  paint(src) {
    const ctx = wx.createCanvasContext('page-redraw', this);
    ctx.drawImage(src, 0, 0, 40, 40);
    ctx.draw(false, () => wx.canvasGetImageData({
      canvasId: 'page-redraw', x: 20, y: 20, width: 1, height: 1,
      success: res => this.setData({ pagePixel: Array.from(res.data).join(',') }),
      fail: err => this.setData({ pagePixel: err.errMsg })
    }, this));
  },
  onComponentPainted(e) { this.setData({ componentPixel: e.detail.pixel }); }
});
`;

const PAINTER_JS = `
Component({
  properties: { src: { type: String, value: '', observer: 'paint' } },
  methods: {
    paint(src) {
      if (!src) return;
      const ctx = wx.createCanvasContext('painter', this);
      ctx.drawImage(src, 0, 0, 40, 40);
      ctx.draw(false, () => wx.canvasGetImageData({
        canvasId: 'painter', x: 20, y: 20, width: 1, height: 1,
        success: res => this.triggerEvent('painted', { pixel: Array.from(res.data).join(',') }),
        fail: err => this.triggerEvent('painted', { pixel: err.errMsg })
      }, this));
    }
  }
});
`;

const CAMERA_WXML = `
<camera bindinitdone="onCameraReady" binderror="onCameraError" style="width:200px;height:150px"></camera>
<button id="shoot" bindtap="shoot">拍照</button>
<view id="camera-state">{{state}}</view>
<image wx:if="{{photoFile}}" src="{{photoFile}}" bindload="onPhotoLoad" binderror="onPhotoError" style="width:200px;height:150px"></image>
<view id="photo">{{photo}}</view>
`;

const CAMERA_JS = `
Page({
  data: { state: '', photoFile: '', photo: '' },
  onCameraReady() { this.setData({ state: 'ready' }); },
  onCameraError(e) { this.setData({ state: 'error ' + e.detail.errMsg }); },
  shoot() {
    wx.createCameraContext().takePhoto({
      quality: 'low',
      success: r => this.setData({ photoFile: r.tempImagePath, photo: r.tempImagePath ? '' : 'empty path' }),
      fail: err => this.setData({ photo: 'fail ' + err.errMsg })
    });
  },
  onPhotoLoad(e) { this.setData({ photo: 'loaded ' + e.detail.width + 'x' + e.detail.height }); },
  onPhotoError(e) { this.setData({ photo: 'error ' + e.detail.errMsg }); }
});
`;

describe.skipIf(!e2eReady)('画布与相机', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/canvas/canvas', 'pages/redraw/redraw', 'pages/camera/camera'] },
      'pages/canvas/canvas.json': {},
      'pages/canvas/canvas.wxml': CANVAS_WXML,
      'pages/canvas/canvas.js': CANVAS_JS,
      'pages/redraw/redraw.json': { usingComponents: { painter: '/components/painter/painter' } },
      'pages/redraw/redraw.wxml': REDRAW_WXML,
      'pages/redraw/redraw.js': REDRAW_JS,
      'components/painter/painter.json': { component: true },
      'components/painter/painter.wxml': '<canvas canvas-id="painter" style="width:40px;height:40px"></canvas>',
      'components/painter/painter.js': PAINTER_JS,
      'pages/camera/camera.json': {},
      'pages/camera/camera.wxml': CAMERA_WXML,
      'pages/camera/camera.js': CAMERA_JS
    }, {
      // 用 Chrome 自带的模拟摄像头，不弹授权框
      chromeArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      permissions: ['camera']
    });
  });

  afterAll(() => runner?.close());

  it('页面在 canvas-id 画布上绘制后，draw 回调触发，读回的像素是画上去的颜色', async () => {
    const frame = await runner.open('/?path=pages/canvas/canvas');
    await expectText(frame, '#drawn', 'yes');
    await expectText(frame, '#legacy-pixel', '255,0,0,255');
  });

  it('canvasToTempFilePath 导出的图片可以直接作为 image 的 src 显示，新旧两种画布都可以', async () => {
    const frame = await runner.open('/?path=pages/canvas/canvas');
    await expectText(frame, '#exported', /^loaded [1-9]\d*x[1-9]\d*$/);
    await expectText(frame, '#legacy-exported', /^loaded [1-9]\d*x[1-9]\d*$/);
  });

  it('页面和组件里的 canvas-id 画布画上临时文件里的图片后，读回的像素是图片的颜色', async () => {
    const frame = await runner.open('/?path=pages/redraw/redraw');
    await expectText(frame, '#page-pixel', '0,0,255,255');
    await expectText(frame, '#component-pixel', '0,0,255,255');
  });

  it('用户拍照后得到的照片可以直接作为 image 的 src 显示', async () => {
    const frame = await runner.open('/?path=pages/camera/camera');
    await expectText(frame, '#camera-state', 'ready');
    await frame.click('#shoot');
    await expectText(frame, '#photo', /^loaded [1-9]\d*x[1-9]\d*$/);
  });
});

// 上面留出 300px，滚动 200px 后画布仍在屏幕里
const BOARD_WXML = `
<view style="height:300px"></view>
<canvas type="2d" id="board" style="display:block;width:120px;height:80px"></canvas>
<canvas type="webgl" id="gl" style="display:block;width:120px;height:80px"></canvas>
<view id="drawn">{{drawn}}</view>
<view style="height:2000px"></view>
`;

const BOARD_JS = `
Page({
  data: { drawn: '' },
  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#board').fields({ node: true });
    query.select('#gl').fields({ node: true });
    query.exec(([board, gl]) => {
      const ctx = board.node.getContext('2d');
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, board.node.width, board.node.height);
      const webgl = gl.node.getContext('webgl');
      webgl.clearColor(0, 0, 1, 1);
      webgl.clear(webgl.COLOR_BUFFER_BIT);
      this.setData({ drawn: 'yes' });
    });
  }
});
`;

// 组件里的画布涂成绿色，页面上一条 fixed 的红条横着盖住它的中间
const LAYER_WXML = `
<pad bind:drawn="onDrawn"></pad>
<view id="cover" style="position:fixed;left:0;right:0;top:40px;height:40px;background:#ff0000"></view>
<view id="drawn">{{drawn}}</view>
`;

const PAD_JS = `
Component({
  lifetimes: {
    ready() {
      this.createSelectorQuery().select('#pad').fields({ node: true }).exec(([res]) => {
        const ctx = res.node.getContext('2d');
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(0, 0, res.node.width, res.node.height);
        this.triggerEvent('drawn');
      });
    }
  }
});
`;

// 左半边画包内的红图，右半边画另一个域名上的蓝图，再从画布读回像素并导出；另有一张地址格式不对的图
const IMAGES_WXML = `
<canvas type="2d" id="pad" style="width:40px;height:20px"></canvas>
<view id="package-pixel">{{packagePixel}}</view>
<view id="remote-pixel">{{remotePixel}}</view>
<view id="invalid">{{invalid}}</view>
<view id="exported">{{exported}}</view>
`;

const IMAGES_JS = `
Page({
  data: { packagePixel: '', remotePixel: '', invalid: '', exported: '' },
  onLoad(query) { this.remote = decodeURIComponent(query.remote); },
  onReady() {
    wx.createSelectorQuery().select('#pad').fields({ node: true }).exec(([res]) => {
      const canvas = res.node;
      canvas.width = 40;
      canvas.height = 20;
      const ctx = canvas.getContext('2d');
      const draw = (src, x, key) => new Promise(resolve => {
        const image = canvas.createImage();
        image.onload = () => {
          try {
            ctx.drawImage(image, x, 0, 20, 20);
            this.setData({ [key]: Array.from(ctx.getImageData(x + 10, 10, 1, 1).data).join(',') });
          } catch (err) {
            this.setData({ [key]: err.name });
          }
          resolve();
        };
        image.onerror = () => {
          this.setData({ [key]: 'load error' });
          resolve();
        };
        image.src = src;
      });
      Promise.all([
        draw('/images/red.png', 0, 'packagePixel'),
        draw(this.remote, 20, 'remotePixel'),
        draw('http://', 0, 'invalid')
      ]).then(() => wx.canvasToTempFilePath({
        canvas,
        success: r => this.setData({ exported: r.tempFilePath ? 'ok' : 'empty path' }),
        fail: err => this.setData({ exported: 'fail ' + err.errMsg })
      }));
    });
  }
});
`;

type Point = { x: number; y: number };

const COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255], red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255]
};

/** 1×1 截图里那个像素的颜色名，不在 COLORS 里时返回 r,g,b */
function colorOf(shot: Buffer): string {
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < shot.length;) {
    const length = shot.readUInt32BE(offset);
    if (shot.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(shot.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  // 只有一个像素，没有左边和上边的像素可参考，不管行首的过滤类型是什么，存的都是原值
  const rgb = [...zlib.inflateSync(Buffer.concat(chunks)).subarray(1, 4)];
  const name = Object.keys(COLORS).find(key => COLORS[key].every((value, i) => Math.abs(value - rgb[i]) <= 24));
  return name || rgb.join(',');
}

describe.skipIf(!e2eReady)('2d 与 webgl 画布', () => {
  let runner: Runner;
  let remote: http.Server;
  let remoteImage = '';

  /** 宿主页面上这一点实际显示的颜色 */
  const colorAt = async (point: Point) =>
    colorOf(await runner.page.screenshot({ clip: { x: Math.round(point.x), y: Math.round(point.y), width: 1, height: 1 } }));
  const waitForColor = (point: Point, color: string) =>
    vi.waitFor(async () => expect(await colorAt(point)).toBe(color), { timeout: 3000 });
  const centerOf = async (frame: Frame, selector: string): Promise<Point> => {
    const box = (await frame.locator(selector).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const openBoard = async () => {
    const frame = await runner.open('/?path=pages/board/board');
    await expectText(frame, '#drawn', 'yes');
    return frame;
  };
  const navigate = (page: Page, action: 'navigateTo' | 'navigateBack') =>
    page.evaluate(([name]) => (name === 'navigateTo'
      ? window.__wxa_test_api__.navigateTo('/pages/blank/blank')
      : window.__wxa_test_api__.navigateBack()), [action] as const);

  beforeAll(async () => {
    // 和开发服务器不同源，也不带 CORS 响应头
    remote = http.createServer((_req, res) => {
      res.setHeader('content-type', 'image/png');
      res.end(png(20, 20, [0, 0, 255]));
    });
    await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve));
    remoteImage = `http://127.0.0.1:${(remote.address() as AddressInfo).port}/blue.png`;

    runner = await startRunner({
      'app.json': { pages: ['pages/board/board', 'pages/blank/blank', 'pages/layer/layer', 'pages/images/images'] },
      'pages/board/board.json': {},
      'pages/board/board.wxml': BOARD_WXML,
      'pages/board/board.js': BOARD_JS,
      'pages/blank/blank.json': {},
      'pages/blank/blank.wxml': '<view>blank</view>',
      'pages/blank/blank.js': 'Page({});',
      'pages/layer/layer.json': { usingComponents: { pad: '/components/pad/pad' } },
      'pages/layer/layer.wxml': LAYER_WXML,
      'pages/layer/layer.js': "Page({ data: { drawn: '' }, onDrawn() { this.setData({ drawn: 'yes' }); } });",
      'components/pad/pad.json': { component: true },
      'components/pad/pad.wxml': '<canvas type="2d" id="pad" style="display:block;width:120px;height:120px"></canvas>',
      'components/pad/pad.js': PAD_JS,
      'pages/images/images.json': {},
      'pages/images/images.wxml': IMAGES_WXML,
      'pages/images/images.js': IMAGES_JS,
      'images/red.png': png(20, 20, [255, 0, 0])
    });
  });

  afterAll(async () => {
    await runner?.close();
    remote?.close();
  });

  it('页面在 type="2d" 和 webgl 画布上画的内容，显示在页面上画布所在的位置', async () => {
    const frame = await openBoard();
    const board = await centerOf(frame, '#board');
    await waitForColor(board, 'green');
    await waitForColor(await centerOf(frame, '#gl'), 'blue');
    // 画布右边还是页面本身
    expect(await colorAt({ x: board.x + 100, y: board.y })).toBe('white');
  });

  it('用户滚动页面后，画布上的内容跟着画布一起移动', async () => {
    const frame = await openBoard();
    const before = await centerOf(frame, '#board');
    await waitForColor(before, 'green');

    await frame.evaluate(() => window.scrollTo(0, 200));
    const after = await centerOf(frame, '#board');
    expect(after.y).toBe(before.y - 200);
    await waitForColor(after, 'green');
    await waitForColor(before, 'white');
  });

  it('打开新页面后上一页的画布不再显示，返回后重新显示', async () => {
    const frame = await openBoard();
    const board = await centerOf(frame, '#board');
    await waitForColor(board, 'green');

    await navigate(runner.page, 'navigateTo');
    await waitForColor(board, 'white');
    await navigate(runner.page, 'navigateBack');
    await waitForColor(board, 'green');
  });

  it('页面里的元素照常按层级盖在画布上：fixed 的浮层挡住组件里画布的中间一段，和真机一样', async () => {
    const frame = await runner.open('/?path=pages/layer/layer');
    await expectText(frame, '#drawn', 'yes');
    const pad = (await frame.locator('wx-canvas').boundingBox())!;
    const cover = (await frame.locator('#cover').boundingBox())!;
    const x = pad.x + pad.width / 2;
    await waitForColor({ x, y: pad.y + 20 }, 'green');
    expect(await colorAt({ x, y: cover.y + cover.height / 2 })).toBe('red');
    expect(await colorAt({ x, y: pad.y + 100 })).toBe('green');
  });

  it('canvas.createImage 加载包内图片和其他域名的网络图片，画到画布上后读得回像素，也能导出；地址格式不对时走 onerror，不在赋值时抛错', async () => {
    const frame = await runner.open(`/?path=pages/images/images&remote=${encodeURIComponent(remoteImage)}`);
    await expectText(frame, '#package-pixel', '255,0,0,255');
    await expectText(frame, '#remote-pixel', '0,0,255,255');
    await expectText(frame, '#invalid', 'load error');
    await expectText(frame, '#exported', 'ok');
  });
});
