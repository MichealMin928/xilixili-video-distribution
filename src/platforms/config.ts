import type { PlatformId } from '../core/types.js';

export interface PlatformConfig {
  id: PlatformId;
  name: string;
  shortName: string;
  homeUrl: string;
  publishUrls: { video: string; gallery: string };
  loginUrlFragments: string[];
  verificationMarkers: string[];
  titleSelectors: string[];
  bodySelectors: string[];
  publishButtonNames: RegExp[];
}

export const platformConfigs: Record<PlatformId, PlatformConfig> = {
  douyin: {
    id: 'douyin',
    name: '抖音创作者中心',
    shortName: '抖音',
    homeUrl: 'https://creator.douyin.com/creator-micro/home',
    publishUrls: {
      video: 'https://creator.douyin.com/creator-micro/content/upload',
      gallery: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',
    },
    loginUrlFragments: ['/login', 'passport.douyin.com'],
    verificationMarkers: ['安全验证', '滑动验证', '请完成验证', '验证码'],
    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
    ],
    bodySelectors: [
      'div[contenteditable="true"]',
      'textarea[placeholder*="作品描述"]',
      'textarea[placeholder*="描述"]',
    ],
    publishButtonNames: [/^发布$/, /^立即发布$/],
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    name: '小红书创作服务平台',
    shortName: '小红书',
    homeUrl: 'https://creator.xiaohongshu.com/',
    publishUrls: {
      video: 'https://creator.xiaohongshu.com/publish/publish?target=video',
      gallery: 'https://creator.xiaohongshu.com/publish/publish',
    },
    loginUrlFragments: ['/login'],
    verificationMarkers: ['安全验证', '请完成验证', '验证码', '扫码登录'],
    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
    ],
    bodySelectors: [
      '.tiptap[contenteditable="true"]',
      '.ProseMirror[contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      '[data-placeholder*="正文"][contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="描述"]',
    ],
    publishButtonNames: [/^发布$/, /^立即发布$/],
  },
  kuaishou: {
    id: 'kuaishou',
    name: '快手创作者服务平台',
    shortName: '快手',
    homeUrl: 'https://cp.kuaishou.com/',
    publishUrls: {
      video: 'https://cp.kuaishou.com/article/publish/video?tabType=1',
      gallery: 'https://cp.kuaishou.com/article/publish/video?tabType=2',
    },
    loginUrlFragments: ['/login', 'passport.kuaishou.com'],
    verificationMarkers: ['安全验证', '滑动验证', '请完成验证', '验证码'],
    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
    ],
    bodySelectors: [
      'div[contenteditable="true"]',
      'textarea[placeholder*="作品描述"]',
      'textarea[placeholder*="描述"]',
    ],
    publishButtonNames: [/^发布$/, /^立即发布$/],
  },
  wechat_channels: {
    id: 'wechat_channels',
    name: '微信视频号助手',
    shortName: '视频号',
    homeUrl: 'https://channels.weixin.qq.com/platform',
    publishUrls: {
      video: 'https://channels.weixin.qq.com/platform/post/create',
      gallery: 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate',
    },
    loginUrlFragments: ['/login'],
    verificationMarkers: ['安全验证', '请完成验证', '验证码', '扫码登录'],
    titleSelectors: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
    ],
    bodySelectors: [
      '.input-editor[contenteditable]',
      '[data-placeholder*="描述"][contenteditable]',
      '[contenteditable]:not([contenteditable="false"])',
      'div[contenteditable="true"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="说点什么"]',
    ],
    publishButtonNames: [/^发表$/, /^发布$/, /^立即发表$/],
  },
};
