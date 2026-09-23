'use client';

import { useState, type DragEvent } from 'react';
import {
  ArrowDownToLine, ArrowRight, Check, Clapperboard, FileImage, Film, FolderOpen, ImagePlus,
  Images, Info, Minus, MoreHorizontal, Plus, Sparkles, Trash2, UserRound, X,
} from 'lucide-react';
import type { AppSnapshot, Asset, GenerationDraft, GenerationJob, JobKind } from '@/shared/contracts';
import type { Translate } from '@/lib/app-types';
import { dateTime, durationLabel, fileSize } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import { Button, EmptyState, FieldLabel, IconButton, Modal, SectionHeading } from '@/components/ui';

const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];

export function CreatorPanel({ snapshot, mode, draft, busy, t, onMode, onDraft, onImport, onPaste, onDrop, onCreate, onCharacters }: {
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
}) {
  const [picker, setPicker] = useState<'references' | 'source' | null>(null);
  const [dragging, setDragging] = useState(false);
  const character = snapshot.characters.find((item) => item.id === draft.characterId) ?? null;
  const imageModel = snapshot.capabilities.models.find((item) => item.kind === mode) ?? snapshot.capabilities.models[0];
  const selectedReferences = snapshot.assets.filter((asset) => draft.referenceAssetIds.includes(asset.id) && asset.kind === 'image');
  const source = snapshot.assets.find((asset) => asset.id === draft.sourceImageId && asset.kind === 'image');
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
      : [...draft.referenceAssetIds, assetId].slice(0, 12);
    onDraft({ referenceAssetIds: references });
  };

  return (
    <div className={`composer-panel ${dragging ? 'is-drop-target' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={handleDrop}>
      <div className="composer-panel-heading">
        <div><span className="composer-eyebrow">{t('header.create')}</span><h2>{t(mode === 'image' ? 'create.imageTitle' : 'create.videoTitle')}</h2></div>
        <span className="composer-local-pill"><span />{t('create.cost')}</span>
      </div>

      <fieldset className="mode-switch">
        <legend className="visually-hidden">{t('header.create')}</legend>
        <button type="button" className={mode === 'image' ? 'is-active' : ''} aria-pressed={mode === 'image'} onClick={() => onMode('image')}><Images size={15} aria-hidden="true" />{t('create.modeImage')}</button>
        <button type="button" className={mode === 'video' ? 'is-active' : ''} aria-pressed={mode === 'video'} onClick={() => onMode('video')}><Film size={15} aria-hidden="true" />{t('create.modeVideo')}</button>
      </fieldset>

      {mode === 'video' ? <section className="composer-field source-frame-field">
        <FieldLabel>{t('create.sourceFrame')}</FieldLabel>
        {source ? <div className="source-frame-preview"><img src={source.uri} alt={source.title} /><div><strong>{source.title}</strong><span>{source.width && source.height ? `${source.width} × ${source.height}` : t('common.unknown')}</span></div><IconButton label={t('common.clear')} icon={X} size="small" onClick={() => onDraft({ sourceImageId: null })} /></div>
          : <button type="button" className="source-frame-empty" onClick={() => setPicker('source')}><ImagePlus size={17} aria-hidden="true" /><span>{t('create.chooseFrame')}</span><ArrowRight size={14} aria-hidden="true" /></button>}
        {!source ? <p className="composer-hint">{t('create.videoStart')}</p> : null}
      </section> : null}

      <section className="composer-field prompt-field">
        <div className="field-label-row"><label className="field-label" htmlFor="generation-prompt">{t('create.writePrompt')}</label><span className="field-hint">{new Intl.NumberFormat(snapshot.settings.locale).format(draft.prompt.length)} / 20,000</span></div>
        <textarea id="generation-prompt" className="prompt-input" maxLength={20000} spellCheck value={draft.prompt} onChange={(event) => onDraft({ prompt: event.currentTarget.value })} placeholder={t(mode === 'image' ? 'create.promptHint' : 'create.promptVideoHint')} />
        <div className="prompt-footer"><span>{t('create.switchPrompt')}</span><button type="button" className="text-action" disabled={!character || !(character.prompt || character.description)} onClick={addCharacterPrompt}><UserRound size={13} aria-hidden="true" />{t('create.insertCharacterPrompt')}</button></div>
      </section>

      <section className="composer-field">
        <FieldLabel htmlFor="create-character">{t('create.character')}</FieldLabel>
        <div className="composer-inline-control"><select id="create-character" className="select-control composer-select" value={draft.characterId ?? ''} onChange={(event) => onDraft({ characterId: event.currentTarget.value || null })}><option value="">{t('create.noCharacter')}</option>{snapshot.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><IconButton label={t('character.create')} icon={Plus} onClick={onCharacters} /></div>
      </section>

      {mode === 'image' ? <section className="composer-field">
        <div className="composer-section-line"><FieldLabel>{t('create.references')}</FieldLabel><span className="field-hint">{selectedReferences.length} / 12</span></div>
        {selectedReferences.length ? <div className="reference-chip-list">{selectedReferences.map((asset) => <div className="reference-chip" key={asset.id}><img src={asset.uri} alt="" /><span>{asset.title}</span><IconButton label={`${t('create.removeReference')}: ${asset.title}`} icon={X} size="small" onClick={() => toggleReference(asset.id)} /></div>)}</div> : null}
        <div className="reference-actions">
          <Button size="small" variant="secondary" icon={Plus} onClick={() => setPicker('references')}>{t('create.chooseFromLibrary')}</Button>
          <details className="reference-more-menu">
            <summary aria-label={t('create.moreReferenceOptions')} title={t('create.moreReferenceOptions')}><MoreHorizontal size={17} aria-hidden="true" /></summary>
            <div className="reference-menu-actions">
              <button type="button" onClick={onImport}><FolderOpen size={15} aria-hidden="true" />{t('create.importReference')}</button>
              <button type="button" onClick={onPaste}><FileImage size={15} aria-hidden="true" />{t('create.pasteReference')}</button>
            </div>
          </details>
        </div>
        <p className="composer-hint">{t('create.referenceHint')}</p>
        {dragging ? <div className="composer-drop-overlay" aria-live="polite">{t('create.dropHere')}</div> : null}
      </section> : null}

      <details className="composer-advanced">
        <summary>{t('create.moreOptions', { ratio: draft.aspectRatio })}</summary>
        <div className="composer-control-grid">
          <div className="composer-field"><FieldLabel htmlFor="create-model">{t('create.model')}</FieldLabel><select id="create-model" className="select-control composer-select" value={draft.modelId} onChange={(event) => onDraft({ modelId: event.currentTarget.value })}>{snapshot.capabilities.models.filter((item) => item.kind === mode).map((item) => <option key={item.id} value={item.id}>{item.id === 'mock-image' ? t('model.portraitStudy') : item.id === 'mock-video' ? t('model.motionStudy') : item.label}</option>)}</select><p className="composer-hint">{imageModel.id === 'mock-image' ? t('create.modelDetailImage') : t('create.modelDetailVideo')}</p></div>
          <div className="composer-field"><FieldLabel htmlFor="create-ratio">{t('create.ratio')}</FieldLabel><select id="create-ratio" className="select-control composer-select" value={draft.aspectRatio} onChange={(event) => onDraft({ aspectRatio: event.currentTarget.value })}>{ratios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></div>
        </div>
      </details>

      {mode === 'image' ? <section className="composer-field output-count-field"><FieldLabel>{t('create.outputs')}</FieldLabel><div className="count-control"><button type="button" aria-label={t('create.decreaseOutputs')} disabled={draft.outputCount <= 1} onClick={() => onDraft({ outputCount: Math.max(1, draft.outputCount - 1) })}><Minus size={14} aria-hidden="true" /></button><output aria-live="polite">{outputLabel}</output><button type="button" aria-label={t('create.increaseOutputs')} disabled={draft.outputCount >= 6} onClick={() => onDraft({ outputCount: Math.min(6, draft.outputCount + 1) })}><Plus size={14} aria-hidden="true" /></button></div></section> : null}

      <div className="composer-panel-bottom"><p><Info size={14} aria-hidden="true" />{t('create.localOnly')}</p><Button variant="primary" className="create-submit" icon={mode === 'image' ? Sparkles : Clapperboard} busy={busy} disabled={!draft.prompt.trim() || (mode === 'video' && !draft.sourceImageId)} onClick={onCreate}>{busy ? t('create.creating') : mode === 'image' ? t(draft.outputCount === 1 ? 'create.createImage' : 'create.createImages', { count: draft.outputCount }) : t('create.createVideo')}</Button></div>

      {picker ? <AssetPicker snapshot={snapshot} selectedIds={picker === 'source' ? draft.sourceImageId ? [draft.sourceImageId] : [] : draft.referenceAssetIds} single={picker === 'source'} title={picker === 'source' ? t('create.chooseFrame') : t('create.chooseFromLibrary')} t={t} onClose={() => setPicker(null)} onConfirm={(ids) => { onDraft(picker === 'source' ? { sourceImageId: ids[0] ?? null } : { referenceAssetIds: ids }); setPicker(null); }} /> : null}
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
      </div> : <div className="canvas-empty"><EmptyState icon={mode === 'image' ? Images : Film} title={t('studio.emptyTitle')} body={t('studio.emptyBody')} action={<Button variant="quiet" icon={FolderOpen} onClick={onOpenLibrary}>{t('studio.openLibrary')}</Button>} /></div>}

      <div className="canvas-footer-line"><span /><p>{t('create.localOnly')}</p></div>
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
        {asset.provenance.model ? <Metadata label={t('library.model')} value={asset.provenance.model === 'mock-image' ? t('model.portraitStudy') : asset.provenance.model === 'mock-video' ? t('model.motionStudy') : asset.provenance.model} /> : null}
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

export function AssetPicker({ snapshot, selectedIds, single = false, title, t, onClose, onConfirm }: {
  snapshot: AppSnapshot;
  selectedIds: string[];
  single?: boolean;
  title: string;
  t: Translate;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const assets = snapshot.assets.filter((asset) => !asset.deletedAt && asset.kind === 'image');
  const toggle = (id: string) => setSelected((current) => single ? current[0] === id ? [] : [id] : current.includes(id) ? current.filter((value) => value !== id) : [...current, id].slice(0, 12));
  return (
    <Modal title={title} onClose={onClose} closeLabel={t('common.close')} wide footer={<div className="picker-footer"><span>{t('library.selectedCount', { count: new Intl.NumberFormat(snapshot.settings.locale).format(selected.length) })}</span><div><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={single ? selected.length !== 1 : false} onClick={() => onConfirm(selected)}>{t('common.done')}</Button></div></div>}>
      {assets.length ? <div className="picker-grid">{assets.map((asset) => <button key={asset.id} className={`picker-item ${selected.includes(asset.id) ? 'is-selected' : ''}`} type="button" aria-pressed={selected.includes(asset.id)} onClick={() => toggle(asset.id)}><img src={asset.uri} alt="" /><span>{asset.title}</span><i>{selected.includes(asset.id) ? <Check size={14} /> : <Plus size={14} />}</i></button>)}</div> : <EmptyState icon={Images} title={t('library.emptyImagesTitle')} body={t('library.emptyBody')} />}
    </Modal>
  );
}

function AssetMedia({ asset, t, controls = false }: { asset: Asset; t: Translate; controls?: boolean }) {
  // oxlint-disable-next-line jsx-a11y/media-has-caption -- imported and sample videos can have no caption sidecar available to Clips.
  if (asset.kind === 'video') return <video className="asset-media-video" src={asset.uri} controls={controls} preload="metadata" aria-label={`${t('studio.play')}: ${asset.title}`} />;
  return <img className="asset-media-image" src={asset.uri} alt={asset.title} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.classList.add('is-missing'); }} />;
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div className="metadata-row"><dt>{label}</dt><dd title={value}>{value}</dd></div>;
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
  if (source === 'flow-handoff') return 'source.flow';
  return 'source.unknown';
}
