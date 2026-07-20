import { useEffect, useMemo, useState } from 'react';
import { request } from './api';
import { platformNames, platformOrder, type PlatformId } from './platforms';

interface StudioAsset {
  id: string;
  title: string;
  kind: 'video' | 'gallery';
  source: string;
  theme: string;
  mediaCount: number;
  modifiedAt: string;
  watermarkFreeConfirmed: boolean;
  targets: PlatformId[];
  previewUrl: string;
}

interface StudioStage {
  id: 'validate' | 'package' | 'prepare' | 'publish';
  label: string;
  detail: string;
  status: 'complete' | 'active' | 'queued' | 'attention';
}

export interface StudioRun {
  id: string;
  createdAt: string;
  assetId: string;
  title: string;
  kind: 'video' | 'gallery';
  targets: PlatformId[];
  watermarkFreeConfirmed: boolean;
  status: 'ready' | 'preparing' | 'prepared' | 'needs_attention';
  jobId?: string;
  stages: StudioStage[];
}

interface StudioResponse {
  generatedAt: string;
  assets: StudioAsset[];
  latestRun?: StudioRun;
}

export function ContentStudio({
  onRun,
  onOpenOperations,
}: {
  onRun: (run?: StudioRun) => void;
  onOpenOperations: () => void;
}) {
  const [data, setData] = useState<StudioResponse>();
  const [filter, setFilter] = useState<'all' | 'video' | 'gallery'>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [targets, setTargets] = useState<PlatformId[]>([...platformOrder]);
  const [watermarkFreeConfirmed, setWatermarkFreeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => {
    const response = await request<StudioResponse>('/api/studio');
    setData(response);
    onRun(response.latestRun);
  };

  useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const visible = useMemo(() => data?.assets.filter((asset) => filter === 'all' || asset.kind === filter) ?? [], [data, filter]);
  const selected = useMemo(() => data?.assets.find((asset) => asset.id === selectedId), [data, selectedId]);

  const choose = (asset: StudioAsset) => {
    setSelectedId(asset.id);
    setTargets(asset.targets);
    setWatermarkFreeConfirmed(asset.watermarkFreeConfirmed);
    setError(undefined);
  };

  const toggleTarget = (platform: PlatformId) => {
    setTargets((current) => current.includes(platform)
      ? current.filter((item) => item !== platform)
      : [...current, platform]);
  };

  const createAndPrepare = async () => {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    try {
      const run = await request<StudioRun>('/api/studio/runs', {
        method: 'POST',
        body: JSON.stringify({
          assetId: selected.id,
          targets,
          watermarkFreeConfirmed,
        }),
      });
      onRun(run);
      const prepared = await request<StudioRun>(`/api/studio/runs/${run.id}/prepare`, {
        method: 'POST',
        body: JSON.stringify({ confirmation: run.id }),
      });
      onRun(prepared);
      setSelectedId(undefined);
      setData((current) => current ? { ...current, latestRun: prepared } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content-studio">
      <section className="studio-heading">
        <div>
          <p className="eyebrow">本地内容池</p>
          <h1>选择内容，安全预填四个平台。</h1>
          <p>内容来自本机 `content/` 清单；账号、素材和运行记录不会上传到外部聚合服务。</p>
        </div>
        <button type="button" onClick={() => load().catch((reason) => setError(String(reason)))}>刷新内容</button>
      </section>

      <section className="studio-filter" aria-label="内容类型筛选">
        <div>
          {([['all', '全部'], ['video', '视频'], ['gallery', '图文']] as const).map(([id, label]) => (
            <button type="button" key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <span>{visible.length} 个可用内容单元</span>
      </section>

      {error && <div className="studio-error">{error}</div>}
      {!data && !error && <p className="empty-state">正在读取本地内容清单…</p>}
      {data && !visible.length && <p className="empty-state">没有找到素材完整的 manifest.json。请先在 content/ 中准备内容清单。</p>}

      <section className="studio-grid">
        {visible.map((asset, index) => (
          <button
            type="button"
            key={asset.id}
            className={`studio-card ${selectedId === asset.id ? 'selected' : ''}`}
            onClick={() => choose(asset)}
            style={{ '--studio-delay': `${Math.min(index * 45, 360)}ms` } as React.CSSProperties}
            aria-pressed={selectedId === asset.id}
          >
            {asset.kind === 'video'
              ? <video src={asset.previewUrl} muted playsInline preload="metadata" />
              : <img src={asset.previewUrl} alt="" loading="lazy" />}
            <span className="studio-card-shade" />
            <span className="studio-kind">{asset.kind === 'video' ? '视频' : `${asset.mediaCount} 页图文`}</span>
            <span className="studio-card-copy">
              <strong>{asset.title}</strong>
              <small>{asset.source} · #{asset.theme}</small>
            </span>
            <span className="studio-select-mark">{selectedId === asset.id ? '已选择' : '选择'}</span>
          </button>
        ))}
      </section>

      <section className={`studio-dock ${selected ? 'visible' : ''}`} aria-live="polite">
        <div className="studio-dock-copy">
          <span>本次内容</span>
          <strong>{selected?.title}</strong>
        </div>
        <fieldset>
          <legend>预填到</legend>
          <div>{platformOrder.map((platform) => (
            <button type="button" key={platform} className={targets.includes(platform) ? 'selected' : ''} onClick={() => toggleTarget(platform)}>{platformNames[platform]}</button>
          ))}</div>
        </fieldset>
        {selected?.kind === 'video' && (
          <label className="studio-watermark">
            <input type="checkbox" checked={watermarkFreeConfirmed} onChange={(event) => setWatermarkFreeConfirmed(event.target.checked)} />
            <span>已完整确认无平台/AI 水印、网址和二维码</span>
          </label>
        )}
        <button
          type="button"
          className="studio-start"
          disabled={!selected || !targets.length || (selected.kind === 'video' && !watermarkFreeConfirmed) || busy}
          onClick={createAndPrepare}
        >
          {busy ? '正在预填…' : '创建任务并预填'}
        </button>
        <button type="button" className="studio-operations" onClick={onOpenOperations}>发布管理</button>
      </section>
    </div>
  );
}

export function StudioActivityPanel({
  run,
  error,
  onOpenOperations,
}: {
  run?: StudioRun;
  error?: string;
  onOpenOperations: () => void;
}) {
  return (
    <aside className="activity-panel studio-panel">
      <div className="activity-head">
        <p className="eyebrow">内容工作台</p>
        <span>{run ? '已记录' : '待命'}</span>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <h2>{run ? run.title : '选择一条内容开始'}</h2>
      <p className="studio-panel-intro">{run?.jobId ? `发布任务：${run.jobId}` : '这里只负责校验、创建任务和预填；正式发布仍需任务编号二次确认。'}</p>
      <div className="studio-stage-list">
        {(run?.stages ?? [
          { id: 'validate', label: '核验内容', detail: '检查素材和公开文案', status: 'queued' },
          { id: 'package', label: '平台适配', detail: '生成各平台原生版本', status: 'queued' },
          { id: 'prepare', label: '平台预填', detail: '打开页面并停在发布前', status: 'queued' },
          { id: 'publish', label: '人工发布', detail: '任务编号二次确认', status: 'queued' },
        ] as StudioStage[]).map((stage, index) => (
          <div className={`studio-stage stage-${stage.status}`} key={stage.id}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{stage.label}</strong><p>{stage.detail}</p></div>
            <i />
          </div>
        ))}
      </div>
      {run?.jobId && <button type="button" className="studio-open-operations" onClick={onOpenOperations}>进入发布管理</button>}
      <p className="studio-safety">不会自动删除作品，也不会绕过任务确认直接发布。</p>
    </aside>
  );
}
