'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { ArrowDownUp, FileUp, FolderOpen, Images, ListChecks, Plus, Search, X } from 'lucide-react';
import type { AppSnapshot, Asset, AssetKind, Character } from '@/shared/contracts';
import type { Translate } from '@/lib/app-types';
import { dateTime, fileSize } from '@/lib/i18n';
import { AssetDetails } from '@/components/Studio';
import { Button, EmptyState, IconButton, Modal, SectionHeading } from '@/components/ui';

export function LibraryWorkspace({ snapshot, kind, locale, t, busy, onKind, onImport, onPaste, onDrop, onReveal, onDelete, onUseReference, onUseVideoSource, onAssign }: {
  snapshot: AppSnapshot;
  kind: AssetKind | 'all';
  locale: 'en' | 'de';
  t: Translate;
  busy: boolean;
  onKind: (kind: AssetKind | 'all') => void;
  onImport: () => void;
  onPaste: () => void;
  onDrop: (files: readonly File[]) => void;
  onReveal: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
  onUseReference: (asset: Asset) => void;
  onUseVideoSource: (asset: Asset) => void;
  onAssign: (assetIds: string[], characterId: string | null) => void;
}) {
  const { assets, characters } = snapshot;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'oldest' | 'name'>('recent');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [inspecting, setInspecting] = useState<Asset | null>(null);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase(locale);
    return assets.filter((asset) => {
      if (asset.deletedAt || (kind !== 'all' && asset.kind !== kind)) return false;
      if (!search) return true;
      const characterNames = characters.filter((character) => asset.provenance.characterIds.includes(character.id)).map((character) => character.name).join(' ');
      return [asset.title, asset.fileName, asset.provenance.prompt ?? '', characterNames].some((value) => value.toLocaleLowerCase(locale).includes(search));
    }).sort((left, right) => sort === 'name' ? left.title.localeCompare(right.title, locale) : sort === 'oldest' ? left.createdAt.localeCompare(right.createdAt) : right.createdAt.localeCompare(left.createdAt));
  }, [assets, characters, kind, locale, query, sort]);

  const toggleSelect = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) onDrop([...event.dataTransfer.files]);
  };

  return (
    <main className={`workspace-content library-workspace ${dragging ? 'is-drop-target' : ''}`} id="workspace-content" tabIndex={-1} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={handleDrop}>
      <SectionHeading title={t(kind === 'all' ? 'nav.library' : kind === 'image' ? 'nav.images' : 'nav.videos')} action={<div className="library-header-actions"><Button variant="secondary" icon={FileUp} disabled={busy} onClick={onImport}>{t('library.import')}</Button><Button variant="quiet" icon={Images} disabled={busy} onClick={onPaste}>{t('library.paste')}</Button></div>}>
        <p>{t('library.items', { count: new Intl.NumberFormat(locale).format(filtered.length) })}</p>
      </SectionHeading>

      <div className="library-toolbar">
        <div className="library-kind-tabs" role="group" aria-label={t('library.all')}>
          {(['all', 'image', 'video'] as const).map((filter) => <button type="button" key={filter} className={(kind === filter || (kind === 'all' && filter === 'all')) ? 'is-active' : ''} aria-pressed={kind === filter} onClick={() => onKind(filter)}>{t(filter === 'all' ? 'library.all' : filter === 'image' ? 'library.images' : 'library.videos')}</button>)}
        </div>
        <label className="library-search"><Search size={16} aria-hidden="true" /><input aria-label={t('common.search')} value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t('library.searchPlaceholder')} />{query ? <IconButton label={t('common.clear')} icon={X} size="small" onClick={() => setQuery('')} /> : null}</label>
        <label className="library-sort-control"><ArrowDownUp size={14} aria-hidden="true" /><span className="visually-hidden">{t('library.sort')}</span><select aria-label={t('library.sort')} className="select-control" value={sort} onChange={(event) => setSort(event.currentTarget.value as typeof sort)}><option value="recent">{t('library.sortRecent')}</option><option value="oldest">{t('library.sortOldest')}</option><option value="name">{t('library.sortName')}</option></select></label>
        <Button size="small" variant={selecting ? 'secondary' : 'quiet'} icon={selecting ? ListChecks : Plus} onClick={() => { setSelecting((current) => !current); setSelectedIds([]); }}>{t(selecting ? 'library.finishSelecting' : 'library.select')}</Button>
      </div>

      {selecting && selectedIds.length ? <div className="bulk-selection-bar"><span>{t('library.selectedCount', { count: new Intl.NumberFormat(locale).format(selectedIds.length) })}</span><label><span className="visually-hidden">{t('library.assignCharacter')}</span><select className="select-control" aria-label={t('library.assignCharacter')} value="" onChange={(event) => { if (event.currentTarget.value) { onAssign(selectedIds, event.currentTarget.value === '__none' ? null : event.currentTarget.value); setSelectedIds([]); } }}><option value="" disabled>{t('library.assignCharacter')}</option>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}<option value="__none">{t('library.removeCharacter')}</option></select></label><Button size="small" variant="quiet" icon={X} onClick={() => setSelectedIds([])}>{t('library.clearSelection')}</Button></div> : null}

      {filtered.length ? <div className="library-grid">{filtered.map((asset, index) => <article key={asset.id} className={`library-card ${selectedIds.includes(asset.id) ? 'is-selected' : ''}`} style={{ ['--tile-index' as string]: index }}>
        {selecting ? <button type="button" className="library-card-select" aria-label={`${t(selectedIds.includes(asset.id) ? 'library.clearSelection' : 'library.select')}: ${asset.title}`} aria-pressed={selectedIds.includes(asset.id)} onClick={() => toggleSelect(asset.id)}><span>{selectedIds.includes(asset.id) ? <span className="selection-check">✓</span> : null}</span></button> : null}
        <button type="button" className="library-card-open" onClick={() => { setInspecting(asset); }} aria-label={`${t('studio.inspect')}: ${asset.title}`}><div className="library-card-media">{asset.kind === 'image' ? <img src={asset.uri} alt="" loading="lazy" decoding="async" /> : <video src={asset.uri} preload="metadata" muted aria-label={asset.title} />}<span className="library-card-type">{asset.kind === 'image' ? t('library.images') : t('library.videos')}</span></div><div className="library-card-copy"><strong>{asset.title}</strong><span>{dateTime(locale, asset.createdAt)}</span><small>{fileSize(locale, asset.sizeBytes)}</small></div></button>
      </article>)}</div> : query ? <div className="library-empty"><EmptyState icon={Search} title={t('library.emptySearch', { query })} action={<Button variant="quiet" onClick={() => setQuery('')}>{t('library.clearSearch')}</Button>} /></div>
        : <div className="library-empty"><EmptyState icon={kind === 'video' ? FileUp : Images} title={t(kind === 'image' ? 'library.emptyImagesTitle' : kind === 'video' ? 'library.emptyVideosTitle' : 'library.emptyAllTitle')} body={t('library.emptyBody')} action={<Button variant="primary" icon={FileUp} disabled={busy} onClick={onImport}>{t('library.import')}</Button>} /></div>}

      {dragging ? <div className="library-drop-overlay" aria-live="polite"><FolderOpen size={24} aria-hidden="true" /><strong>{t('library.dropTitle')}</strong><span>{t('library.dropTitle')}</span></div> : null}
      {inspecting ? <Modal title={t('library.inspector')} onClose={() => setInspecting(null)} closeLabel={t('common.close')} wide><AssetDetails asset={assets.find((asset) => asset.id === inspecting.id) ?? inspecting} snapshot={snapshot} t={t} onDelete={(asset) => { setInspecting(null); onDelete(asset); }} onReveal={onReveal} onUseReference={(asset) => { setInspecting(null); onUseReference(asset); }} onUseVideoSource={(asset) => { setInspecting(null); onUseVideoSource(asset); }} /></Modal> : null}
    </main>
  );
}
