import { describe, expect, it } from 'vitest';
import { adaptCopy, renderBody } from './copy.js';

describe('平台文案适配', () => {
  it('限制小红书标题长度并去重话题', () => {
    const copy = adaptCopy({
      title: '这是一个超过二十个汉字的小红书酒店投影选型标题示例',
      body: '正文',
      hashtags: ['#江西酒店#', '江西酒店', '酒店投影'],
    }, 'xiaohongshu');

    expect(copy.title.length).toBeLessThanOrEqual(20);
    expect(copy.hashtags).toEqual(['江西酒店', '酒店投影']);
  });

  it('按平台生成正确的话题形式', () => {
    const copy = { title: '标题', body: '正文', hashtags: ['江西酒店', '酒店投影'] };
    expect(renderBody(copy, 'xiaohongshu')).toBe('正文');
    expect(renderBody(copy, 'douyin')).toContain('#江西酒店 #酒店投影');
  });

  it('快手最多保留四个话题', () => {
    const copy = adaptCopy({
      title: '标题',
      body: '正文',
      hashtags: ['江西酒店', '酒店投影', '酒店供应链', '酒店筹建', '民宿经营'],
    }, 'kuaishou');

    expect(copy.hashtags).toEqual(['江西酒店', '酒店投影', '酒店供应链', '酒店筹建']);
  });

  it('按运营策略给四个平台保留不同数量的话题', () => {
    const base = {
      title: '标题',
      body: '正文',
      hashtags: ['酒店投影', '江西酒店', '宾馆经营', '投射距离', '客房设计', '酒店筹建'],
    };

    expect(adaptCopy(base, 'douyin').hashtags).toHaveLength(5);
    expect(adaptCopy(base, 'xiaohongshu').hashtags).toHaveLength(5);
    expect(adaptCopy(base, 'kuaishou').hashtags).toHaveLength(4);
    expect(adaptCopy(base, 'wechat_channels').hashtags).toHaveLength(3);
  });
});
