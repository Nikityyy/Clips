'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ImagePlus, Pencil, Plus, Trash2, UserRound, Users } from 'lucide-react';
import type { Asset, Character, CreateCharacterInput, UpdateCharacterInput } from '@/shared/contracts';
import type { Translate } from '@/lib/app-types';
import { Button, EmptyState, FieldLabel, IconButton, Modal, SectionHeading } from '@/components/ui';

export function CharactersWorkspace({ characters, assets, locale, t, busy, onSave, onDelete, onCreateImage }: {
  characters: Character[];
  assets: Asset[];
  locale: 'en' | 'de';
  t: Translate;
  busy: boolean;
  onSave: (input: CreateCharacterInput | UpdateCharacterInput, id?: string) => Promise<boolean>;
  onDelete: (character: Character) => void;
  onCreateImage: (character: Character) => void;
}) {
  const [editing, setEditing] = useState<Character | 'new' | null>(null);
  const portraits = assets.filter((asset) => !asset.deletedAt && asset.kind === 'image');
  const ordered = useMemo(() => [...characters].sort((left, right) => left.name.localeCompare(right.name, locale)), [characters, locale]);

  return (
    <main className="workspace-content characters-workspace" id="workspace-content" tabIndex={-1}>
      <SectionHeading title={t('nav.characters')} action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>{t('character.create')}</Button>}>
        <p>{t('character.emptyBody')}</p>
      </SectionHeading>
      {ordered.length ? <div className="character-grid">{ordered.map((character, index) => {
        const portrait = portraits.find((asset) => asset.id === character.portraitAssetId) ?? portraits.find((asset) => character.referenceAssetIds.includes(asset.id));
        const referenceCount = new Set([...character.referenceAssetIds, ...assets.filter((asset) => asset.provenance.characterIds.includes(character.id)).map((asset) => asset.id)]).size;
        return <article key={character.id} className="character-card" style={{ ['--tile-index' as string]: index }}>
          <div className="character-card-image">{portrait ? <img src={portrait.uri} alt={character.name} loading="lazy" decoding="async" /> : <div className="character-image-empty"><UserRound size={28} aria-hidden="true" /></div>}<span className="character-card-index">{String(index + 1).padStart(2, '0')}</span></div>
          <div className="character-card-copy"><h2>{character.name}</h2><p>{character.description || character.prompt || t('common.unknown')}</p><span className="character-reference-count">{t('character.referenceCount', { count: new Intl.NumberFormat(locale).format(referenceCount) })}</span></div>
          <div className="character-card-actions"><Button size="small" variant="primary" icon={ImagePlus} onClick={() => onCreateImage(character)}>{t('character.useForImage')}</Button><IconButton label={`${t('common.open')}: ${character.name}`} icon={Pencil} onClick={() => setEditing(character)} /><IconButton label={`${t('character.deleteTitle')}: ${character.name}`} icon={Trash2} onClick={() => onDelete(character)} /></div>
        </article>;
      })}</div> : <div className="characters-empty"><EmptyState icon={Users} title={t('character.emptyTitle')} body={t('character.emptyBody')} action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>{t('character.create')}</Button>} /></div>}
      {editing ? <CharacterForm key={editing === 'new' ? 'new' : editing.id} character={editing === 'new' ? null : editing} portraits={portraits} t={t} busy={busy} onClose={() => setEditing(null)} onSave={onSave} /> : null}
    </main>
  );
}

function CharacterForm({ character, portraits, t, busy, onClose, onSave }: {
  character: Character | null;
  portraits: Asset[];
  t: Translate;
  busy: boolean;
  onClose: () => void;
  onSave: (input: CreateCharacterInput | UpdateCharacterInput, id?: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(character?.name ?? '');
  const [description, setDescription] = useState(character?.description ?? '');
  const [prompt, setPrompt] = useState(character?.prompt ?? '');
  const [portraitAssetId, setPortraitAssetId] = useState(character?.portraitAssetId ?? '');
  const [referenceAssetIds, setReferenceAssetIds] = useState(character?.referenceAssetIds ?? []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = { name: name.trim(), description: description.trim(), prompt: prompt.trim(), portraitAssetId: portraitAssetId || null, referenceAssetIds };
    if (await onSave(payload, character?.id)) onClose();
  };

  return <Modal title={t(character ? 'character.editTitle' : 'character.createTitle')} description={t('character.descriptionHint')} onClose={onClose} closeLabel={t('common.close')} wide footer={<div className="form-modal-actions"><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={character ? Pencil : Plus} busy={busy} disabled={!name.trim()} onClick={() => { const form = document.getElementById('character-form'); if (form instanceof HTMLFormElement) form.requestSubmit(); }}>{t(character ? 'common.save' : 'character.createButton')}</Button></div>}>
    <form id="character-form" className="character-form" onSubmit={submit}>
      <div className="character-form-main">
        <div><FieldLabel htmlFor="character-name">{t('character.name')}</FieldLabel><input id="character-name" className="text-input" maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder={t('character.nameHint')} autoFocus /></div>
        <div><FieldLabel htmlFor="character-description">{t('character.description')}</FieldLabel><textarea id="character-description" className="text-area-control" maxLength={600} rows={3} value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder={t('character.descriptionHint')} /></div>
        <div><FieldLabel htmlFor="character-prompt">{t('character.prompt')}</FieldLabel><textarea id="character-prompt" className="text-area-control character-prompt-control" maxLength={6000} rows={5} value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} placeholder={t('character.promptHint')} /></div>
      </div>
      <div className="character-form-side">
        <div><FieldLabel htmlFor="character-portrait">{t('character.portrait')}</FieldLabel><select id="character-portrait" className="select-control setting-select" value={portraitAssetId} onChange={(event) => setPortraitAssetId(event.currentTarget.value)}><option value="">{t('common.optional')}</option>{portraits.map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></div>
        <div><FieldLabel htmlFor="character-references">{t('character.references')}</FieldLabel><select id="character-references" className="select-control reference-multi-select" multiple value={referenceAssetIds} onChange={(event) => setReferenceAssetIds([...event.currentTarget.selectedOptions].map((option) => option.value))}>{portraits.map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select><p className="composer-hint">{t('create.referenceHint')}</p></div>
      </div>
    </form>
  </Modal>;
}
