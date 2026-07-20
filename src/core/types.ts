export const platformIds = [
  'douyin',
  'xiaohongshu',
  'kuaishou',
  'wechat_channels',
] as const;

export type PlatformId = (typeof platformIds)[number];
export type ContentKind = 'video' | 'gallery';
export type LoginStatus = 'unknown' | 'logged_in' | 'logged_out' | 'needs_verification';
export type JobStatus = 'draft' | 'ready' | 'preparing' | 'prepared' | 'publishing' | 'published' | 'partial' | 'failed';
export type EngagementKind = 'comment' | 'message' | 'lead';
export type EngagementPriority = 'high' | 'medium' | 'normal' | 'low';
export type EngagementSurfaceStatus = 'success' | 'empty' | 'manual_required' | 'logged_out' | 'needs_verification' | 'failed';

export interface PlatformCopy {
  title: string;
  body: string;
  hashtags: string[];
}

export interface AccountState {
  platform: PlatformId;
  status: LoginStatus;
  checkedAt?: string;
  pageUrl?: string;
  note?: string;
}

export interface PlatformResult {
  platform: PlatformId;
  phase: 'prepare' | 'publish';
  status: 'success' | 'failed' | 'needs_verification';
  at: string;
  scheduledAt?: string;
  pageUrl?: string;
  screenshot?: string;
  message: string;
}

export interface ScheduledPublication {
  scheduledAt: string;
  window: string;
  rationale: string;
}

export type PublicationPlan = Partial<Record<PlatformId, ScheduledPublication>>;

export interface JobSource {
  manifestPath: string;
  workflowDate: string;
  createdBy: 'daily_cli' | 'web' | 'api';
}

export interface PublishJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  kind: ContentKind;
  mediaPaths: string[];
  baseCopy: PlatformCopy;
  variants: Record<PlatformId, PlatformCopy>;
  targets: PlatformId[];
  schedule?: PublicationPlan;
  source?: JobSource;
  results: PlatformResult[];
}

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  subject?: string;
  detail: string;
  outcome: 'info' | 'success' | 'warning' | 'failed';
}

export interface EngagementItem {
  id: string;
  platform: PlatformId;
  kind: EngagementKind;
  author?: string;
  content: string;
  occurredAt?: string;
  capturedAt: string;
  priority: EngagementPriority;
  score: number;
  reasons: string[];
  suggestedAction: string;
  pageUrl: string;
}

export interface EngagementSurfaceResult {
  platform: PlatformId;
  kind: EngagementKind;
  status: EngagementSurfaceStatus;
  checkedAt: string;
  pageUrl: string;
  unreadCount?: number;
  visibleCount: number;
  items: EngagementItem[];
  message: string;
  screenshot?: string;
}

export interface EngagementReport {
  id: string;
  startedAt: string;
  completedAt: string;
  baseline: boolean;
  surfaces: EngagementSurfaceResult[];
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

export interface EngagementState {
  version: 1;
  updatedAt: string;
  items: EngagementItem[];
  reports: EngagementReport[];
}

export interface InstallationState {
  projectRoot: string;
  hostname: string;
  initializedAt: string;
  migratedAt?: string;
}

export interface AppState {
  version: 2;
  installation: InstallationState;
  accounts: Record<PlatformId, AccountState>;
  jobs: PublishJob[];
  audit: AuditEvent[];
}
