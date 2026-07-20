import { useCallback, useEffect, useMemo, useState } from 'react';

const platformOrder = ['douyin', 'xiaohongshu', 'kuaishou', 'wechat_channels'] as const;
type PlatformId = (typeof platformOrder)[number];
const scheduleOrder: PlatformId[] = ['wechat_channels', 'kuaishou', 'douyin', 'xiaohongshu'];

const platformNames: Record<PlatformId, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  kuaishou: '快手',
  wechat_channels: '视频号',
};

const tagHeatResearch = [
  { tag: '民宿经营', sampleEngagement: 845, medianEngagement: 53.5, score: 100 },
  { tag: '江西酒店', sampleEngagement: 468, medianEngagement: 3.5, score: 55 },
  { tag: '酒店筹建', sampleEngagement: 269, medianEngagement: 10.5, score: 32 },
  { tag: '酒店投影', sampleEngagement: 253, medianEngagement: 2, score: 30 },
  { tag: '酒店供应链', sampleEngagement: 235, medianEngagement: 4.5, score: 28 },
] as const;

const hottestTag = tagHeatResearch[0];

type LoginStatus = 'unknown' | 'logged_in' | 'logged_out' | 'needs_verification';

interface AccountState {
  platform: PlatformId;
  status: LoginStatus;
  note?: string;
}

interface Result {
  platform: PlatformId;
  phase: 'prepare' | 'publish';
  status: 'success' | 'failed' | 'needs_verification';
  at: string;
  message: string;
}

interface Job {
  id: string;
  createdAt: string;
  status: string;
  kind: 'video' | 'gallery';
  mediaPaths: string[];
  baseCopy: { title: string; body: string; hashtags: string[] };
  targets: PlatformId[];
  schedule?: Partial<Record<PlatformId, {
    scheduledAt: string;
    window: string;
    rationale: string;
  }>>;
  results: Result[];
}

interface DailySchedule {
  date: string;
  dayType: 'weekday' | 'weekend';
  timezone: 'Asia/Shanghai';
  audience: string;
  strategy: string;
  recommendations: Record<PlatformId, {
    platform: PlatformId;
    scheduledAt: string;
    localTime: string;
    window: string;
    rationale: string;
  }>;
}

interface AuditEvent {
  id: string;
  at: string;
  action: string;
  subject?: string;
  detail: string;
  outcome: 'info' | 'success' | 'warning' | 'failed';
}

interface State {
  accounts: Record<PlatformId, AccountState>;
  jobs: Job[];
  audit: AuditEvent[];
}

type EngagementKind = 'comment' | 'message' | 'lead';
type EngagementPriority = 'high' | 'medium' | 'normal' | 'low';
type EngagementSurfaceStatus = 'success' | 'empty' | 'manual_required' | 'logged_out' | 'needs_verification' | 'failed';

interface EngagementItem {
  id: string;
  platform: PlatformId;
  kind: EngagementKind;
  author?: string;
  content: string;
  occurredAt?: string;
  capturedAt: string;
  priority: EngagementPriority;
  score: number;
  suggestedAction: string;
}

interface EngagementSurface {
  platform: PlatformId;
  kind: EngagementKind;
  status: EngagementSurfaceStatus;
  unreadCount?: number;
  visibleCount: number;
  message: string;
}

interface EngagementReport {
  id: string;
  completedAt: string;
  baseline: boolean;
  surfaces: EngagementSurface[];
  newItemIds: string[];
  summary: {
    visibleItems: number;
    newItems: number;
    highPriority: number;
    mediumPriority: number;
    manualRequired: number;
    failed: number;
  };
}

interface EngagementState {
  items: EngagementItem[];
  reports: EngagementReport[];
}

const engagementKindNames: Record<EngagementKind, string> = {
  comment: '评论',
  message: '私信',
  lead: '线索',
};

const statusCopy: Record<LoginStatus, string> = {
  unknown: '未检查',
  logged_in: '已登录',
  logged_out: '待登录',
  needs_verification: '需验证',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

const dateTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));

const publishingTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));

const todayInShanghai = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export function App() {
  const [state, setState] = useState<State>();
  const [engagement, setEngagement] = useState<EngagementState>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [kind, setKind] = useState<'video' | 'gallery'>('video');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [media, setMedia] = useState('');
  const [tags, setTags] = useState('民宿经营、江西酒店、酒店投影、酒店供应链');
  const [targets, setTargets] = useState<PlatformId[]>([...platformOrder]);
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});
  const [scheduleDate, setScheduleDate] = useState(todayInShanghai);
  const [schedule, setSchedule] = useState<DailySchedule>();

  const refresh = useCallback(async () => {
    const [nextState, nextEngagement] = await Promise.all([
      request<State>('/api/state'),
      request<EngagementState>('/api/engagement/status'),
    ]);
    setState(nextState);
    setEngagement(nextEngagement);
  }, []);

  useEffect(() => {
    refresh().catch((reason) => setError(String(reason)));
    const timer = window.setInterval(() => {
      if (!busy) refresh().catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  useEffect(() => {
    request<DailySchedule>(`/api/schedule?date=${encodeURIComponent(scheduleDate)}`)
      .then(setSchedule)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [scheduleDate]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(undefined);
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const loggedIn = useMemo(() => state
    ? platformOrder.filter((id) => state.accounts[id].status === 'logged_in').length
    : 0, [state]);

  const latestEngagement = engagement?.reports[0];
  const latestEngagementNewIds = useMemo(
    () => new Set(latestEngagement?.newItemIds ?? []),
    [latestEngagement],
  );
  const latestEngagementItems = useMemo(() => {
    if (!engagement || !latestEngagement) return [];
    return engagement.items
      .filter((item) => latestEngagementNewIds.has(item.id) || ['high', 'medium'].includes(item.priority))
      .sort((left, right) => {
        const newDifference = Number(latestEngagementNewIds.has(right.id)) - Number(latestEngagementNewIds.has(left.id));
        return newDifference || right.score - left.score;
      })
      .slice(0, 8);
  }, [engagement, latestEngagement, latestEngagementNewIds]);

  const latestEngagementSurfaces = useMemo(() => Object.fromEntries(platformOrder.map((platform) => {
    const report = engagement?.reports.find((candidate) => candidate.surfaces.some((surface) => surface.platform === platform));
    return [platform, report?.surfaces.filter((surface) => surface.platform === platform) ?? []];
  })) as Record<PlatformId, EngagementSurface[]>, [engagement]);

  const toggleTarget = (id: PlatformId) => {
    setTargets((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const selectedTags = useMemo(() => tags.split(/[、,，\s]+/).filter(Boolean), [tags]);

  const addTag = (tag: string) => {
    if (selectedTags.includes(tag)) return;
    setTags([...selectedTags, tag].join('、'));
  };

  const createJob = () => run('正在创建任务', async () => {
    await request('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        title,
        body,
        mediaPaths: media.split('\n').map((item) => item.trim()).filter(Boolean),
        hashtags: tags.split(/[、,，\s]+/).filter(Boolean),
        targets,
        scheduleDate,
      }),
    });
    setTitle('');
    setBody('');
    setMedia('');
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>洗哩洗哩</strong>
            <span>四平台运营台</span>
          </div>
        </div>
        <div className="system-status">
          <span className="live-dot" />
          本机模式 · {loggedIn}/4 已登录
        </div>
      </header>

      <aside className="platform-rail">
        <p className="eyebrow">账号连接</p>
        <div className="platform-list">
          {platformOrder.map((id, index) => {
            const account: Pick<AccountState, 'status' | 'note'> = state?.accounts[id] ?? { status: 'unknown' };
            return (
              <section className="platform-row" key={id} style={{ '--delay': `${index * 60}ms` } as React.CSSProperties}>
                <div className="platform-heading">
                  <span className={`status-dot status-${account.status}`} />
                  <strong>{platformNames[id]}</strong>
                  <small>{statusCopy[account.status]}</small>
                </div>
                <p>{account.note ?? '使用专用 Chrome 本地登录态'}</p>
                <div className="row-actions">
                  <button onClick={() => run(`打开${platformNames[id]}`, () => request(`/api/platforms/${id}/login`, { method: 'POST', body: '{}' }))}>
                    打开登录
                  </button>
                  <button onClick={() => run(`检查${platformNames[id]}`, () => request(`/api/platforms/${id}/check`, { method: 'POST', body: '{}' }))}>
                    检查
                  </button>
                </div>
              </section>
            );
          })}
        </div>
        <div className="privacy-note">
          <span>凭据边界</span>
          Cookie 只保存在当前电脑的专用 Chrome 目录，不发送到任何聚合服务。
        </div>
      </aside>

      <main className="workspace">
        <div className="workspace-head">
          <div>
            <p className="eyebrow">新内容</p>
            <h1>一次整理，四端适配。</h1>
          </div>
          <div className="mode-switch" aria-label="内容类型">
            <button className={kind === 'video' ? 'active' : ''} onClick={() => setKind('video')}>视频</button>
            <button className={kind === 'gallery' ? 'active' : ''} onClick={() => setKind('gallery')}>图文</button>
          </div>
        </div>

        <section className="schedule-board" aria-label="目标客户发布时间建议">
          <div className="schedule-heading">
            <div>
              <p className="eyebrow">客户触达排期</p>
              <h2>酒店决策者的发布节奏</h2>
            </div>
            <label className="schedule-date">
              <span>排期日期</span>
              <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />
            </label>
          </div>
          <p className="schedule-context">
            <strong>{schedule?.audience ?? '江西酒店业主、店总、筹建采购、工程与运营负责人'}</strong>
            <span>{schedule?.strategy ?? '正在生成当天排期…'}</span>
          </p>
          <div className="schedule-timeline">
            {scheduleOrder.map((id) => {
              const recommendation = schedule?.recommendations[id];
              return (
                <button
                  type="button"
                  key={id}
                  className={targets.includes(id) ? 'active' : ''}
                  onClick={() => toggleTarget(id)}
                  aria-pressed={targets.includes(id)}
                >
                  <span>{platformNames[id]}</span>
                  <strong>{recommendation?.localTime ?? '--:--'}</strong>
                  <small>{recommendation?.window ?? '计算中'}</small>
                  <p>{recommendation?.rationale ?? '正在生成平台理由。'}</p>
                </button>
              );
            })}
          </div>
          <p className="schedule-caveat">首轮运营基线 · 中国标准时间。连续记录 4 周后，应以各账号“粉丝在线时段”和有效咨询量重新校准。</p>
        </section>

        <section className="engagement-radar" aria-label="评论私信与潜客巡检">
          <div className="engagement-heading">
            <div>
              <p className="eyebrow">互动雷达</p>
              <h2>只读巡检，人工回复。</h2>
            </div>
            <div className="engagement-actions">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => run('正在巡检互动', () => request('/api/engagement/scan', { method: 'POST', body: '{}' }))}
              >
                立即巡检
              </button>
            </div>
          </div>
          <div className="engagement-metrics">
            <div><span>新增</span><strong>{latestEngagement?.summary.newItems ?? 0}</strong></div>
            <div><span>高意向</span><strong>{latestEngagement?.summary.highPriority ?? 0}</strong></div>
            <div><span>中意向</span><strong>{latestEngagement?.summary.mediumPriority ?? 0}</strong></div>
            <div><span>需人工</span><strong>{latestEngagement?.summary.manualRequired ?? 0}</strong></div>
            <p>{latestEngagement ? `上次巡检 ${dateTime(latestEngagement.completedAt)}` : '尚未执行首次巡检'}</p>
          </div>
          <div className="engagement-platforms">
            {platformOrder.map((platform) => {
              const surfaces = latestEngagementSurfaces[platform];
              const attention = surfaces.some((surface) => ['manual_required', 'logged_out', 'needs_verification', 'failed'].includes(surface.status));
              return (
                <div className="engagement-platform" key={platform}>
                  <div>
                    <span className={attention ? 'attention' : 'ready'} />
                    <strong>{platformNames[platform]}</strong>
                  </div>
                  <p>{surfaces.length
                    ? surfaces.map((surface) => `${engagementKindNames[surface.kind]}：${surface.message}`).join(' ')
                    : '等待首次巡检。'}</p>
                </div>
              );
            })}
          </div>
          {latestEngagementItems.length > 0 && (
            <div className="engagement-items">
              {latestEngagementItems.map((item) => (
                <article key={item.id}>
                  <span className={`priority-${item.priority}`}>
                    {latestEngagementNewIds.has(item.id) ? '新增' : '待跟进'}
                    {item.priority === 'high' ? '高意向' : item.priority === 'medium' ? '中意向' : '普通'}
                  </span>
                  <div>
                    <strong>{platformNames[item.platform]} · {engagementKindNames[item.kind]}{item.author ? ` · ${item.author}` : ''}</strong>
                    <p>{item.content}</p>
                    <small>{item.suggestedAction}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="engagement-boundary">程序不会自动回复、删除评论或导出联系人；网页端不可读时会明确标记人工复核。</p>
        </section>

        <section className="composer">
          <label>
            <span>标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：酒店投影别只看亮度" />
          </label>
          <label>
            <span>正文</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="输入基础内容，我会在任务中为四个平台分别控制长度和话题格式。" />
          </label>
          <div className="field-grid">
            <label>
              <span>素材绝对路径 · 每行一个</span>
              <textarea className="compact" value={media} onChange={(event) => setMedia(event.target.value)} placeholder="/Users/.../酒店投影案例.mp4" />
            </label>
            <div className="tag-field">
              <label>
                <span>话题 · 顿号分隔</span>
                <textarea className="compact" value={tags} onChange={(event) => setTags(event.target.value)} />
              </label>
              <section className="tag-research" aria-labelledby="tag-research-title">
                <div className="tag-research-head">
                  <div>
                    <span className="research-kicker">当前最高</span>
                    <strong id="tag-research-title">#{hottestTag.tag}</strong>
                  </div>
                  <div className="research-score">
                    <b>{hottestTag.score}</b>
                    <small>相对热度</small>
                  </div>
                </div>
                <p>我们发布过的 5 个标签中热度最高。基于小红书公开搜索前 12 条结果互动样本，更新于 2026-07-19。</p>
                <div className="tag-ranking" aria-label="已发布标签搜索热度排名">
                  {tagHeatResearch.map((item, index) => {
                    const selected = selectedTags.includes(item.tag);
                    return (
                      <button
                        type="button"
                        className={selected ? 'is-selected' : ''}
                        key={item.tag}
                        onClick={() => addTag(item.tag)}
                        title={selected ? '已在本次话题中' : `加入 #${item.tag}`}
                      >
                        <span className="rank-number">{index + 1}</span>
                        <span className="rank-label">#{item.tag}</span>
                        <span className="rank-track"><i style={{ width: `${item.score}%` }} /></span>
                        <span className="rank-value">{item.sampleEngagement}</span>
                      </button>
                    );
                  })}
                </div>
                <small className="research-note">数值为前 12 条结果互动合计；用于同组标签相对比较，不等同于平台官方总浏览量。点击标签可加入本次内容。</small>
              </section>
            </div>
          </div>
          <div className="target-line">
            <span>发布到</span>
            <div>
              {platformOrder.map((id) => (
                <button key={id} className={targets.includes(id) ? 'selected' : ''} onClick={() => toggleTarget(id)}>
                  {platformNames[id]}
                </button>
              ))}
            </div>
            <button className="primary-action" disabled={!title || !body || !media || !targets.length || Boolean(busy)} onClick={createJob}>
              建立发布任务
            </button>
          </div>
        </section>

        <section className="queue">
          <div className="section-heading">
            <div>
              <p className="eyebrow">发布队列</p>
              <h2>先预填，再确认。</h2>
            </div>
            <span>{state?.jobs.length ?? 0} 个任务</span>
          </div>
          {!state?.jobs.length && <p className="empty-state">还没有任务。上方建立第一条内容后，会在这里显示四平台进度。</p>}
          {state?.jobs.slice(0, 8).map((job) => (
            <article className="job-row" key={job.id}>
              <div className="job-meta">
                <span>{job.kind === 'video' ? '视频' : '图文'}</span>
                <small>{dateTime(job.createdAt)}</small>
              </div>
              <div className="job-copy">
                <h3>{job.baseCopy.title}</h3>
                <p>{job.baseCopy.body}</p>
                <div className="job-platforms">
                  {job.targets.map((id) => {
                    const last = [...job.results].reverse().find((result) => result.platform === id);
                    return <span className={last ? `result-${last.status}` : ''} key={id}>{platformNames[id]}</span>;
                  })}
                </div>
                {job.schedule && (
                  <div className="job-schedule">
                    {job.targets.map((id) => job.schedule?.[id] && (
                      <span key={id}>{platformNames[id]} {dateTime(job.schedule[id]!.scheduledAt)}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="job-controls">
                <button className="prepare-button" disabled={Boolean(busy)} onClick={() => run(`正在预填 ${job.id}`, () => request(`/api/jobs/${job.id}/prepare`, { method: 'POST', body: '{}' }))}>
                  预填四平台
                </button>
                <input
                  aria-label={`${job.id} 发布确认`}
                  value={confirmations[job.id] ?? ''}
                  onChange={(event) => setConfirmations((current) => ({ ...current, [job.id]: event.target.value }))}
                  placeholder={`输入 ${job.id}`}
                />
                <div className="platform-publish-actions">
                  {job.targets.map((id) => {
                    const published = job.results.some((result) => result.platform === id
                      && result.phase === 'publish' && result.status === 'success');
                    const time = job.schedule?.[id] ? publishingTime(job.schedule[id]!.scheduledAt) : undefined;
                    return (
                      <button
                        key={id}
                        className="publish-button"
                        disabled={published || confirmations[job.id] !== job.id || Boolean(busy)}
                        title={job.schedule?.[id]?.rationale}
                        onClick={() => run(`正在发布 ${job.id} 到${platformNames[id]}`, () => request(`/api/jobs/${job.id}/publish`, {
                          method: 'POST',
                          body: JSON.stringify({ confirmation: confirmations[job.id], targets: [id] }),
                        }))}
                      >
                        {published ? `${platformNames[id]}已发布` : `${time ? `${time} · ` : ''}${platformNames[id]}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>

      <aside className="activity-panel">
        <div className="activity-head">
          <p className="eyebrow">操作存档</p>
          <span>{busy ?? '系统就绪'}</span>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="activity-list">
          {state?.audit.slice(0, 24).map((event) => (
            <div className="activity-item" key={event.id}>
              <span className={`audit-mark ${event.outcome}`} />
              <div>
                <p>{event.detail}</p>
                <small>{dateTime(event.at)}{event.subject ? ` · ${event.subject}` : ''}</small>
              </div>
            </div>
          ))}
          {!state?.audit.length && <p className="empty-state">登录检查、内容预填和发布结果都会自动留存在这里。</p>}
        </div>
      </aside>
    </div>
  );
}
