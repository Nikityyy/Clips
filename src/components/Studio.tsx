'use client';

import { useState, type DragEvent } from 'react';
import {
  ArrowDownToLine, Check, Clapperboard, FileImage, Film, FolderOpen, ImagePlus,
  Images, Info, Minus, Plus, Sparkles, Trash2, UserRound, X,
} from 'lucide-react';
import type { AppSnapshot, Asset, GenerationDraft, GenerationJob, JobKind } from '@/shared/contracts';
import type { Translate } from '@/lib/app-types';
import { dateTime, durationLabel, fileSize } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import { Button, EmptyState, FieldLabel, IconButton, MenuSelect, Modal, SectionHeading } from '@/components/ui';
import { friendlyModelName, readableModelFallback } from '@/shared/model-label';

export function CreatorPanel({ snapshot, mode, draft, busy, t, onMode, onDraft, onImport, onPaste, onDrop, onCreate, onCharacters, onConnectFlow }: {
  snapshot: AppSnapshot;
  mode: JobKind;
  draft: GenerationDraft;
  busy: boolean;
  t: Translate;
  onMode: (mode: JobKind) => void;
  onDraft: (patch: Partial<GenerationDraft>) => void;
  onImport: () => void;
  onPaste: () => void;
  onDrop: (files: readonly File[]) => void;
  onCreate: () => void;
  onCharacters: () => void;
  onConnectFlow: () => void;
}) {
  const [picker, setPicker] = useState<'references' | null>(null);
  const [dragging, setDragging] = useState(false);
  const character = snapshot.characters.find((item) => item.id === draft.characterId) ?? null;
  const modeModels = snapshot.capabilities.models.filter((item) => item.kind === mode);
  const model = modeModels.find((item) => item.id === draft.modelId) ?? modeModels[0];
  const aspectRatios = mode === 'image' ? snapshot.capabilities.imageAspectRatios : snapshot.capabilities.videoAspectRatios;
  const maxReferences = model?.referenceCap ?? 0;
  const maxOutputs = snapshot.capabilities.provider === 'google-flow' ? 4 : 6;
  const selectedReferences = snapshot.assets.filter((asset) => draft.referenceAssetIds.includes(asset.id) && asset.kind === 'image');
  const outputLabel = t(draft.outputCount === 1 ? 'common.count.one' : 'common.count.other', { count: draft.outputCount });

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) onDrop([...event.dataTransfer.files]);
  };

  const addCharacterPrompt = () => {
    if (!character) return;
    const text = character.prompt.trim() || character.description.trim();
    if (!text) return;
    const next = draft.prompt.trim() ? `${draft.prompt.trim()}\n\n${text}` : text;
    onDraft({ prompt: next.slice(0, 20000) });
  };

  const toggleReference = (assetId: string) => {
    const references = draft.referenceAssetIds.includes(assetId)
      ? draft.referenceAssetIds.filter((id) => id !== assetId)
      : draft.referenceAssetIds.length >= maxReferences ? draft.referenceAssetIds : [...draft.referenceAssetIds, assetId].slice(0, maxReferences);
    onDraft({ referenceAssetIds: references });
  };

  return (
    <div className={`composer-panel ${dragging ? 'is-drop-target' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={handleDrop}>
      <div className="composer-panel-heading">
        <div><span className="composer-eyebrow">{t('header.create')}</span><h2>{t(mode === 'image' ? 'create.imageTitle' : 'create.videoTitle')}</h2></div>
        <button type="button" className={`composer-local-pill ${snapshot.capabilities.status === 'ready' || snapshot.capabilities.status === 'mock-ready' ? 'is-connected' : 'needs-connection'}`} onClick={snapshot.capabilities.status === 'ready' || snapshot.capabilities.status === 'mock-ready' ? undefined : onConnectFlow} disabled={busy || snapshot.capabilities.status === 'checking'}><span />{t(snapshot.capabilities.status === 'ready' ? 'account.statusReady' : snapshot.capabilities.status === 'mock-ready' ? 'account.statusLocal' : snapshot.capabilities.status === 'checking' ? 'account.statusChecking' : snapshot.capabilities.status === 'unavailable' ? 'account.statusUnavailable' : 'account.statusNeedsLogin')}</button>
      </div>

      <fieldset className="mode-switch">
        <legend className="visually-hidden">{t('header.create')}</legend>
        <button type="button" className={mode === 'image' ? 'is-active' : ''} aria-pressed={mode === 'image'} onClick={() => onMode('image')}><Images size={15} aria-hidden="true" />{t('create.modeImage')}</button>
        <button type="button" className={mode === 'video' ? 'is-active' : ''} aria-pressed={mode === 'video'} onClick={() => onMode('video')}><Film size={15} aria-hidden="true" />{t('create.modeVideo')}</button>
      </fieldset>

      <section className="composer-field">
        <FieldLabel>{t('create.character')}</FieldLabel>
        <div className="composer-inline-control"><MenuSelect className="composer-select" label={t('create.character')} value={draft.characterId ?? ''} options={[{ value: '', label: t('create.noCharacter') }, ...snapshot.characters.map((item) => ({ value: item.id, label: item.name, description: item.description || t('character.noDescription'), imageUrl: snapshot.assets.find((asset) => asset.id === item.portraitAssetId)?.uri }))]} onChange={(value) => onDraft({ characterId: value || null })} /><IconButton label={t('character.create')} icon={Plus} onClick={onCharacters} /></div>
        <p className="composer-hint character-recommendation">{t('create.characterRecommendation')}</p>
      </section>
      <section className="composer-field prompt-field">
        <div className="field-label-row"><label className="field-label" htmlFor="generation-prompt">{t('create.writePrompt')}</label><span className="field-hint">{new Intl.NumberFormat(snapshot.settings.locale).format(draft.prompt.length)} / 20,000</span></div>
        <textarea id="generation-prompt" data-tour="prompt" className="prompt-input" maxLength={20000} spellCheck value={draft.prompt} onChange={(event) => onDraft({ prompt: event.currentTarget.value })} placeholder={t(mode === 'image' ? 'create.promptHint' : 'create.promptVideoHint')} />
        <div className="prompt-footer"><span>{t('create.switchPrompt')}</span><button type="button" className="text-action" disabled={!character || !(character.prompt || character.description)} onClick={addCharacterPrompt}><UserRound size={13} aria-hidden="true" />{t('create.insertCharacterPrompt')}</button></div>
      </section>
      <section className={`composer-field reference-field ${mode === 'video' ? 'video-reference-field' : ''}`} data-tour="references">
        <div className="composer-section-line"><FieldLabel>{t(mode === 'video' ? 'create.videoReferences' : 'create.references')}</FieldLabel><span className="field-hint">{model && maxReferences > 0 ? `${selectedReferences.length} / ${maxReferences}` : model ? t('create.referencesUnsupported') : ''}</span></div>
        {selectedReferences.length ? <div className="reference-chip-list">{selectedReferences.map((asset) => <div className="reference-chip" key={asset.id}><img src={asset.uri} alt="" /><span>{asset.title}</span><IconButton label={`${t('create.removeReference')}: ${asset.title}`} icon={X} size="small" onClick={() => toggleReference(asset.id)} /></div>)}</div> : <p className="composer-hint">{model && maxReferences === 0 ? t('create.referencesUnsupported') : t(mode === 'video' ? 'create.videoReferenceHint' : 'create.referenceHint')}</p>}
        <div className="reference-actions">
          <Button size="small" variant="secondary" icon={Plus} className="picker-select-button" disabled={!maxReferences} onClick={() => setPicker('references')}>{t('create.chooseFromLibrary')}</Button>
          <Button size="small" variant="quiet" icon={FolderOpen} onClick={onImport}>{t('create.importReference')}</Button>
          <Button size="small" variant="quiet" icon={FileImage} onClick={onPaste}>{t('create.pasteReference')}</Button>
        </div>
      </section>

      <section className="composer-field generation-options" data-tour="options">
        <div className="composer-field">
          <FieldLabel>{t('create.model')}</FieldLabel>
          <MenuSelect className="composer-select" label={t('create.model')} value={draft.modelId} options={modeModels.map((item) => ({ value: item.id, label: item.label, description: item.referenceCap ? t('create.modelReferenceCap', { count: item.referenceCap }) : undefined }))} onChange={(value) => onDraft({ modelId: value, referenceAssetIds: draft.referenceAssetIds.slice(0, modeModels.find((item) => item.id === value)?.referenceCap ?? 0) })} disabled={!modeModels.length} />
        </div>
        <div className="composer-field">
          <FieldLabel>{t('create.ratio')}</FieldLabel>
          <div className="ratio-options" role="group" aria-label={t('create.ratio')}>
            {aspectRatios.map((ratio) => <button key={ratio} type="button" className={draft.aspectRatio === ratio ? 'is-selected' : ''} aria-pressed={draft.aspectRatio === ratio} onClick={() => onDraft({ aspectRatio: ratio })}>{ratio}</button>)}
          </div>
        </div>
      </section>
      {mode === 'image' ? <section className="composer-field output-count-field"><FieldLabel>{t('create.outputs')}</FieldLabel><div className="count-control"><button type="button" aria-label={t('create.decreaseOutputs')} disabled={draft.outputCount <= 1} onClick={() => onDraft({ outputCount: Math.max(1, draft.outputCount - 1) })}><Minus size={14} aria-hidden="true" /></button><output aria-live="polite">{outputLabel}</output><button type="button" aria-label={t('create.increaseOutputs')} disabled={draft.outputCount >= maxOutputs} onClick={() => onDraft({ outputCount: Math.min(maxOutputs, draft.outputCount + 1) })}><Plus size={14} aria-hidden="true" /></button></div></section> : null}

      <div className="composer-panel-bottom"><p><Info size={14} aria-hidden="true" />{t(snapshot.capabilities.provider === 'google-flow' ? 'create.flowCreditHint' : 'create.localOnly')}</p><Button variant="primary" className="create-submit" icon={mode === 'image' ? Sparkles : Clapperboard} busy={busy} disabled={!draft.prompt.trim() || (snapshot.capabilities.provider === 'google-flow' && snapshot.capabilities.status !== 'ready') || !model} onClick={onCreate}>{busy ? t('create.creating') : mode === 'image' ? t(draft.outputCount === 1 ? 'create.createImage' : 'create.createImages', { count: draft.outputCount }) : t('create.createVideo')}</Button></div>

      {picker ? <AssetPicker snapshot={snapshot} selectedIds={draft.referenceAssetIds} maxSelected={maxReferences} title={t(mode === 'video' ? 'create.chooseVideoReferences' : 'create.chooseFromLibrary')} t={t} onClose={() => setPicker(null)} onConfirm={(ids) => { onDraft({ referenceAssetIds: ids }); setPicker(null); }} /> : null}
    </div>
  );
}

export function CreatorCanvas({ snapshot, mode, selectedAssetId, t, onSelect, onOpenLibrary, onUseReference, onUseVideoSource, onInspect }: {
  snapshot: AppSnapshot;
  mode: JobKind;
  selectedAssetId: string | null;
  t: Translate;
  onSelect: (asset: Asset) => void;
  onOpenLibrary: () => void;
  onUseReference: (asset: Asset) => void;
  onUseVideoSource: (asset: Asset) => void;
  onInspect: (asset: Asset) => void;
}) {
  const activeKind = mode === 'image' ? 'image' : 'video';
  const all = snapshot.assets.filter((asset) => !asset.deletedAt && asset.kind === activeKind);
  const generated = all.filter((asset) => asset.provenance.jobId);
  const assets = (generated.length ? generated : all).slice(0, 12);
  const runningJobs = snapshot.jobs.filter((job) => job.status === 'queued' || job.status === 'running');

  return (
    <main className="workspace-content creation-canvas" id="workspace-content" tabIndex={-1}>
      <div className="canvas-heading-row">
        <div className="canvas-title-block"><span className="canvas-eyebrow">{t('header.create')}</span><h1>{t('studio.results')}</h1></div>
        <div className="canvas-heading-meta"><span>{assets.length ? t('library.items', { count: new Intl.NumberFormat(snapshot.settings.locale).format(assets.length) }) : t(mode === 'image' ? 'studio.noResults' : 'studio.noResults')}</span><Button size="small" variant="quiet" icon={FolderOpen} onClick={onOpenLibrary}>{t('studio.openLibrary')}</Button></div>
      </div>

      {runningJobs.length ? <div className="active-jobs-strip" aria-label={t('queue.title')}>{runningJobs.slice(0, 2).map((job) => <JobProgress key={job.id} job={job} t={t} />)}</div> : null}

      {assets.length ? <div className={`result-grid result-grid-${mode}`}>
        {assets.map((asset, index) => <article key={asset.id} className={`result-card ${selectedAssetId === asset.id ? 'is-selected' : ''}`} style={{ ['--tile-index' as string]: index }}>
          <button className="result-card-open" type="button" aria-label={`${t('studio.inspect')}: ${asset.title}`} onClick={() => onSelect(asset)}>
            <AssetMedia asset={asset} t={t} />
            <span className="result-card-scrim" />
            <span className="result-card-topline"><span>{t(sourceKey(asset.provenance.source))}</span><span>{String(index + 1).padStart(2, '0')}</span></span>
            <span className="result-card-caption"><strong>{asset.title}</strong><span>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.kind === 'video' ? durationLabel(snapshot.settings.locale, asset.durationMs) : t('common.unknown')}</span></span>
          </button>
          <div className="result-card-actions"><IconButton label={t('studio.inspect')} icon={Info} size="small" onClick={() => onInspect(asset)} /><IconButton label={t('studio.useReference')} icon={ImagePlus} size="small" onClick={() => onUseReference(asset)} /><IconButton label={t('studio.makeVideo')} icon={Film} size="small" onClick={() => onUseVideoSource(asset)} /></div>
        </article>)}
      </div> : <div className="canvas-empty"><EmptyState icon={mode === 'image' ? Images : Film} title={t(mode === 'image' ? 'studio.emptyTitleImage' : 'studio.emptyTitleVideo')} body={t(mode === 'image' ? 'studio.emptyBodyImage' : 'studio.emptyBodyVideo')} action={<Button variant="quiet" icon={FolderOpen} onClick={onOpenLibrary}>{t('studio.openLibrary')}</Button>} /></div>}

    </main>
  );
}

export function AssetDetails({ asset, snapshot, t, onDelete, onReveal, onUseReference, onUseVideoSource }: {
  asset: Asset;
  snapshot: AppSnapshot;
  t: Translate;
  onDelete?: (asset: Asset) => void;
  onReveal?: (asset: Asset) => void;
  onUseReference?: (asset: Asset) => void;
  onUseVideoSource?: (asset: Asset) => void;
}) {
  const characterNames = snapshot.characters.filter((character) => asset.provenance.characterIds.includes(character.id)).map((character) => character.name);
  return (
    <div className="asset-inspector-content">
      <div className="asset-inspector-preview"><AssetMedia asset={asset} t={t} controls /></div>
      <div className="asset-inspector-title"><h2>{asset.title}</h2><span className="asset-kind-mark">{asset.kind === 'image' ? t('common.images') : t('common.videos')}</span></div>
      <dl className="asset-metadata-list">
        <Metadata label={t('library.file')} value={asset.fileName} />
        <Metadata label={t('library.created')} value={dateTime(snapshot.settings.locale, asset.createdAt)} />
        <Metadata label={t('library.dimensions')} value={asset.width && asset.height ? `${asset.width} × ${asset.height}` : t('common.unknown')} />
        {asset.kind === 'video' ? <Metadata label={t('library.duration')} value={durationLabel(snapshot.settings.locale, asset.durationMs)} /> : null}
        <Metadata label={t('library.size')} value={fileSize(snapshot.settings.locale, asset.sizeBytes)} />
        <Metadata label={t('library.origin')} value={t(sourceKey(asset.provenance.source))} />
        {asset.provenance.provider ? <Metadata label={t('library.provider')} value={asset.provenance.provider === 'mock' ? t('model.localName') : 'Google Flow'} /> : null}
        {asset.provenance.accountId ? <Metadata label={t('library.account')} value={snapshot.accounts.find((account) => account.id === asset.provenance.accountId)?.label ?? t('common.unknown')} /> : null}
        {asset.provenance.model ? <Metadata label={t('library.model')} value={asset.provenance.model === 'mock-image' ? t('model.portraitStudy') : asset.provenance.model === 'mock-video' ? t('model.motionStudy') : snapshot.capabilities.models.find((model) => model.id === asset.provenance.model || model.aliases?.includes(asset.provenance.model ?? ''))?.label ?? friendlyModelName(asset.provenance.model) ?? readableModelFallback(asset.provenance.model)} /> : null}
        {asset.provenance.sourceAssetIds.length ? <Metadata label={t('library.parent')} value={asset.provenance.sourceAssetIds.map((id) => snapshot.assets.find((item) => item.id === id)?.title ?? t('common.unknown')).join(', ')} /> : null}
        {characterNames.length ? <Metadata label={t('common.character')} value={characterNames.join(', ')} /> : null}
      </dl>
      <section className="asset-prompt-block"><h3>{t('library.prompt')}</h3><p>{asset.provenance.prompt || t('library.noPrompt')}</p></section>
      <div className="asset-inspector-actions">
        {asset.kind === 'image' && onUseVideoSource ? <Button variant="primary" icon={Film} onClick={() => onUseVideoSource(asset)}>{t('library.startVideo')}</Button> : null}
        {asset.kind === 'image' && onUseReference ? <Button variant="secondary" icon={ImagePlus} onClick={() => onUseReference(asset)}>{t('library.reference')}</Button> : null}
        {onReveal ? <Button variant="quiet" icon={ArrowDownToLine} onClick={() => onReveal(asset)}>{t('library.reveal')}</Button> : null}
        {onDelete ? <Button variant="quiet" icon={Trash2} onClick={() => onDelete(asset)}>{t('library.delete')}</Button> : null}
      </div>
    </div>
  );
}

export function RecentJobs({ jobs, t, onOpenQueue }: { jobs: GenerationJob[]; t: Translate; onOpenQueue?: () => void }) {
  const recent = jobs.slice(0, 5);
  return <section className="recent-jobs-panel"><SectionHeading title={t('queue.history')} action={onOpenQueue ? <Button size="small" variant="quiet" onClick={onOpenQueue}>{t('queue.viewAll')}</Button> : null} /><div className="recent-jobs-list">
    {recent.map((job) => <JobProgress key={job.id} job={job} t={t} />)}
    {!recent.length ? <p className="recent-jobs-empty">{t('queue.emptyBody')}</p> : null}
  </div></section>;
}

export function AssetPicker({ snapshot, selectedIds, maxSelected = 12, title, t, onClose, onConfirm }: {
  snapshot: AppSnapshot;
  selectedIds: string[];
  maxSelected?: number;
  title: string;
  t: Translate;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const [query, setQuery] = useState('');
  const assets = snapshot.assets.filter((asset) => !asset.deletedAt && asset.kind === 'image');
  const filtered = assets.filter((asset) => asset.title.toLocaleLowerCase(snapshot.settings.locale).includes(query.toLocaleLowerCase(snapshot.settings.locale)));
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= maxSelected ? current : [...current, id]);
  return (
    <Modal title={title} onClose={onClose} closeLabel={t('common.close')} wide className={`asset-picker-modal ${assets.length <= 5 ? 'is-compact' : ''}`} footer={<div className="picker-footer"><span>{t('library.selectedCount', { count: new Intl.NumberFormat(snapshot.settings.locale).format(selected.length) })}{maxSelected ? ` · ${t('create.referenceLimit', { count: maxSelected })}` : ''}</span><div><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" className="picker-confirm-button" onClick={() => onConfirm(selected)}>{t('common.done')}</Button></div></div>}>
      <label className="picker-search"><Images size={16} aria-hidden="true" /><span className="visually-hidden">{t('common.search')}</span><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t('library.searchPlaceholder')} /><kbd>Ctrl F</kbd></label>
      {filtered.length ? <div className="picker-grid">{filtered.map((asset) => <button key={asset.id} aria-label={asset.title} className={`picker-item ${selected.includes(asset.id) ? 'is-selected' : ''}`} type="button" aria-pressed={selected.includes(asset.id)} onClick={() => toggle(asset.id)} disabled={!selected.includes(asset.id) && selected.length >= maxSelected}>
        <span className="picker-thumb"><img src={asset.uri} alt="" loading="lazy" /><i>{selected.includes(asset.id) ? <Check size={14} /> : <Plus size={14} />}</i></span><span className="picker-item-copy"><strong>{asset.title}</strong><small>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : t('common.unknown')}</small></span>
      </button>)}</div> : <div className="picker-empty"><EmptyState icon={Images} title={assets.length ? t('library.emptySearch', { query }) : t('library.emptyImagesTitle')} body={!assets.length ? t('library.emptyBody') : undefined} action={!assets.length ? <Button onClick={onClose}>{t('common.done')}</Button> : undefined} /></div>}
    </Modal>
  );
}

function AssetMedia({ asset, t, controls = false }: { asset: Asset; t: Translate; controls?: boolean }) {
  // oxlint-disable-next-line jsx-a11y/media-has-caption -- imported and sample videos can have no caption sidecar available to Clips.
  if (asset.kind === 'video') return <video className="asset-media-video" src={asset.uri} controls={controls} preload="metadata" aria-label={`${t('studio.play')}: ${asset.title}`} />;
  return <img className="asset-media-image" src={asset.uri} alt={asset.title} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.classList.add('is-missing'); }} />;
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div className="metadata-row"><dt>{label}</dt><dd className="tooltip-trigger" data-tooltip={value}>{value}</dd></div>;
}

function JobProgress({ job, t }: { job: GenerationJob; t: Translate }) {
  return <div className={`job-progress-card job-${job.status}`}>
    <div className="job-progress-top"><span className="job-kind-icon">{job.kind === 'image' ? <Images size={14} /> : <Film size={14} />}</span><strong>{t(job.kind === 'image' ? 'create.imageTitle' : 'create.videoTitle')}</strong><span className={`job-status-dot status-${job.status}`} /></div>
    <p>{job.prompt || t('queue.noPrompt')}</p>
    <div className="job-progress-line"><span style={{ width: `${job.progress}%` }} /></div>
    <div className="job-progress-meta"><span>{t(`status.${job.status}` as TranslationKey)}</span><span>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(job.progress)}%</span></div>
  </div>;
}

function sourceKey(source: Asset['provenance']['source']): 'source.import' | 'source.clipboard' | 'source.mock' | 'source.flow' | 'source.unknown' {
  if (source === 'import') return 'source.import';
  if (source === 'clipboard') return 'source.clipboard';
  if (source === 'mock') return 'source.mock';
  if (source === 'flow-handoff' || source === 'flow-generation') return 'source.flow';
  return 'source.unknown';
}
