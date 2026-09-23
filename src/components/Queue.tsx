'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Check, Clock3, Film, Images, RotateCw, Sparkles, StopCircle } from 'lucide-react';
import type { AppSnapshot, Asset, GenerationJob } from '@/shared/contracts';
import type { Translate } from '@/lib/app-types';
import { dateTime, durationLabel } from '@/lib/i18n';
import { Button, EmptyState, SectionHeading } from '@/components/ui';

type QueueFilter = 'all' | 'active' | 'completed' | 'failed' | 'cancelled';
const filters: { id: QueueFilter; key: 'queue.filterAll' | 'queue.filterActive' | 'queue.filterComplete' | 'queue.filterFailed' | 'queue.filterCancelled' }[] = [
  { id: 'all', key: 'queue.filterAll' },
  { id: 'active', key: 'queue.filterActive' },
  { id: 'completed', key: 'queue.filterComplete' },
  { id: 'failed', key: 'queue.filterFailed' },
  { id: 'cancelled', key: 'queue.filterCancelled' },
];

export function QueueWorkspace({ snapshot, busyJobId, t, onCreate, onRetry, onCancel, onReuse, onSelectAsset }: {
  snapshot: AppSnapshot;
  busyJobId: string | null;
  t: Translate;
  onCreate: () => void;
  onRetry: (job: GenerationJob) => void;
  onCancel: (job: GenerationJob) => void;
  onReuse: (job: GenerationJob) => void;
  onSelectAsset: (asset: Asset) => void;
}) {
  const [filter, setFilter] = useState<QueueFilter>('all');
  const jobs = useMemo(() => snapshot.jobs.filter((job) => {
    if (filter === 'active') return job.status === 'queued' || job.status === 'running';
    return filter === 'all' || job.status === filter;
  }), [filter, snapshot.jobs]);
  const activeCount = snapshot.jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;

  return (
    <main className="workspace-content queue-workspace" id="workspace-content" tabIndex={-1}>
      <SectionHeading title={t('queue.allJobs')}>
        <p>{t('queue.summary', { active: new Intl.NumberFormat(snapshot.settings.locale).format(activeCount), total: new Intl.NumberFormat(snapshot.settings.locale).format(snapshot.jobs.length) })}</p>
      </SectionHeading>
      <fieldset className="queue-filter-row">
        <legend className="visually-hidden">{t('queue.filterAll')}</legend>
        {filters.map((item) => <button key={item.id} type="button" className={filter === item.id ? 'is-active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{t(item.key)}</button>)}
      </fieldset>
      {jobs.length ? <div className="queue-job-list">{jobs.map((job) => <QueueJob key={job.id} job={job} snapshot={snapshot} busy={busyJobId === job.id} t={t} onRetry={() => onRetry(job)} onCancel={() => onCancel(job)} onReuse={() => onReuse(job)} onSelectAsset={onSelectAsset} />)}</div>
        : snapshot.jobs.length === 0 ? <div className="queue-empty"><EmptyState icon={Clock3} title={t('queue.emptyTitle')} body={t('queue.emptyBody')} action={<Button variant="primary" icon={Sparkles} onClick={onCreate}>{t('header.create')}</Button>} /></div>
          : <div className="queue-empty"><EmptyState icon={AlertCircle} title={t('queue.filterEmptyTitle')} body={t('queue.filterEmptyBody')} action={<Button variant="quiet" onClick={() => setFilter('all')}>{t('queue.filterAll')}</Button>} /></div>}
    </main>
  );
}

function QueueJob({ job, snapshot, busy, t, onRetry, onCancel, onReuse, onSelectAsset }: {
  job: GenerationJob;
  snapshot: AppSnapshot;
  busy: boolean;
  t: Translate;
  onRetry: () => void;
  onCancel: () => void;
  onReuse: () => void;
  onSelectAsset: (asset: Asset) => void;
}) {
  const isActive = job.status === 'queued' || job.status === 'running';
  const JobIcon = job.kind === 'image' ? Images : Film;
  const outputs = job.outputAssetIds.map((id) => snapshot.assets.find((asset) => asset.id === id && !asset.deletedAt)).filter((asset): asset is Asset => Boolean(asset));
  const character = job.characterId ? snapshot.characters.find((item) => item.id === job.characterId)?.name : null;
  const model = snapshot.capabilities.models.find((item) => item.id === job.modelId);
  const modelName = job.modelId === 'mock-image' ? t('model.portraitStudy') : job.modelId === 'mock-video' ? t('model.motionStudy') : model?.label ?? job.modelId;
  const statusLabel = t(`status.${job.status}` as 'status.queued');
  const progressLabel = t('queue.progressLabel', { status: statusLabel, percent: new Intl.NumberFormat(snapshot.settings.locale).format(job.progress) });
  const created = dateTime(snapshot.settings.locale, job.createdAt);

  return (
    <article className={`queue-job-card queue-job-${job.status}`}>
      <header className="queue-job-header">
        <span className="queue-job-type"><JobIcon size={17} aria-hidden="true" /></span>
        <div className="queue-job-heading"><strong>{t(job.kind === 'image' ? 'create.imageTitle' : 'create.videoTitle')}</strong><span>{created}</span></div>
        <span className={`queue-status-pill status-${job.status}`}><i aria-hidden="true" />{statusLabel}</span>
      </header>
      <div className="queue-job-copy">
        <p className="queue-job-prompt">{job.prompt || t('queue.noPrompt')}</p>
        {job.prompt.length > 160 ? <details><summary>{t('queue.viewPrompt')}</summary><p className="queue-full-prompt">{job.prompt}</p></details> : null}
      </div>
      {isActive ? <div className="queue-job-progress"><progress className="queue-job-progress-bar" aria-label={progressLabel} value={job.progress} max={100} /><p>{t(job.status === 'queued' ? 'queue.queuedBody' : 'queue.runningBody')}</p><small>{new Intl.NumberFormat(snapshot.settings.locale).format(job.progress)}%</small></div> : null}
      {job.status === 'failed' ? <output className="queue-job-message">{t('queue.failedBody')}</output> : null}
      {job.status === 'cancelled' ? <p className="queue-job-message">{t('queue.cancelledBody')}</p> : null}
      <dl className="queue-job-meta">
        <div><dt>{t('create.model')}</dt><dd>{modelName}</dd></div>
        <div><dt>{t('create.ratio')}</dt><dd>{job.aspectRatio}</dd></div>
        {job.kind === 'image' ? <div><dt>{t('create.outputs')}</dt><dd>{new Intl.NumberFormat(snapshot.settings.locale).format(job.outputCount)}</dd></div> : null}
        {character ? <div><dt>{t('create.character')}</dt><dd>{character}</dd></div> : null}
        {job.inputAssetIds.length ? <div><dt>{t('create.references')}</dt><dd>{new Intl.NumberFormat(snapshot.settings.locale).format(job.inputAssetIds.length)}</dd></div> : null}
        {outputs.length ? <div><dt>{t('queue.savedOutputs')}</dt><dd>{new Intl.NumberFormat(snapshot.settings.locale).format(outputs.length)}</dd></div> : null}
      </dl>
      {outputs.length ? <div className="queue-output-list" aria-label={t('queue.savedOutputs')}>{outputs.map((asset) => <button key={asset.id} type="button" className="queue-output-item" onClick={() => onSelectAsset(asset)}><span className="queue-output-preview">{asset.kind === 'image' ? <img src={asset.uri} alt="" loading="lazy" decoding="async" /> : <span className="queue-output-video"><Film size={18} aria-hidden="true" /><small>{durationLabel(snapshot.settings.locale, asset.durationMs)}</small></span>}</span><span><strong>{asset.title}</strong><small>{asset.kind === 'image' ? t('common.images') : t('common.videos')}</small></span><Check size={14} aria-hidden="true" /></button>)}</div> : null}
      <footer className="queue-job-actions">
        {isActive && job.provider === 'mock' ? <Button size="small" variant="quiet" icon={StopCircle} busy={busy} onClick={onCancel}>{t(busy ? 'queue.cancelling' : 'queue.cancel')}</Button> : isActive ? <span className="queue-flow-note">{t('queue.flowCannotCancel')}</span> : null}
        {job.status === 'failed' || job.status === 'cancelled' ? <Button size="small" variant="secondary" icon={RotateCw} busy={busy} onClick={onRetry}>{t(busy ? 'queue.retrying' : 'queue.retry')}</Button> : null}
        {job.status === 'completed' ? <Button size="small" variant="quiet" icon={RotateCw} onClick={onReuse}>{t('queue.reuseSettings')}</Button> : null}
        {outputs.length ? <span className="queue-output-confirmation">{t('queue.outputSaved')}</span> : null}
      </footer>
    </article>
  );
}
