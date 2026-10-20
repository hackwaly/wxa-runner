/**
 * 媒体 API：选图和视频（chooseImage / chooseMedia / chooseVideo）、预览、读取图片信息、保存到相册
 *
 * 浏览器拿不到相册和相机，「从手机相册选择」和「拍摄」都打开文件选择框（手机浏览器上拍摄会打开相机）。
 * 选中的文件存成临时文件，路径可以直接作为 image、video 的 src，也可以直接 uploadFile。
 */

import type { FileChooserOptions } from '../ui/fileChooser';
import type { ActionSheetOptions } from '../ui/PhoneShell';
import { ApiHandler, fail, ok } from './registry';
import { saveTempFile, tempFileType } from './tempFiles';

export interface MediaApiOptions {
  /** @returns 用户点的下标，取消时为 null */
  showActionSheet: (options: ActionSheetOptions) => Promise<number | null>;
  /** @returns 用户关掉文件选择框时为 null */
  chooseFiles: (options: FileChooserOptions) => Promise<File[] | null>;
  /** 用户刚点击过、浏览器允许打开文件选择框 */
  hasUserActivation: () => boolean;
  showImagePreview: (urls: string[], current: number) => void;
}

type Source = 'camera' | 'album';
type MediaKind = 'image' | 'video';

/** 菜单里的顺序和真机一致 */
const SOURCES: Source[] = ['camera', 'album'];
const SOURCE_LABELS: Record<Source, string> = { camera: '拍摄', album: '从手机相册选择' };
const DEFAULT_COUNT = 9;
const MEDIA_KINDS: MediaKind[] = ['image', 'video'];
const FIRST_FRAME_TIMEOUT = 1000;

const countOf = (args: { count?: number }) => Math.max(1, Number(args.count) || DEFAULT_COUNT);

export function createMediaApis(
  { showActionSheet, chooseFiles, hasUserActivation, showImagePreview }: MediaApiOptions
): Record<string, ApiHandler> {
  /**
   * 和真机一样，相册和拍摄都可选时先弹菜单。浏览器只允许在用户点击后的几秒内打开文件选择框，
   * 没有经过点击、或者离点击已经太久时也先弹菜单，用户点菜单就是一次点击
   * @param accept 文件选择框接受的类型，如 image/*
   * @returns 用户取消时为 null；没有按 count 截取，可能比 count 多
   */
  async function pickFiles(args: { count?: number; sourceType?: string[] }, accept: string): Promise<File[] | null> {
    const allowed = SOURCES.filter(source => args.sourceType?.includes(source));
    const sources = allowed.length ? allowed : SOURCES;
    let source = sources[0];
    if (sources.length > 1 || !hasUserActivation()) {
      const index = await showActionSheet({ itemList: sources.map(item => SOURCE_LABELS[item]) });
      if (index === null) return null;
      source = sources[index];
    }

    return chooseFiles({ accept, multiple: countOf(args) > 1, capture: source === 'camera' });
  }

  const saveImage = (file: File) => saveTempFile(file, tempFileType(file.name, file.type, 'jpg'));

  return {
    chooseImage: async (args, { api }) => {
      const files = (await pickFiles(args, 'image/*'))?.slice(0, countOf(args));
      if (!files) return fail(api, 'cancel');
      const paths = await Promise.all(files.map(saveImage));
      return ok(api, { tempFilePaths: paths, tempFiles: files.map((file, i) => ({ path: paths[i], size: file.size })) });
    },

    chooseMedia: async (args, { api }) => {
      const mediaType: string[] = args.mediaType?.length ? args.mediaType : MEDIA_KINDS;
      const mix = mediaType.includes('mix');
      const requested = MEDIA_KINDS.filter(kind => mix || mediaType.includes(kind));
      const kinds = requested.length ? requested : MEDIA_KINDS;
      const picked = await pickFiles(args, kinds.map(kind => `${kind}/*`).join(','));
      if (!picked) return fail(api, 'cancel');

      const kindOf = (file: File): MediaKind => kinds.length === 1 ? kinds[0] : file.type.startsWith('video/') ? 'video' : 'image';
      // 不允许混选时和开发者工具一样：选了视频就只要视频
      const videos = picked.filter(file => kindOf(file) === 'video');
      const files = (mix || !videos.length ? picked : videos).slice(0, countOf(args));
      const tempFiles = await Promise.all(files.map(async file => kindOf(file) === 'video'
        ? { ...await saveVideo(file), fileType: 'video' }
        : { tempFilePath: await saveImage(file), size: file.size, fileType: 'image' }));
      // 允许混选时开发者工具总是返回 mix，不看实际选了什么
      return ok(api, { type: mix ? 'mix' : tempFiles[0].fileType, tempFiles });
    },

    chooseVideo: async (args, { api }) => {
      const file = (await pickFiles({ sourceType: args.sourceType, count: 1 }, 'video/*'))?.[0];
      if (!file) return fail(api, 'cancel');
      // 文档没列 thumbTempFilePath，开发者工具也会返回
      return ok(api, await saveVideo(file));
    },

    // 基础库已经把 current 换成了 urls 里的地址；也兼容直接传下标
    previewImage: args => {
      const urls: string[] = (args.urls || []).map(String);
      if (!urls.length) return;
      const current = typeof args.current === 'number' ? args.current : urls.indexOf(args.current);
      showImagePreview(urls, Math.max(current, 0));
    },

    // 网络图片基础库已先下载成本地地址，包内图片已换成相对小程序根目录的路径
    getImageInfo: async args => {
      const src = String(args.src || '');
      const blob = await fetchFile(src);
      const bitmap = await createImageBitmap(blob);
      const info = { width: bitmap.width, height: bitmap.height, type: imageType(blob), orientation: 'up' };
      bitmap.close();
      return info;
    },

    // 浏览器没有相册，保存到相册就是下载这张图片
    saveImageToPhotosAlbum: async args => {
      const filePath = String(args.filePath || '');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(await fetchFile(filePath));
      link.download = filePath.split(/[?#]/)[0].split('/').pop() || 'image';
      link.click();
      // 立即释放会让还没开始的下载失败
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }
  };
}

/** 存成临时文件，同时读出时长（秒）、宽高和缩略图（第一帧）；浏览器解码不了的视频这些都为空 */
async function saveVideo(file: File) {
  const [tempFilePath, { duration, width, height, thumb }] = await Promise.all([
    saveTempFile(file, tempFileType(file.name, file.type, 'mp4')),
    readVideo(file)
  ]);
  const thumbTempFilePath = thumb ? await saveTempFile(thumb, 'jpg') : '';
  return { tempFilePath, size: file.size, duration, height, width, thumbTempFilePath };
}

async function readVideo(file: File): Promise<{ duration: number; width: number; height: number; thumb: Blob | null }> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
    });
    const { videoWidth: width, videoHeight: height } = video;
    // MediaRecorder 录的 webm 不带时长，读出来是 Infinity
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    return { duration, width, height, thumb: width && height ? await firstFrame(video) : null };
  } catch {
    return { duration: 0, width: 0, height: 0, thumb: null };
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

/** 第一帧存成 jpg。有的浏览器不播放就不加载画面，也不报错，等 FIRST_FRAME_TIMEOUT 还没有画面就为 null */
async function firstFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const loaded = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || await Promise.race([
    new Promise<boolean>(resolve => video.addEventListener('loadeddata', () => resolve(true), { once: true })),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), FIRST_FRAME_TIMEOUT))
  ]);
  if (!loaded) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
}

/** @throws 文件不存在时 */
async function fetchFile(path: string): Promise<Blob> {
  const url = /^[a-z][a-z\d+.-]*:/i.test(path) ? path : '/' + path.replace(/^\//, '');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`file not exist ${path}`);
  return res.blob();
}

/** 与真机一致的格式名：png、jpeg、gif 等，看不出来时为 unknown */
function imageType(blob: Blob): string {
  return /^image\/([a-z\d]+)/i.exec(blob.type)?.[1].toLowerCase() || 'unknown';
}
