import { z } from 'zod';

const layoutSchema = z.enum([
  'cover',
  'install',
  'grid',
  'lighting',
  'privacy',
  'resilience',
  'handoff',
  'check',
]);

const pageSchema = z.object({
  number: z.number().int().min(1).max(7),
  layout: layoutSchema,
  kicker: z.string().min(1),
  title: z.string().min(1),
  judgment: z.string().min(1),
  points: z.array(z.string().min(1)).min(1).max(8),
  scopeLimit: z.string().min(1),
});

const contentSpecSchema = z.object({
  id: z.string().regex(/^XLL-\d{4}-\d{3}$/),
  title: z.string().min(1),
  audience: z.string().min(1),
  evidenceSources: z.array(z.string().min(1)).min(1),
  claimBoundary: z.string().min(1),
  action: z.string().min(1),
  body: z.string().min(1).optional(),
  hashtags: z.array(z.string().min(1)).max(8).optional(),
  pages: z.array(pageSchema).length(7),
}).superRefine((spec, context) => {
  const numbers = spec.pages.map((page) => page.number).sort((left, right) => left - right);
  if (numbers.some((number, index) => number !== index + 1)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pages'],
      message: '七页页码必须完整且不重复（1–7）。',
    });
  }
});

export type CardLayout = z.infer<typeof layoutSchema>;
export type CardPage = z.infer<typeof pageSchema>;
export type ContentSpec = z.input<typeof contentSpecSchema>;

export interface DraftManifest {
  kind: 'gallery' | 'video';
  mediaPaths: string[];
  title: string;
  body: string;
  hashtags: string[];
  targets: ['douyin', 'xiaohongshu', 'kuaishou', 'wechat_channels'];
  approvedForAutoPublish: false;
}

export function parseContentSpec(input: unknown): ContentSpec {
  return contentSpecSchema.parse(input);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderPointList(page: CardPage, className = 'point-list'): string {
  return `<div class="${className}">${page.points.map((point, index) => `
    <div class="point-item">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <p>${escapeHtml(point)}</p>
    </div>`).join('')}</div>`;
}

function renderCover(page: CardPage, spec: ContentSpec): string {
  return `
    <div class="cover-label">${escapeHtml(spec.audience)}</div>
    <h1>${escapeHtml(page.title)}</h1>
    <p class="cover-judgment">${escapeHtml(page.judgment)}</p>
    <div class="cover-count">
      <strong>6</strong><span>项开业验收</span>
    </div>
    <div class="cover-points">${page.points.map((point) => `<span>${escapeHtml(point)}</span>`).join('')}</div>
    <div class="cover-action"><small>可执行资料</small><strong>${escapeHtml(spec.action)}</strong></div>`;
}

function renderInstall(page: CardPage): string {
  return `
    <div class="install-scene">
      <div class="screen"><span>幕面在前</span></div>
      <div class="beam"></div>
      <div class="projector"><i></i><span>设备在后</span></div>
      <div class="bed"><span>常用观看点</span></div>
      <div class="axis"><span>尽量正对</span></div>
    </div>
    ${renderPointList(page)}`;
}

function renderGrid(page: CardPage): string {
  return `
    <div class="test-grid">
      <div class="grid-lines"></div>
      <div class="grid-copy"><strong>中心 + 四角</strong><span>网格看形状 · 字幕看可读性</span></div>
      <i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>
    </div>
    ${renderPointList(page, 'point-list compact')}`;
}

function renderLighting(page: CardPage): string {
  const labels = ['白天拉帘', '常用灯光', '夜间状态'];
  return `
    <div class="lighting-states">${labels.map((label, index) => `
      <div class="light-state state-${index + 1}">
        <div class="window"><i></i></div>
        <strong>${label}</strong>
        <span>${escapeHtml(page.points[index] ?? '现场检查')}</span>
      </div>`).join('')}</div>
    <div class="judgment-strip">不要只在全黑房验收</div>`;
}

function renderPrivacy(page: CardPage): string {
  const labels = ['手机实测', '房间命名', '跨房检查', '退房清理'];
  return `
    <div class="privacy-flow">${labels.map((label, index) => `
      <div class="flow-step"><span>${index + 1}</span><strong>${label}</strong><small>${escapeHtml(page.points[index] ?? '按项目验证')}</small></div>
      ${index < labels.length - 1 ? '<i>→</i>' : ''}`).join('')}</div>
    <div class="privacy-warning"><strong>验收边界</strong><p>二维码、PIN、自动清理和设备隔离，只能在实际方案具备且现场通过后对外说明。</p></div>`;
}

function renderResilience(page: CardPage): string {
  const labels = ['连续播放', '重新启动', '断网恢复', '前台处理'];
  return `
    <div class="resilience-loop">
      <div class="loop-core"><span>按客人流程</span><strong>走一遍</strong></div>
      ${labels.map((label, index) => `<div class="loop-node node-${index + 1}"><span>${index + 1}</span><strong>${label}</strong></div>`).join('')}
    </div>
    ${renderPointList(page, 'point-list compact two-column')}`;
}

function renderHandoff(page: CardPage, spec: ContentSpec): string {
  return `
    <div class="handoff-grid">${page.points.map((point, index) => `
      <div class="handoff-item"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(point)}</strong><i>✓</i></div>`).join('')}</div>
    <div class="handoff-action"><div><small>下一步</small><strong>${escapeHtml(spec.action)}</strong></div><p>先发城市、房间数、计划开业时间和一张样板房照片。</p></div>`;
}

function renderBody(page: CardPage, spec: ContentSpec): string {
  switch (page.layout) {
    case 'cover': return renderCover(page, spec);
    case 'install': return renderInstall(page);
    case 'grid': return renderGrid(page);
    case 'lighting': return renderLighting(page);
    case 'privacy': return renderPrivacy(page);
    case 'resilience': return renderResilience(page);
    case 'handoff': return renderHandoff(page, spec);
    default: return renderPointList(page);
  }
}

function renderCard(page: CardPage, spec: ContentSpec): string {
  const cover = page.layout === 'cover';
  return `<section class="card layout-${page.layout}" data-page="${page.number}" data-layout="${page.layout}">
    ${cover ? '<div class="cover-orbit orbit-one"></div><div class="cover-orbit orbit-two"></div>' : ''}
    <div class="safe" data-safe>
      <header class="card-header">
        <span class="brand">洗哩洗哩投影</span>
        <span class="content-id">${escapeHtml(spec.id)} · ${String(page.number).padStart(2, '0')}/07</span>
      </header>
      ${cover ? '' : `<div class="page-heading"><span>${escapeHtml(page.kicker)}</span><h2>${escapeHtml(page.title)}</h2><p>${escapeHtml(page.judgment)}</p></div>`}
      <main class="card-body">${renderBody(page, spec)}</main>
      ${cover ? '' : `<footer><span>${escapeHtml(page.scopeLimit)}</span><i></i></footer>`}
    </div>
  </section>`;
}

export function buildDeckHtml(input: ContentSpec): string {
  const spec = parseContentSpec(input);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(spec.title)}</title>
<style>
  :root{--navy:#06192c;--blue:#0d5678;--blue2:#2e7896;--paper:#f7f1e8;--gold:#f0c777;--ink:#08233f;--muted:#526c7d;--line:#b8cad4}
  *{box-sizing:border-box}html,body{margin:0;background:#d7e0e4;font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;color:var(--ink)}
  body{display:flex;flex-direction:column;align-items:flex-start;gap:32px;padding:32px}.card{position:relative;width:1080px;height:1440px;overflow:hidden;background:linear-gradient(145deg,#f7f1e8 0%,#eef3f4 65%,#dce9ef 100%)}
  .card:before{content:"";position:absolute;width:520px;height:520px;border-radius:50%;right:-250px;top:-260px;background:rgba(46,120,150,.12)}
  .safe{position:absolute;inset:64px 72px 58px;display:flex;flex-direction:column}.card-header{height:56px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid rgba(8,35,63,.2);font-size:22px;font-weight:700;letter-spacing:.04em}.brand{color:var(--blue)}.content-id{color:var(--muted);font-size:18px}
  .page-heading{padding:58px 0 34px}.page-heading>span{display:inline-block;padding:10px 18px;border-radius:999px;background:var(--gold);font-size:20px;font-weight:800}.page-heading h2{margin:24px 0 14px;font-size:62px;line-height:1.12;letter-spacing:-.045em;max-width:870px}.page-heading p{margin:0;font-size:28px;line-height:1.5;color:var(--blue);font-weight:650}.card-body{flex:1;min-height:0;position:relative}footer{height:92px;border-top:2px solid rgba(8,35,63,.16);padding-top:18px;display:flex;gap:16px;align-items:flex-start;font-size:18px;line-height:1.45;color:var(--muted)}footer i{width:12px;height:12px;flex:0 0 auto;border-radius:50%;background:var(--gold);margin-top:7px;order:-1}
  .point-list{display:grid;gap:16px;margin-top:26px}.point-item{display:grid;grid-template-columns:58px 1fr;gap:20px;align-items:center;padding:21px 24px;background:rgba(255,255,255,.78);border:1px solid rgba(13,86,120,.15);border-radius:20px;box-shadow:0 12px 32px rgba(8,35,63,.06)}.point-item>span{display:grid;place-items:center;width:54px;height:54px;border-radius:15px;background:var(--ink);color:white;font-size:18px;font-weight:800}.point-item p{font-size:24px;line-height:1.42;margin:0;font-weight:650}.point-list.compact{gap:12px;margin-top:20px}.point-list.compact .point-item{padding:15px 18px}.point-list.compact .point-item>span{width:46px;height:46px}.point-list.compact .point-item p{font-size:21px}.two-column{grid-template-columns:1fr 1fr}.two-column .point-item{grid-template-columns:44px 1fr}
  .layout-cover{background:linear-gradient(145deg,var(--navy),#0d4e70 68%,#176987);color:white}.layout-cover:before{background:rgba(240,199,119,.14);right:-160px;top:-130px}.layout-cover .safe{inset:64px 76px}.layout-cover .card-header{border-color:rgba(255,255,255,.18)}.layout-cover .brand{color:var(--gold)}.layout-cover .content-id{color:#c8dde8}.layout-cover .card-body{display:flex;flex-direction:column;padding-top:80px}.cover-label{align-self:flex-start;background:var(--paper);color:var(--blue);padding:14px 25px;border-radius:999px;font-size:22px;font-weight:800}.layout-cover h1{font-size:78px;line-height:1.12;letter-spacing:-.055em;margin:44px 0 28px;max-width:900px}.cover-judgment{font-size:30px;line-height:1.55;color:#d7e8ee;max-width:800px;margin:0}.cover-count{display:flex;align-items:end;gap:22px;margin-top:52px}.cover-count strong{font-size:180px;line-height:.8;color:var(--gold);letter-spacing:-.08em}.cover-count span{font-size:35px;font-weight:800;padding-bottom:5px}.cover-points{display:flex;flex-wrap:wrap;gap:12px;margin-top:40px}.cover-points span{padding:13px 20px;border:1px solid rgba(255,255,255,.24);border-radius:12px;background:rgba(255,255,255,.08);font-size:21px;font-weight:650}.cover-action{margin-top:auto;background:rgba(4,19,33,.74);border-left:10px solid var(--gold);padding:24px 28px;display:flex;justify-content:space-between;align-items:center;border-radius:18px}.cover-action small{font-size:18px;color:#c8dde8}.cover-action strong{font-size:28px;color:white}.cover-orbit{position:absolute;border-radius:50%;border:2px solid rgba(255,255,255,.08)}.orbit-one{width:680px;height:680px;right:-390px;top:280px}.orbit-two{width:420px;height:420px;right:-250px;top:410px}
  .install-scene{height:430px;position:relative;background:#dce9ef;border:2px solid rgba(13,86,120,.18);border-radius:28px;overflow:hidden}.install-scene:after{content:"";position:absolute;left:0;right:0;bottom:86px;border-top:4px solid #8a9eaa}.screen{position:absolute;right:64px;top:56px;width:190px;height:255px;background:white;border:8px solid var(--blue);display:grid;place-items:center;font-size:24px;font-weight:800;z-index:3}.beam{position:absolute;left:255px;top:112px;width:520px;height:205px;background:linear-gradient(90deg,rgba(13,86,120,.08),rgba(240,199,119,.42));clip-path:polygon(0 28%,100% 0,100% 100%,0 70%)}.projector{position:absolute;left:120px;top:145px;width:180px;height:90px;border-radius:22px;background:var(--ink);z-index:4}.projector i{position:absolute;right:15px;top:29px;width:32px;height:32px;border-radius:50%;background:var(--gold)}.projector span{position:absolute;top:108px;width:220px;left:-20px;text-align:center;font-size:22px;font-weight:800;color:var(--blue)}.bed{position:absolute;left:355px;bottom:51px;width:330px;height:94px;border-radius:34px 34px 8px 8px;background:#afa18c;z-index:3}.bed:before{content:"";position:absolute;left:50px;top:-54px;width:230px;height:70px;border-radius:28px;background:#faf7f1;border:3px solid #b9a98d}.bed span{position:absolute;top:112px;width:100%;text-align:center;font-size:18px;color:var(--muted)}.axis{position:absolute;left:296px;top:66px;width:475px;border-top:3px dashed var(--blue);transform:rotate(-3deg)}.axis span{position:absolute;left:180px;top:-34px;font-size:18px;font-weight:700;color:var(--blue)}
  .test-grid{height:470px;position:relative;border-radius:28px;background:var(--ink);overflow:hidden;border:12px solid white;box-shadow:0 18px 45px rgba(8,35,63,.13)}.grid-lines{position:absolute;inset:0;background-image:linear-gradient(rgba(240,199,119,.28) 2px,transparent 2px),linear-gradient(90deg,rgba(240,199,119,.28) 2px,transparent 2px);background-size:85px 72px}.grid-lines:after,.grid-lines:before{content:"";position:absolute;background:rgba(255,255,255,.85)}.grid-lines:before{width:2px;top:0;bottom:0;left:50%}.grid-lines:after{height:2px;left:0;right:0;top:50%}.grid-copy{position:absolute;inset:0;display:grid;place-content:center;text-align:center}.grid-copy strong{font-size:45px;color:white}.grid-copy span{font-size:20px;color:#c8dde8;margin-top:12px}.corner{position:absolute;width:34px;height:34px;border-color:var(--gold);border-style:solid}.c1{left:20px;top:20px;border-width:4px 0 0 4px}.c2{right:20px;top:20px;border-width:4px 4px 0 0}.c3{left:20px;bottom:20px;border-width:0 0 4px 4px}.c4{right:20px;bottom:20px;border-width:0 4px 4px 0}
  .lighting-states{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:18px}.light-state{height:520px;border-radius:25px;padding:26px 20px;background:white;border:1px solid rgba(13,86,120,.16);display:flex;flex-direction:column;text-align:center}.window{height:290px;border:8px solid var(--ink);background:linear-gradient(#b7ddea,#f4d58b);position:relative;overflow:hidden}.window:before,.window:after{content:"";position:absolute;top:0;bottom:0;width:48%;background:#0d4e70}.window:before{left:0;transform-origin:left}.window:after{right:0;transform-origin:right}.state-1 .window:before{transform:scaleX(.75)}.state-1 .window:after{transform:scaleX(.75)}.state-2 .window:before,.state-2 .window:after{transform:scaleX(.96)}.state-3 .window{background:#071624}.state-3 .window:before,.state-3 .window:after{transform:scaleX(.98)}.window i{position:absolute;width:62px;height:62px;border-radius:50%;background:var(--gold);right:28px;top:25px;box-shadow:0 0 44px rgba(240,199,119,.75)}.light-state strong{font-size:25px;margin-top:24px}.light-state span{font-size:18px;line-height:1.4;color:var(--muted);margin-top:12px}.judgment-strip{margin-top:22px;border-radius:18px;background:var(--ink);color:white;font-size:25px;font-weight:800;text-align:center;padding:20px}
  .privacy-flow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:48px}.privacy-flow>i{font-size:31px;color:var(--blue);font-style:normal}.flow-step{width:195px;height:260px;background:white;border:2px solid rgba(13,86,120,.16);border-radius:24px;padding:22px 16px;text-align:center;display:flex;flex-direction:column;align-items:center}.flow-step>span{display:grid;place-items:center;width:60px;height:60px;border-radius:50%;background:var(--gold);font-size:24px;font-weight:900}.flow-step strong{font-size:23px;margin-top:22px}.flow-step small{font-size:17px;line-height:1.4;color:var(--muted);margin-top:14px}.privacy-warning{margin-top:64px;border-radius:26px;background:var(--ink);color:white;padding:34px 40px;border-left:10px solid var(--gold)}.privacy-warning strong{font-size:26px;color:var(--gold)}.privacy-warning p{font-size:22px;line-height:1.6;margin:12px 0 0;color:#d7e8ee}
  .resilience-loop{position:relative;height:500px;margin-top:0}.loop-core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:225px;height:225px;border-radius:50%;background:var(--ink);color:white;display:grid;place-content:center;text-align:center;box-shadow:0 0 0 28px rgba(13,86,120,.12)}.loop-core span{font-size:18px;color:#c8dde8}.loop-core strong{font-size:34px;margin-top:7px;color:var(--gold)}.loop-node{position:absolute;width:180px;height:106px;border-radius:22px;background:white;border:2px solid rgba(13,86,120,.18);display:flex;align-items:center;gap:13px;padding:18px;box-shadow:0 12px 32px rgba(8,35,63,.07)}.loop-node span{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--gold);font-weight:900}.loop-node strong{font-size:21px}.node-1{left:40px;top:30px}.node-2{right:40px;top:30px}.node-3{right:40px;bottom:30px}.node-4{left:40px;bottom:30px}.resilience-loop:after{content:"↻";position:absolute;inset:0;display:grid;place-items:center;font-size:470px;line-height:1;color:rgba(13,86,120,.09);z-index:0}.resilience-loop>*{z-index:1}
  .handoff-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.handoff-item{min-height:120px;position:relative;background:white;border:2px solid rgba(13,86,120,.14);border-radius:22px;padding:22px 62px 22px 22px;display:flex;align-items:center;gap:15px}.handoff-item>span{font-size:18px;font-weight:900;color:var(--blue)}.handoff-item strong{font-size:21px;line-height:1.4}.handoff-item i{position:absolute;right:20px;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#d7eee5;color:#1f7354;font-style:normal;font-weight:900}.handoff-action{margin-top:28px;border-radius:28px;background:linear-gradient(125deg,var(--ink),var(--blue));color:white;padding:30px 34px;display:flex;align-items:center;justify-content:space-between;gap:35px}.handoff-action div{min-width:310px}.handoff-action small{display:block;color:var(--gold);font-size:18px}.handoff-action strong{display:block;font-size:29px;margin-top:7px}.handoff-action p{margin:0;font-size:20px;line-height:1.5;color:#d7e8ee}
</style>
</head>
<body>${spec.pages.map((page) => renderCard(page, spec)).join('\n')}</body>
</html>`;
}

export function buildOverviewHtml(spec: ContentSpec, imagePaths: string[]): string {
  const validated = parseContentSpec(spec);
  const imageUrls = imagePaths.map((imagePath) => new URL(`file://${imagePath}`).href);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#071827;color:white;font-family:"PingFang SC",sans-serif;padding:64px}header{display:flex;justify-content:space-between;align-items:end;margin-bottom:44px}h1{font-size:44px;margin:0}p{font-size:20px;color:#b9d2dd;margin:10px 0 0}.id{color:#f0c777;font-weight:800}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:28px}.tile{background:#102b3d;border-radius:18px;padding:12px 12px 18px;box-shadow:0 15px 38px rgba(0,0,0,.25)}img{display:block;width:100%;border-radius:10px}.tile span{display:block;font-size:16px;color:#b9d2dd;margin:12px 5px 0}.boundary{grid-column:span 3;background:#0d3851;border-left:8px solid #f0c777;border-radius:18px;padding:28px;font-size:19px;line-height:1.55;color:#d7e8ee}
  </style></head><body><header><div><h1>${escapeHtml(validated.title)}</h1><p>七页母版 · 1080×1440 · 自动渲染预览</p></div><div class="id">${escapeHtml(validated.id)}</div></header><div class="grid">
  ${imageUrls.map((url, index) => `<div class="tile"><img src="${url}"><span>${String(index + 1).padStart(2, '0')} / 07 · ${escapeHtml(validated.pages[index].title)}</span></div>`).join('')}
  <div class="boundary"><strong>表述边界</strong><br>${escapeHtml(validated.claimBoundary)}</div>
  </div></body></html>`;
}

export function createDraftManifest(
  input: ContentSpec,
  kind: 'gallery' | 'video',
  mediaPaths: string[],
): DraftManifest {
  const spec = parseContentSpec(input);
  return {
    kind,
    mediaPaths,
    title: spec.title,
    body: spec.body ?? `${spec.pages.slice(1).map((page) => page.judgment).join('\n')}\n\n${spec.claimBoundary}\n\n${spec.action}`,
    hashtags: spec.hashtags ?? ['酒店投影', '江西酒店', '酒店筹建', '开业验收', '客房升级'],
    targets: ['douyin', 'xiaohongshu', 'kuaishou', 'wechat_channels'],
    approvedForAutoPublish: false,
  };
}
