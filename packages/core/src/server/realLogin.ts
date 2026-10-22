/**
 * 真实登录（--real-login）：用本机开发者工具的登录态，向微信换取真实的 wx.login code 和手机号
 *
 *   POST /login         → { code }
 *   POST /phone-number  → { data, encryptedData, iv }，code 在 data（JSON 字符串）里，与基础库的约定一致
 *   POST /operate-wx-data  { data } → { data }：wx.serviceMarket 经原生 operateWXData 发出的请求，同开发者工具转发给微信
 *
 * 失败时返回 500 和 { error: 原因 }。开发者 ticket 只留在 Node 进程里，接口只接受本机访问，
 * 并校验 Host 头防止 DNS rebinding。
 */

import express, { NextFunction, Request, Response, Router } from 'express';
import { DeveloperTicket, findDeveloperTicket, TICKET_ENV } from '@open-wxa/wxa-runner-extractor';

const DEV_LOGIC = 'https://servicewechat.com/wxa-dev-logic';
/** 开发者工具请求这些接口时带的版本号 */
const CLIENT_VERSION = '1021810240';
const UPSTREAM_TIMEOUT = 10_000;
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * 经 /operate-wx-data 转发的 operateWXData：只放行服务市场。别的（用户信息、授权等）在开发者工具里
 * 会弹窗让用户确认，不能让业务代码借开发者的登录态直接调用
 */
const FORWARDED_WX_DATA_APIS = ['webapi_servicemarket_jsapi_comm'];

const ERROR_HINTS: Record<number, string> = {
  // 40001：开发者工具刷新过 ticket，旧的随即作废
  40001: '（登录态已失效，请在微信开发者工具里重新登录）',
  40029: '（登录态已失效，请在微信开发者工具里重新登录）',
  85023: '（当前微信账号不是该小程序的开发者）'
};

/**
 * 取出可用的 ticket
 *
 * @throws 没有登录态或已过期时，消息是给用户看的处理办法
 */
export function requireUsableTicket(ticket: DeveloperTicket | null): string {
  if (!ticket) throw new Error(`未找到微信开发者工具的登录态，请登录开发者工具，或设置环境变量 ${TICKET_ENV}`);
  if (ticket.expiredAt !== undefined && ticket.expiredAt <= Date.now()) {
    throw new Error('微信开发者工具的登录态已过期，请打开开发者工具刷新登录态');
  }
  return ticket.newticket;
}

/**
 * @param findTicket 每次请求都重新查找：开发者工具重新登录、切换账号后不用重启服务器
 */
export function realLoginRouter(
  appid: string,
  findTicket: () => DeveloperTicket | null | Promise<DeveloperTicket | null> = findDeveloperTicket
): Router {
  const callDevLogic = async (endpoint: string, body: object) => {
    const query = new URLSearchParams({ appid, newticket: requireUsableTicket(await findTicket()), clientversion: CLIENT_VERSION });
    const response = await fetch(`${DEV_LOGIC}/${endpoint}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT)
    }).catch((error: Error & { cause?: Error }) => {
      // Node 的 fetch 只报 fetch failed，具体原因（DNS、连接被拒等）在 cause 里
      throw new Error(error.name === 'TimeoutError'
        ? `请求微信服务器超时（${UPSTREAM_TIMEOUT / 1000}s）`
        : `请求微信服务器失败：${error.cause?.message ?? error.message}`);
    });
    if (!response.ok) throw new Error(`微信服务器返回 HTTP ${response.status}`);
    return response.json();
  };

  const router = express.Router();
  router.use(onlyLoopback);

  router.post('/login', respond(async () => {
    const body = await callDevLogic('jslogin', { scope: ['snsapi_base'] });
    const errcode = body.baseresponse?.errcode;
    if (errcode !== 0 || !body.code) {
      throw new Error(`微信登录失败 ${errcode}: ${body.baseresponse?.errmsg || '未知错误'}${ERROR_HINTS[errcode] ?? ''}`);
    }
    return { code: body.code };
  }));

  router.post('/phone-number', respond(async () => {
    const body = await callDevLogic('jsgetuserwxphone', { appid });
    // 结果码在 jsapi_baseresponse 里，不是 jslogin 那样的 baseresponse
    const errcode = body.jsapi_baseresponse?.errcode ?? body.BaseResponse?.Ret;
    if (errcode !== 0 || typeof body.data !== 'string') {
      const errmsg = body.jsapi_baseresponse?.errmsg || body.BaseResponse?.ErrMsg?.String || '未知错误';
      throw new Error(`获取手机号失败 ${errcode}: ${errmsg}${ERROR_HINTS[errcode] ?? ''}`);
    }
    // data 原样转交：基础库从 JSON.parse(data) 里取 code 和 request_id
    const { encryptedData, iv } = JSON.parse(body.data);
    return { data: body.data, encryptedData, iv };
  }));

  router.post('/operate-wx-data', express.json({ limit: '10mb' }), (req, res, next) => {
    const apiName = req.body?.data?.api_name;
    if (FORWARDED_WX_DATA_APIS.includes(apiName)) return next();
    res.status(403).json({ error: `operateWXData 只转发服务市场的请求，不转发 ${apiName}` });
  }, respond(async req => {
    // 与开发者工具一致：基础库给的 data 序列化成文本放在 data 字段里
    const body = await callDevLogic('jsoperatewxdata', { data: JSON.stringify(req.body.data) });
    const errcode = body.baseresponse?.errcode;
    if (errcode !== 0 || typeof body.data !== 'string') {
      throw new Error(`服务市场调用失败 ${errcode}: ${body.baseresponse?.errmsg || '未知错误'}${ERROR_HINTS[errcode] ?? ''}`);
    }
    // 服务市场自己的结果码在 data 里，由基础库解析成 invokeService 的结果
    return { data: JSON.parse(body.data) };
  }));

  return router;
}

function onlyLoopback(req: Request, res: Response, next: NextFunction) {
  // req.hostname 去掉端口时能正确处理 IPv6 的 [::1]:3000
  if (!LOOPBACK_ADDRESSES.includes(req.socket.remoteAddress || '') || !LOOPBACK_HOSTS.includes(req.hostname)) {
    res.status(403).json({ error: '真实登录接口只允许本机访问' });
    return;
  }
  next();
}

function respond(action: (req: Request) => Promise<object>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await action(req));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  };
}
