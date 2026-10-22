---
description: 用 --real-login 借本机微信开发者工具的登录态，在浏览器里拿到真实的 wx.login code 和手机号、真实调用服务市场 wx.serviceMarket，以及新版开发者工具需要打开的安全设置。
---

# 真实登录

不加 `--real-login` 时，`wx.login` 和手机号按钮也会成功，但拿到的 code 是假的，真实后端不认（见 setup 的[默认返回](./setup.md#mock)）。
后端要用真实的 code 换取 session，或者要拿到真实手机号时，启动时加上 `--real-login`：

```bash
wxa-runner dev ./dist/dev/mp-weixin --real-login
```

- 用本机微信开发者工具的登录态（开发者 ticket）向微信换取 `wx.login` 的 code 和手机号。
  当前登录的微信账号必须是 `project.config.json` 里这个 appid 的开发者
- 新版开发者工具（Electron 版，如 2.02.2609231）不再把登录态明文保存在磁盘上，要向正在运行的开发者工具要：
  启动时 wxa-runner 用开发者工具的命令行为项目开启自动化接口，开发者工具没在运行时会启动它，
  项目窗口没开时会打开。需要先在开发者工具「设置 → 安全设置」里打开：
  - **服务端口**
  - **允许获取工具登录票据**
  - 建议也打开「自动化接口打开工具时默认信任项目」，否则开发者工具会弹窗询问是否信任项目，点信任后才能继续
  - 设置了「CLI 访问令牌」时，把它设成环境变量 `WECHAT_DEVTOOLS_CLI_TOKEN`
- 旧版开发者工具照旧读磁盘上保存的登录态，不需要上面的设置
- 登录态过期时，在开发者工具里重新登录即可，不用重启。也可以用环境变量 `WECHAT_DEV_TICKET` 直接指定 ticket
- 请求失败时调用返回失败并说明原因，不会退回模拟数据
- 开发者 ticket 很快过期，不适合 CI。CI 里请用 setup 的 [`mock`](./setup.md#mock) 和 [`network.routes`](./setup.md#network)

## 服务市场

`wx.serviceMarket.invokeService` 也要借开发者工具的登录态。加了 `--real-login` 时，请求经开发服务器发给微信服务市场，
和开发者工具里一样拿到真实结果；没加时调用直接失败，提示加 `--real-login`。

- 项目的 appid 要已经在服务市场开通了这项服务，否则微信返回服务市场的错误码（如 `9301010 consumption failure`），
  `invokeService` 照常失败，错误里带着 requestId
- 只转发服务市场的请求，基础库发出的其他 `operateWXData` 不会带上开发者的登录态发给微信
- 需要 3.7.1 及以上的基础库（用 `--baselib` 指定）。3.7.0 及以前的基础库在浏览器里加载不了 `wx.serviceMarket` 所在的 SDK，
  调用时报 `Fatal: unexpected loadSdkSubPackage case`
