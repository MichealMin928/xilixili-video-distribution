# 洗哩洗哩四平台运营台

一个完全在本机运行的抖音、小红书、快手、微信视频号统一发布工具。它不依赖第三方聚合账号，使用专用的真实 Google Chrome 登录态，并提供浏览器界面、HTTP API 和 Codex 可调用的 CLI。

## 开源说明

程序源码采用 [MIT License](LICENSE)。仓库不会包含平台 Cookie、账号运行状态、真实待发布素材、发布截图或内部运营资料；这些内容由 `.gitignore` 保持在本机。

## 当前能力

- 四个平台分别打开真实 Chrome 登录页，登录态保存在 `.local/chrome-profile/`。
- 创建一份基础内容并自动生成四个平台的长度与话题格式版本。
- 按江西酒店决策者的工作节奏生成每日四平台错峰排期，并随任务保存。
- 视频或图文素材依次预填到四个平台，默认停在发布按钮前。
- 输入任务编号二次确认后，按排期分别执行四个平台的最终发布按钮。
- 登录、预填、发布和失败结果都写入 `.local/state.json`。
- 每日只读巡检普通账号可访问的评论和私信，从中识别潜在客户，按意向等级去重并写入 `.local/engagement.json`。
- 首次在新机器启动时自动修复旧项目绝对路径，并将迁移前登录态标记为待重新检查。
- 提供本机环境诊断、macOS 登录自启服务和全局命令。
- 本地服务仅监听 `127.0.0.1`，不向局域网或公网开放。

## 系统安装（推荐）

在每台新机器上执行一次：

```bash
npm install
npm run system:install
```

安装后会注册当前用户的 macOS LaunchAgent，登录时自动启动运营台，并安装五个命令到 `~/.local/bin/`：

```bash
xilixili-service status
xilixili doctor
xilixili setup
xilixili-weekly status
xilixili-engagement status
```

`xilixili setup` 会在专用 Chrome 中打开四平台登录页；扫码、短信、验证码和风控确认必须由账号本人在 Chrome 中完成。完成后运行 `xilixili check all`。

运营台：<http://127.0.0.1:4317>

## 开发启动

```bash
npm install
npm run dev
```

- 运营台：<http://127.0.0.1:4318>
- 本地 API：<http://127.0.0.1:4317/api/health>

仅在调试源码时使用 `npm run dev`。生产构建：

```bash
npm run build
npm start
```

## Codex 命令行

系统安装后：

```bash
xilixili doctor
xilixili state
xilixili login xiaohongshu
xilixili check all
xilixili create content/example-manifest.json
xilixili prepare <任务编号>
xilixili publish <任务编号> <相同任务编号>
```

内容清单可选填 `scheduleDate`（`YYYY-MM-DD`）；未填写时使用上海时区当天日期。运营台也可直接选择日期，并显示工作日/周末对应的建议时间。研究依据和后续校准方法见 `records/最佳发布时间研究.md`。

首次运行示例前，请把 `content/example-manifest.json` 中的素材路径替换为当前电脑上的视频或图片绝对路径。

平台编号：`douyin`、`xiaohongshu`、`kuaishou`、`wechat_channels`。

## 每日手工一键运营

系统服务会保持运营台运行：

```bash
# 查看今天的任务和四平台状态
xilixili-daily status

# 只检查内容、重复记录和当天排期，不打开平台
xilixili-daily plan content/当天内容/manifest.json

# 检查登录、创建或复用当天任务、预填全部平台，停在发布按钮前
xilixili-daily start content/当天内容/manifest.json

# 到计划时间后手工发布一个平台
xilixili-daily publish <任务编号> <平台编号>
```

`start` 可重复执行，只会补做尚未成功预填的平台；相同标题和素材默认不允许重复发布。`publish` 会阻止未预填、已发布或尚未到计划时间的操作。

个人 Codex 技能已安装为 `$xilixili-daily-ops`，覆盖迁移诊断、账号初始化、内容计划、四平台预填、单平台确认发布和故障恢复。它不会在未明确要求时正式发布。

## 每日互动与潜客巡检

系统使用同一个专用 Chrome 登录态，只读检查普通账号当前可访问的评论和私信，并从咨询内容中识别潜在客户：

```bash
# 查看最近一次巡检结果
xilixili-engagement status

# 巡检全部平台，也可传单个平台编号
xilixili-engagement scan all
```

巡检结果按高、中、普通、低意向分类，并对重复消息去重。平台网页没有私信入口、需要认证或验证码时会标记为“需要人工处理”，不会把不可访问误报成零消息。程序不会自动回复、删除评论或导出联系方式；抖音企业号线索版不启用，也不是运行条件。

## 每周自动发布

固定在每周二、周五执行两批，使每个平台每周发布 2 条：

| 操作/平台 | 时间 |
|---|---:|
| 当日内容预填 | 09:00 |
| 微信视频号 | 12:10 |
| 快手 | 20:05 |
| 抖音 | 20:35 |
| 小红书 | 21:05 |

```bash
xilixili-weekly status
```

自动任务只发布 `content/approved/` 中包含 `"approvedForAutoPublish": true` 的内容。队列为空、账号失效、未预填或结果不明确时会停止并报告，不会改发草稿或自动重试。完整排期见 `records/每周发布排期.md`。

## 安全规则

1. `.local/` 永远不进入 Git；其中包含平台 Cookie 和本地运行状态。
2. 首次登录、短信、扫码、验证码由账号本人在真实 Chrome 中完成。
3. 正式发布要求任务编号二次确认，避免误发。
4. 删除作品、修改账号资料和私信回复不纳入批量发布接口。
5. 平台页面改版后，适配器应先在“预填”阶段验证，不能直接试发。
6. `xilixili-service uninstall` 只移除系统服务和命令，默认保留 `.local/` 中的账号资料、任务和日志。

## 目录

```text
src/browser/       专用 Chrome 管理
src/platforms/     四个平台页面适配器
src/core/          内容任务、文案适配、审计存储
src/server/        仅本机 API
src/cli/           Codex 命令行入口
web/               统一运营界面
content/           待发布内容清单
records/           人工可读的变更与验证记录
skills/            随项目迁移、由系统安装器部署的 Codex 技能
output/playwright/ 发布预览截图（不进入 Git）
```

日常制作、预填、审核和正式发布的操作规范见 `records/日常运营流程.md`。
