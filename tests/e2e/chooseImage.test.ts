/**
 * 端到端：选图、预览与保存图片
 *
 * 选图由宿主打开浏览器的文件选择框，测试用 Playwright 的 filechooser 直接给文件，不弹系统窗口。
 * 和真机一样，相册和拍摄都可选时先弹菜单。没有经过用户点击就选图时也先弹菜单，见 tests/unit/media.test.ts。
 * 网络图片（downloadFile、getImageInfo）的临时路径同样要能直接显示。
 */

import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { png } from '../helpers';
import { e2eReady, expectText, Runner, startRunner } from './runner';

const AVATAR = { name: 'avatar.png', mimeType: 'image/png', buffer: png(40, 30) };
const BANNER = { name: 'banner.png', mimeType: 'image/png', buffer: png(20, 10) };
const ICON = { name: 'icon.png', mimeType: 'image/png', buffer: png(8, 8) };
const REMOTE = { name: 'remote.png', mimeType: 'image/png', buffer: png(24, 12) };

const ALBUM_WXML = `
<button id="choose" bindtap="choose">选图</button>
<button id="choose-two" bindtap="chooseTwoFromAlbum">从相册选两张</button>
<button id="choose-media" bindtap="chooseMedia">chooseMedia 选图</button>
<button id="choose-video" bindtap="chooseVideo">chooseMedia 选视频</button>
<button id="upload" bindtap="upload">上传</button>
<button id="preview" bindtap="preview">预览</button>
<button id="chosen-info" bindtap="chosenImageInfo">所选图片信息</button>
<button id="package-info" bindtap="packageImageInfo">包内图片信息</button>
<button id="save" bindtap="save">保存到相册</button>
<button id="download" bindtap="download">下载网络图片</button>
<button id="network-info" bindtap="networkImageInfo">网络图片信息</button>
<view id="result">{{result}}</view>
<image wx:if="{{paths.length}}" src="{{paths[0]}}" bindload="onPhotoLoad" binderror="onPhotoError" style="width:40px;height:30px"></image>
<view id="photo">{{photo}}</view>
<view id="upload-result">{{uploadResult}}</view>
`;

const albumJs = (server: string) => `
Page({
  data: { result: '', paths: [], photo: '', uploadResult: '' },
  report(err) { this.setData({ result: err.errMsg }); },
  onChosen(res) {
    this.setData({ result: 'chosen ' + res.tempFiles.map(file => file.size).join(','), paths: res.tempFilePaths });
  },
  choose() {
    wx.chooseImage({ success: res => this.onChosen(res), fail: err => this.report(err) });
  },
  chooseTwoFromAlbum() {
    wx.chooseImage({ count: 2, sourceType: ['album'], success: res => this.onChosen(res), fail: err => this.report(err) });
  },
  chooseMedia() {
    wx.chooseMedia({
      mediaType: ['image'],
      success: res => this.setData({
        result: res.type + ' ' + res.tempFiles.map(file => file.fileType + ':' + file.size).join(','),
        paths: res.tempFiles.map(file => file.tempFilePath)
      }),
      fail: err => this.report(err)
    });
  },
  chooseVideo() {
    wx.chooseMedia({ mediaType: ['video'], success: () => this.setData({ result: 'chosen video' }), fail: err => this.report(err) });
  },
  onPhotoLoad(e) { this.setData({ photo: 'loaded ' + e.detail.width + 'x' + e.detail.height }); },
  onPhotoError(e) { this.setData({ photo: 'error ' + e.detail.errMsg }); },
  upload() {
    wx.uploadFile({
      url: '${server}/upload',
      filePath: this.data.paths[0],
      name: 'avatar',
      formData: { user: 'u1' },
      success: res => this.setData({ uploadResult: res.statusCode + ' ' + res.data }),
      fail: err => this.setData({ uploadResult: err.errMsg })
    });
  },
  preview() {
    wx.previewImage({
      urls: this.data.paths,
      current: this.data.paths[1],
      success: () => this.setData({ result: 'previewing' }),
      fail: err => this.report(err)
    });
  },
  showImageInfo(src) {
    wx.getImageInfo({ src, success: res => this.setData({ result: res.width + 'x' + res.height + ' ' + res.type }), fail: err => this.report(err) });
  },
  chosenImageInfo() { this.showImageInfo(this.data.paths[0]); },
  packageImageInfo() { this.showImageInfo('/images/logo.png'); },
  save() {
    wx.saveImageToPhotosAlbum({ filePath: this.data.paths[0], success: res => this.report(res), fail: err => this.report(err) });
  },
  download() {
    wx.downloadFile({
      url: '${server}/remote.png',
      success: res => this.setData({ result: 'downloaded ' + res.statusCode, paths: [res.tempFilePath] }),
      fail: err => this.report(err)
    });
  },
  networkImageInfo() {
    wx.getImageInfo({
      src: '${server}/remote.png',
      success: res => this.setData({ result: res.width + 'x' + res.height + ' ' + res.type, paths: [res.path] }),
      fail: err => this.report(err)
    });
  }
});
`;

const ALBUM_PAGE = '/?path=pages/album/album';

describe.skipIf(!e2eReady)('选图、预览与保存图片', () => {
  let runner: Runner;
  // 业务服务器：接收上传，提供网络图片
  let server: http.Server;
  const uploads: Buffer[] = [];

  const sheetButton = (name: string) => runner.page.getByRole('button', { name, exact: true });
  const sheetItems = () => runner.page.locator('.wxa-actionsheet button').allTextContents();
  const preview = () => runner.page.getByRole('dialog', { name: '图片预览' });

  /** 触发后等宿主打开文件选择框，选中这些文件；不给文件表示用户关掉了选择框 */
  async function pickFiles(trigger: () => Promise<unknown>, files: Array<typeof AVATAR>) {
    const [chooser] = await Promise.all([runner.page.waitForEvent('filechooser'), trigger()]);
    await chooser.setFiles(files);
    return chooser;
  }

  /** 打开页面，从相册选好这些图片 */
  async function openWithChosen(...files: Array<typeof AVATAR>) {
    const frame = await runner.open(ALBUM_PAGE);
    await pickFiles(() => frame.click('#choose-two'), files);
    await expectText(frame, '#result', 'chosen ' + files.map(file => file.buffer.length).join(','));
    return frame;
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.setHeader('content-type', 'image/png');
        res.end(REMOTE.buffer);
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        uploads.push(Buffer.concat(chunks));
        res.end('received');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    runner = await startRunner({
      'app.json': { pages: ['pages/album/album'] },
      'images/logo.png': png(16, 8),
      'pages/album/album.json': {},
      'pages/album/album.wxml': ALBUM_WXML,
      'pages/album/album.js': albumJs(serverUrl)
    });
    // 等不到文件选择框、菜单时尽快失败，不等满 Playwright 默认的 30 秒
    runner.page.setDefaultTimeout(5000);
  });

  afterEach(async () => {
    expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
  });

  afterAll(async () => {
    await runner?.close();
    server?.close();
  });

  describe('chooseImage', () => {
    it('用户从相册选了图片后，页面拿到的临时路径能直接作为 image 显示，tempFiles 里带文件大小', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await frame.click('#choose');
      await sheetButton('从手机相册选择').waitFor();
      expect(await sheetItems()).toEqual(['拍摄', '从手机相册选择', '取消']);
      await pickFiles(() => sheetButton('从手机相册选择').click(), [AVATAR]);

      await expectText(frame, '#result', `chosen ${AVATAR.buffer.length}`);
      await expectText(frame, '#photo', 'loaded 40x30');
    });

    it('用户选好的图片可以直接用 uploadFile 上传，服务器收到原文件和表单字段', async () => {
      const frame = await openWithChosen(AVATAR);
      uploads.length = 0;

      await frame.click('#upload');

      await expectText(frame, '#upload-result', '200 received');
      expect(uploads).toHaveLength(1);
      expect(uploads[0].includes(AVATAR.buffer)).toBe(true);
      expect(uploads[0].toString('latin1')).toContain('name="avatar"');
      expect(uploads[0].toString('latin1')).toMatch(/name="user"\r\n\r\nu1\r\n/);
    });

    it('用户在弹出的菜单里点取消时，页面收到 cancel', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await frame.click('#choose');
      await sheetButton('取消').click();

      await expectText(frame, '#result', 'chooseImage:fail cancel');
    });

    it('用户打开文件选择框后没选就关掉，页面收到 cancel', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await pickFiles(() => frame.click('#choose-two'), []);

      await expectText(frame, '#result', 'chooseImage:fail cancel');
    });

    it('只允许从相册选时不弹菜单，直接打开文件选择框，count 大于 1 时可以多选', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      const [chooser] = await Promise.all([runner.page.waitForEvent('filechooser'), frame.click('#choose-two')]);

      expect(await runner.page.locator('.wxa-actionsheet').count()).toBe(0);
      expect(chooser.isMultiple()).toBe(true);
      await chooser.setFiles([AVATAR]);
      await expectText(frame, '#result', `chosen ${AVATAR.buffer.length}`);
    });

    it('用户选的图片多于 count 时，只返回前 count 张', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await pickFiles(() => frame.click('#choose-two'), [AVATAR, BANNER, ICON]);

      await expectText(frame, '#result', `chosen ${AVATAR.buffer.length},${BANNER.buffer.length}`);
    });
  });

  describe('chooseMedia', () => {
    it('用户用 chooseMedia 选了图片后，返回 type 为 image，文件带临时路径、大小和类型，路径能直接显示', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await frame.click('#choose-media');
      await pickFiles(() => sheetButton('从手机相册选择').click(), [AVATAR]);

      await expectText(frame, '#result', `image image:${AVATAR.buffer.length}`);
      await expectText(frame, '#photo', 'loaded 40x30');
    });

    it('页面只要视频时 chooseMedia 直接失败，说明暂不支持选视频', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await frame.click('#choose-video');

      await expectText(frame, '#result', /^chooseMedia:fail .*视频/);
    });
  });

  describe('预览、图片信息与保存', () => {
    it('页面调用 previewImage 后宿主全屏显示 current 那张，用户可以切换，点图片后关闭', async () => {
      const frame = await openWithChosen(AVATAR, BANNER);
      // 等预览层当前显示的图片加载完，返回它的原始宽度
      const shownWidth = () => preview().locator('img').evaluate(async img => {
        await (img as HTMLImageElement).decode();
        return (img as HTMLImageElement).naturalWidth;
      });

      await frame.click('#preview');

      await expectText(frame, '#result', 'previewing');
      expect(await shownWidth()).toBe(20);
      expect(await preview().getByText('2/2').count()).toBe(1);

      await preview().getByRole('button', { name: '上一张' }).click();
      expect(await shownWidth()).toBe(40);
      expect(await preview().getByText('1/2').count()).toBe(1);

      await preview().locator('img').click();
      await preview().waitFor({ state: 'detached' });
    });

    it('getImageInfo 返回用户所选图片的宽高和格式', async () => {
      const frame = await openWithChosen(AVATAR);

      await frame.click('#chosen-info');

      await expectText(frame, '#result', '40x30 png');
    });

    it('getImageInfo 也能读取小程序包内的图片', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await frame.click('#package-info');

      await expectText(frame, '#result', '16x8 png');
    });

    it('用户把图片保存到相册时，浏览器下载这张图片', async () => {
      const frame = await openWithChosen(AVATAR);

      const [download] = await Promise.all([runner.page.waitForEvent('download'), frame.click('#save')]);

      await expectText(frame, '#result', 'saveImageToPhotosAlbum:ok');
      expect(download.suggestedFilename()).toMatch(/\.png$/);
      expect(fs.readFileSync((await download.path())!).equals(AVATAR.buffer)).toBe(true);
    });
  });

  describe('网络图片', () => {
    it('页面用 downloadFile 下载的图片，临时路径能直接作为 image 显示', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await frame.click('#download');

      await expectText(frame, '#result', 'downloaded 200');
      await expectText(frame, '#photo', 'loaded 24x12');
    });

    it('getImageInfo 读取网络图片时返回宽高和格式，返回的 path 能直接作为 image 显示', async () => {
      const frame = await runner.open(ALBUM_PAGE);

      await frame.click('#network-info');

      await expectText(frame, '#result', '24x12 png');
      await expectText(frame, '#photo', 'loaded 24x12');
    });
  });
});
