'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, Clapperboard, Film, FolderClosed, Images, Settings2, Sparkles, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';
import type { AppSnapshot, Asset, AssetKind, Character, CreateCharacterInput, ErrorCode, GenerationDraft, ImportIssue, JobKind, Locale, ProviderAccount, SettingsPatch, UpdateCharacterInput } from '@/shared/contracts';
import type { Notice, Translate, View } from '@/lib/app-types';
import { translate, type TranslationKey } from '@/lib/i18n';
import { AccountsWorkspace, SettingsWorkspace } from '@/components/Workspace';
import { CharactersWorkspace } from '@/components/Characters';
import { LibraryWorkspace } from '@/components/Library';
import { AssetDetails, CreatorCanvas, CreatorPanel, RecentJobs } from '@/components/Studio';
import { Button, IconButton, Modal } from '@/components/ui';

const errorCopy: Record<ErrorCode, TranslationKey> = {
  INVALID_INPUT: 'error.invalid',
  NOT_FOUND: 'error.notFound',
  UNSUPPORTED_MEDIA: 'error.unsupported',
  FILE_TOO_LARGE: 'error.large',
  TOO_MANY_FILES: 'error.tooMany',
  STORAGE_ERROR: 'error.storage',
  PROVIDER_UNAVAILABLE: 'error.provider',
  JOB_NOT_RETRYABLE: 'error.notRetryable',
  JOB_NOT_CANCELLABLE: 'error.notCancellable',
  ACCOUNT_IN_USE: 'error.accountInUse',
  PERMISSION_DENIED: 'error.permission',
  INTERNAL: 'error.internal',
};

const navDefinition = [
  { view: 'create', key: 'nav.create', icon: Sparkles },
  { view: 'characters', key: 'nav.characters', icon: Users },
  { view: 'images', key: 'nav.images', icon: Images },
  { view: 'videos', key: 'nav.videos', icon: Film },
  { view: 'library', key: 'nav.library', icon: FolderClosed },
] as const;

export function ClipsApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<View>('create');
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState('');
  const [removeAccount, setRemoveAccount] = useState<ProviderAccount | null>(null);
  const [deleteCharacter, setDeleteCharacter] = useState<Character | null>(null);
  const [importIssues, setImportIssues] = useState<ImportIssue[] | null>(null);
  const [createMode, setCreateMode] = useState<JobKind>('image');
  const [drafts, setDrafts] = useState<AppSnapshot['settings']['drafts'] | null>(null);
  const draftsInitialized = useRef(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locale: Locale = snapshot?.settings.locale ?? 'en';
  const t: Translate = useCallback((key, values) => translate(locale, key, values), [locale]);

  const announce = useCallback((message: string, tone: Notice['tone'] = 'neutral', action?: Notice['action']) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const id = Date.now();
    setNotice({ id, message, tone, action });
    toastTimer.current = setTimeout(() => setNotice((current) => current?.id === id ? null : current), 6500);
  }, []);

  const load = useCallback(async () => {
    setLoadError(false);
    if (!window.clips) {
      setLoadError(true);
      return;
    }
    try {
      const result = await window.clips.getSnapshot();
      if (!result.ok) {
        setLoadError(true);
        return;
      }
      let data = result.data;
      if (!localStorage.getItem('clips-locale-initialized')) {
        const browserLocale = navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
        const localeResult = await window.clips.setLocale(browserLocale);
        if (localeResult.ok) data = { ...data, settings: localeResult.data };
        localStorage.setItem('clips-locale-initialized', 'true');
      }
      setSnapshot(data);
      if (!localStorage.getItem('clips-onboarding-complete')) setOnboardingStep(0);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    if (!window.clips) return;
    const unsubscribe = window.clips.subscribe((next) => setSnapshot(next));
    return () => unsubscribe();
  }, [load]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!snapshot || draftsInitialized.current) return;
    setDrafts(snapshot.settings.drafts);
    draftsInitialized.current = true;
  }, [snapshot]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const setLocale = useCallback(async (nextLocale: Locale) => {
    if (!window.clips) return;
    const result = await window.clips.setLocale(nextLocale);
    if (result.ok) {
      setSnapshot((current) => current ? { ...current, settings: result.data } : current);
      localStorage.setItem('clips-locale-initialized', 'true');
    } else announce(translate(locale, errorCopy[result.error.code]), 'error');
  }, [announce, locale]);

  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    if (!window.clips) return;
    setPending('settings');
    try {
      const result = await window.clips.updateSettings(patch);
      if (result.ok) {
        setSnapshot((current) => current ? { ...current, settings: result.data } : current);
        setDrafts((current) => current ? {
          ...current,
          image: { ...current.image, modelId: result.data.imageModelId, aspectRatio: result.data.imageAspectRatio, outputCount: result.data.outputCount },
          video: { ...current.video, modelId: result.data.videoModelId, aspectRatio: result.data.videoAspectRatio },
        } : current);
        announce(translate(locale, 'settings.saved'));
      } else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'settings.saveError'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

  const updateDraft = useCallback((mode: JobKind, patch: Partial<GenerationDraft>) => {
    if (!snapshot) return;
    setDrafts((current) => {
      const base = current ?? snapshot.settings.drafts;
      return { ...base, [mode]: { ...base[mode], ...patch } };
    });
  }, [snapshot]);

  const imageDraft = drafts?.image;
  const videoDraft = drafts?.video;
  useEffect(() => {
    if (!draftsInitialized.current || !imageDraft || !window.clips) return;
    const timer = window.setTimeout(() => {
      void window.clips.saveDraft('image', imageDraft).then((result) => {
        if (!result.ok) announce(translate(locale, errorCopy[result.error.code]), 'error');
      }).catch(() => announce(translate(locale, 'settings.saveError'), 'error'));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [imageDraft, announce, locale]);
  useEffect(() => {
    if (!draftsInitialized.current || !videoDraft || !window.clips) return;
    const timer = window.setTimeout(() => {
      void window.clips.saveDraft('video', videoDraft).then((result) => {
        if (!result.ok) announce(translate(locale, errorCopy[result.error.code]), 'error');
      }).catch(() => announce(translate(locale, 'settings.saveError'), 'error'));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [videoDraft, announce, locale]);

  const handleImportSummary = useCallback((summary: { imported: Asset[]; rejected: ImportIssue[] }) => {
    if (summary.imported.length) announce(translate(locale, 'toast.imported', { count: new Intl.NumberFormat(locale).format(summary.imported.length) }));
    if (summary.rejected.length) {
      setImportIssues(summary.rejected);
      if (!summary.imported.length) announce(translate(locale, 'toast.noneImported'), 'error');
    }
    return summary.imported;
  }, [announce, locale]);

  const importFiles = useCallback(async () => {
    if (!window.clips) return [] as Asset[];
    setPending('import');
    try {
      const result = await window.clips.importFiles();
      if (result.ok) return handleImportSummary(result.data);
      announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
    } finally {
      setPending('');
    }
    return [] as Asset[];
  }, [announce, handleImportSummary, locale]);

  const importDroppedFiles = useCallback(async (files: readonly File[]) => {
    if (!window.clips || files.length === 0) return [] as Asset[];
    setPending('import');
    try {
      const result = await window.clips.importDroppedFiles(files);
      if (result.ok) return handleImportSummary(result.data);
      announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
    } finally {
      setPending('');
    }
    return [] as Asset[];
  }, [announce, handleImportSummary, locale]);

  const pasteClipboardImage = useCallback(async () => {
    if (!window.clips) return [] as Asset[];
    setPending('paste');
    try {
      const result = await window.clips.pasteClipboardImage();
      if (result.ok) {
        const imported = handleImportSummary(result.data);
        if (imported.length) announce(translate(locale, 'toast.pasted'));
        return imported;
      }
      announce(translate(locale, result.error.code === 'UNSUPPORTED_MEDIA' ? 'toast.clipboardEmpty' : errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.clipboardEmpty'), 'error');
    } finally {
      setPending('');
    }
    return [] as Asset[];
  }, [announce, handleImportSummary, locale]);

  const addReferenceAssets = useCallback((assets: Asset[]) => {
    if (!snapshot || assets.length === 0) return;
    const current = drafts?.[createMode] ?? snapshot.settings.drafts[createMode];
    const imageIds = assets.filter((asset) => asset.kind === 'image').map((asset) => asset.id);
    const referenceAssetIds = [...new Set([...current.referenceAssetIds, ...imageIds])].slice(0, 12);
    if (referenceAssetIds.length !== current.referenceAssetIds.length) {
      updateDraft(createMode, { referenceAssetIds });
      announce(translate(locale, 'create.referencesAdded'));
    }
  }, [announce, createMode, drafts, locale, snapshot, updateDraft]);

  const importReferences = useCallback(async () => addReferenceAssets(await importFiles()), [addReferenceAssets, importFiles]);
  const pasteReference = useCallback(async () => addReferenceAssets(await pasteClipboardImage()), [addReferenceAssets, pasteClipboardImage]);
  const dropReferences = useCallback(async (files: readonly File[]) => addReferenceAssets(await importDroppedFiles(files)), [addReferenceAssets, importDroppedFiles]);

  const createGeneration = useCallback(async () => {
    if (!window.clips || !snapshot) return;
    const draft = drafts?.[createMode] ?? snapshot.settings.drafts[createMode];
    if (!draft.prompt.trim()) {
      announce(translate(locale, 'create.promptRequired'), 'error');
      return;
    }
    setPending('generation');
    try {
      const result = createMode === 'image'
        ? await window.clips.generate({ prompt: draft.prompt, characterId: draft.characterId, referenceAssetIds: draft.referenceAssetIds, modelId: draft.modelId, aspectRatio: draft.aspectRatio, outputCount: draft.outputCount })
        : draft.sourceImageId
          ? await window.clips.generateImageToVideo({ prompt: draft.prompt, sourceImageId: draft.sourceImageId, characterId: draft.characterId, modelId: draft.modelId, aspectRatio: draft.aspectRatio })
          : null;
      if (result?.ok) {
        setSelectedAssetId(null);
        announce(translate(locale, 'toast.generationQueued'));
      } else if (result) announce(translate(locale, errorCopy[result.error.code]), 'error');
      else announce(translate(locale, 'create.frameRequired'), 'error');
    } catch {
      announce(translate(locale, 'error.provider'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, createMode, drafts, locale, snapshot]);

  const saveCharacter = useCallback(async (input: CreateCharacterInput | UpdateCharacterInput, id?: string): Promise<boolean> => {
    if (!window.clips) return false;
    setPending(id ?? 'character');
    try {
      const result = id
        ? await window.clips.updateCharacter(id, input as UpdateCharacterInput)
        : await window.clips.createCharacter(input as CreateCharacterInput);
      if (result.ok) {
        setSnapshot((current) => current ? { ...current, characters: [...current.characters.filter((item) => item.id !== result.data.id), result.data] } : current);
        announce(translate(locale, id ? 'character.updated' : 'character.created'));
        return true;
      }
      announce(translate(locale, errorCopy[result.error.code]), 'error');
      return false;
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
      return false;
    } finally {
      setPending('');
    }
  }, [announce, locale]);

  const confirmDeleteCharacter = useCallback(async () => {
    if (!window.clips || !deleteCharacter) return;
    setPending(deleteCharacter.id);
    try {
      const result = await window.clips.deleteCharacter(deleteCharacter.id);
      if (result.ok) {
        setSnapshot((current) => current ? { ...current, characters: current.characters.filter((item) => item.id !== deleteCharacter.id) } : current);
        announce(translate(locale, 'character.deleted'));
        setDeleteCharacter(null);
      } else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, deleteCharacter, locale]);

  const assignAssets = useCallback(async (assetIds: string[], characterId: string | null) => {
    if (!window.clips) return;
    setPending('assign-character');
    const results = await Promise.all(assetIds.map((assetId) => window.clips.assignAssetToCharacter(assetId, characterId)));
    const failed = results.find((result) => !result.ok);
    if (failed && !failed.ok) announce(translate(locale, errorCopy[failed.error.code]), 'error');
    else announce(translate(locale, 'toast.saved'));
    setPending('');
  }, [announce, locale]);

  const removeAsset = useCallback(async (asset: Asset) => {
    if (!window.clips) return;
    const result = await window.clips.deleteAsset(asset.id);
    if (result.ok) {
      setSelectedAssetId((current) => current === asset.id ? null : current);
      announce(translate(locale, 'toast.undoDelete'), 'neutral', { label: translate(locale, 'common.undo'), run: () => {
        void window.clips.undoDelete().then((undo) => {
          if (undo.ok) announce(translate(locale, 'toast.undone'));
          else announce(translate(locale, errorCopy[undo.error.code]), 'error');
        });
      } });
    } else announce(translate(locale, errorCopy[result.error.code]), 'error');
  }, [announce, locale]);

  const revealAsset = useCallback(async (asset: Asset) => {
    if (!window.clips) return;
    const result = await window.clips.revealAsset(asset.id);
    if (!result.ok) announce(translate(locale, errorCopy[result.error.code]), 'error');
  }, [announce, locale]);

  const useAsReference = useCallback((asset: Asset) => {
    if (asset.kind !== 'image') return;
    setCreateMode('image');
    updateDraft('image', { referenceAssetIds: [...new Set([...(drafts?.image ?? snapshot?.settings.drafts.image)?.referenceAssetIds ?? [], asset.id])].slice(0, 12) });
    setView('create');
    announce(translate(locale, 'create.referencesAdded'));
  }, [announce, drafts, locale, snapshot, updateDraft]);

  const useAsVideoSource = useCallback((asset: Asset) => {
    if (asset.kind !== 'image') return;
    setCreateMode('video');
    updateDraft('video', { sourceImageId: asset.id });
    setView('create');
  }, [snapshot, updateDraft]);

  const createWithCharacter = useCallback((character: Character) => {
    setCreateMode('image');
    updateDraft('image', { characterId: character.id, referenceAssetIds: character.referenceAssetIds.slice(0, 12) });
    setView('create');
  }, [updateDraft]);

  const openFlow = useCallback(async () => {
    if (!window.clips) return;
    setPending('flow');
    try {
      const result = await window.clips.openFlow();
      if (result.ok) announce(translate(locale, 'toast.flowOpened'));
      else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'error.provider'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

  const finishOnboarding = useCallback(() => {
    localStorage.setItem('clips-onboarding-complete', 'true');
    setOnboardingStep(null);
  }, []);

  const addAccountLabel = useCallback(async (label: string) => {
    if (!window.clips) return;
    setPending('account');
    try {
      const result = await window.clips.addAccount({ provider: 'google-flow', label });
      if (result.ok) {
        setSnapshot((current) => current ? {
          ...current,
          accounts: [...current.accounts.filter((account) => account.id !== result.data.id), result.data],
        } : current);
        announce(translate(locale, 'account.labelSaved'));
      } else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

  const switchAccount = useCallback(async (accountId: string) => {
    if (!window.clips) return;
    setPending(accountId);
    try {
      const result = await window.clips.switchAccount(accountId);
      if (result.ok) {
        setSnapshot((current) => current ? { ...current, settings: { ...current.settings, activeAccountId: accountId } } : current);
        announce(translate(locale, 'toast.saved'));
      } else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

  const confirmRemoveAccount = useCallback(async () => {
    if (!window.clips || !removeAccount) return;
    setPending(removeAccount.id);
    try {
      const result = await window.clips.removeAccount(removeAccount.id);
      if (result.ok) {
        setSnapshot((current) => current ? { ...current, accounts: current.accounts.filter((account) => account.id !== removeAccount.id) } : current);
        announce(translate(locale, 'account.removed'));
        setRemoveAccount(null);
      } else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale, removeAccount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inField = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setView('settings');
      } else if (event.key === 'Escape' && onboardingStep !== null) {
        event.preventDefault();
        finishOnboarding();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finishOnboarding, onboardingStep]);

  const titleKey: TranslationKey = view === 'settings' ? 'header.settings' : view === 'profile' ? 'header.profile' : `header.${view}` as TranslationKey;

  if (!snapshot) return <div className="boot-screen"><div className="boot-mark">C</div><p>{loadError ? t('app.unavailable') : t('app.loading')}</p>{loadError ? <Button onClick={() => void load()}>{t('app.retry')}</Button> : <span className="loading-rule" aria-hidden="true" />}</div>;

  const activeAccount = snapshot.accounts.find((account) => account.id === snapshot.settings.activeAccountId) ?? null;
  const currentDraft = drafts?.[createMode] ?? snapshot.settings.drafts[createMode];
  const selectedAsset = snapshot.assets.find((asset) => asset.id === selectedAssetId && !asset.deletedAt) ?? null;
  const currentView = view === 'create' ? <CreatorCanvas snapshot={snapshot} mode={createMode} selectedAssetId={selectedAssetId} t={t} onSelect={(asset) => setSelectedAssetId(asset.id)} onOpenLibrary={() => setView('library')} onUseReference={useAsReference} onUseVideoSource={useAsVideoSource} onInspect={(asset) => setSelectedAssetId(asset.id)} />
    : view === 'settings' ? <SettingsWorkspace snapshot={snapshot} onLocale={(value) => void setLocale(value)} onSettings={(patch) => void updateSettings(patch)} onReplayTutorial={() => setOnboardingStep(0)} t={t} />
      : view === 'profile' ? <AccountsWorkspace snapshot={snapshot} onOpenFlow={() => void openFlow()} onAddLabel={(label) => void addAccountLabel(label)} onSwitch={(id) => void switchAccount(id)} onRemove={(id) => setRemoveAccount(snapshot.accounts.find((account) => account.id === id) ?? null)} busy={Boolean(pending)} t={t} />
        : view === 'characters' ? <CharactersWorkspace characters={snapshot.characters} assets={snapshot.assets} locale={locale} t={t} busy={Boolean(pending)} onSave={saveCharacter} onDelete={(character) => setDeleteCharacter(character)} onCreateImage={createWithCharacter} />
          : <LibraryWorkspace snapshot={snapshot} kind={view === 'images' ? 'image' : view === 'videos' ? 'video' : 'all'} locale={locale} t={t} busy={Boolean(pending)} onKind={(kind) => setView(kind === 'all' ? 'library' : kind === 'image' ? 'images' : 'videos')} onImport={() => void importFiles()} onPaste={() => void pasteClipboardImage()} onDrop={(files) => void importDroppedFiles(files)} onReveal={(asset) => void revealAsset(asset)} onDelete={(asset) => void removeAsset(asset)} onUseReference={useAsReference} onUseVideoSource={useAsVideoSource} onAssign={(assetIds, characterId) => void assignAssets(assetIds, characterId)} />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">{t('accessibility.skipToContent')}</a>
      <nav className="navigation-rail" aria-label={t('accessibility.primaryNavigation')}>
        <button className="brand-mark" type="button" aria-label={t('app.name')} onClick={() => setView('create')}>C</button>
        <div className="rail-nav">
          {navDefinition.map(({ view: itemView, key, icon: Icon }) => <button key={itemView} type="button" className={`rail-nav-item ${view === itemView ? 'is-active' : ''}`} aria-label={t(key)} aria-current={view === itemView ? 'page' : undefined} title={t(key)} onClick={() => setView(itemView)}>
            <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>)}
        </div>
        <div className="rail-footer">
          <IconButton label={t('nav.profile')} icon={UserRound} active={view === 'profile'} onClick={() => setView('profile')} />
          <IconButton label={t('nav.settings')} icon={Settings2} active={view === 'settings'} onClick={() => setView('settings')} />
        </div>
      </nav>

      <aside className={`phase-one-panel ${view === 'create' ? 'creator-side-panel' : ''}`}>
        <div className="phase-panel-brand"><span className="brand-wordmark">{t('app.name')}</span><span className="local-mark">{t('header.sampleMode')}</span></div>
        {view === 'create' ? <CreatorPanel snapshot={snapshot} mode={createMode} draft={currentDraft} busy={pending === 'generation'} t={t} onMode={setCreateMode} onDraft={(patch) => updateDraft(createMode, patch)} onImport={() => void importReferences()} onPaste={() => void pasteReference()} onDrop={(files) => void dropReferences(files)} onCreate={() => void createGeneration()} onCharacters={() => setView('characters')} onLibrary={() => setView('library')} /> : <>
          <div className="phase-panel-content">
            {view === 'settings' ? <><h2>{t('settings.title')}</h2><p>{t('settings.languageHint')}</p><div className="panel-rail-line" /><p>{t('settings.storageLocation')}</p></>
              : view === 'profile' ? <><h2>{t('account.title')}</h2><p>{t('account.flowBoundary')}</p><div className="panel-rail-line" /><Button variant="quiet" icon={Settings2} onClick={() => setView('settings')}>{t('nav.settings')}</Button></>
                : view === 'characters' ? <><h2>{t('workspace.sideTitle')}</h2><p>{t('character.emptyBody')}</p><div className="panel-rail-line" /><Button variant="quiet" icon={Sparkles} onClick={() => setView('create')}>{t('character.useForImage')}</Button></>
                  : <><h2>{t('workspace.sideTitle')}</h2><p>{t('workspace.sideBody')}</p><div className="side-process-list"><span><i />{t('onboarding.characters')}</span><span><i />{t('onboarding.images')}</span><span><i />{t('onboarding.video')}</span></div><div className="panel-rail-line" /><p className="side-footnote">{t('workspace.localPromise')}</p></>}
          </div>
          <div className="phase-panel-footer"><span className="footer-key-mark">⌘</span><span>{t('settings.version')}</span></div>
        </>}
      </aside>

      <section className="main-column">
        <header className="workspace-toolbar">
          <div className="workspace-toolbar-title"><span className="toolbar-context-line" /><h1>{t(titleKey)}</h1></div>
          <div className="toolbar-actions">
            <span className="provider-indicator"><span className="provider-indicator-line" />{activeAccount?.provider === 'mock' ? t('model.localName') : t('account.browserProfile')}</span>
            <button type="button" className={`toolbar-account ${view === 'profile' ? 'is-current' : ''}`} onClick={() => setView('profile')} aria-label={t('nav.profile')}><UserRound size={17} strokeWidth={1.7} /><span>{activeAccount?.provider === 'mock' ? t('account.localTitle') : activeAccount?.label ?? t('common.noAccount')}</span></button>
            <IconButton label={t('nav.settings')} icon={Settings2} active={view === 'settings'} onClick={() => setView('settings')} />
          </div>
        </header>
        {currentView}
      </section>

      <aside className="context-panel context-work-panel">
        <div className="context-panel-heading"><span className="context-overline">{selectedAsset ? t('library.inspector') : t('queue.title')}</span><span className="context-heading-line" /></div>
        {selectedAsset ? <AssetDetails asset={selectedAsset} snapshot={snapshot} t={t} onDelete={(asset) => void removeAsset(asset)} onReveal={(asset) => void revealAsset(asset)} onUseReference={useAsReference} onUseVideoSource={useAsVideoSource} /> : <>
          <RecentJobs jobs={snapshot.jobs} t={t} />
          <div className="context-work-footer"><span className="context-footer-line" /><p>{t('create.localOnly')}</p><Button variant="quiet" icon={ArrowUpRight} busy={pending === 'flow'} onClick={() => void openFlow()}>{t('account.openFlow')}</Button></div>
        </>}
      </aside>

      {notice ? <div key={notice.id} className={`toast ${notice.tone === 'error' ? 'toast-error' : ''}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}>
        <span className="toast-indicator" aria-hidden="true" />
        <span>{notice.message}</span>
        {notice.action ? <button type="button" onClick={() => { notice.action?.run(); setNotice(null); }}>{notice.action.label}</button> : null}
        <IconButton label={t('common.close')} icon={X} size="small" onClick={() => setNotice(null)} />
      </div> : null}

      {onboardingStep !== null ? <Onboarding step={onboardingStep} locale={locale} onStep={setOnboardingStep} onDone={finishOnboarding} onOpenFlow={() => void openFlow()} onLocale={(value) => void setLocale(value)} t={t} /> : null}

      {removeAccount ? <Modal title={t('account.removeTitle')} description={t('account.removeBody')} onClose={() => setRemoveAccount(null)} closeLabel={t('common.close')} footer={<><Button onClick={() => setRemoveAccount(null)}>{t('common.cancel')}</Button><Button variant="danger" busy={pending === removeAccount.id} onClick={() => void confirmRemoveAccount()}>{t('account.remove')}</Button></>}>
        <p className="remove-account-label">{removeAccount.label}</p>
      </Modal> : null}
      {deleteCharacter ? <Modal title={t('character.deleteTitle')} description={t('character.deleteBody')} onClose={() => setDeleteCharacter(null)} closeLabel={t('common.close')} footer={<><Button onClick={() => setDeleteCharacter(null)}>{t('common.cancel')}</Button><Button variant="danger" busy={pending === deleteCharacter.id} onClick={() => void confirmDeleteCharacter()}>{t('common.delete')}</Button></>}><p className="remove-account-label">{deleteCharacter.name}</p></Modal> : null}
      {importIssues ? <Modal title={t('modal.importIssues')} description={t('modal.importIssuesHint')} onClose={() => setImportIssues(null)} closeLabel={t('common.close')}><ul className="import-issues-list">{importIssues.map((issue, index) => <li key={`${issue.name}-${index}`}><strong>{issue.name}</strong><span>{issue.message}</span></li>)}</ul><div className="import-issues-footer"><Button variant="primary" onClick={() => setImportIssues(null)}>{t('common.done')}</Button></div></Modal> : null}
    </div>
  );
}

function Onboarding({ step, locale, onStep, onDone, onOpenFlow, onLocale, t }: {
  step: number;
  locale: Locale;
  onStep: (step: number) => void;
  onDone: () => void;
  onOpenFlow: () => void;
  onLocale: (locale: Locale) => void;
  t: Translate;
}) {
  const titles: TranslationKey[] = ['onboarding.welcomeTitle', 'onboarding.flowTitle', 'onboarding.localTitle', 'onboarding.readyTitle'];
  const bodies: TranslationKey[] = ['onboarding.welcomeBody', 'onboarding.flowBody', 'onboarding.localBody', 'onboarding.readyBody'];
  const current = Math.max(0, Math.min(3, step));
  const previous = useCallback(() => onStep(Math.max(0, current - 1)), [current, onStep]);
  const next = useCallback(() => current >= 3 ? onDone() : onStep(current + 1), [current, onDone, onStep]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
      if (event.key === 'ArrowLeft' && current > 0) { event.preventDefault(); previous(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, next, previous]);
  return (
    <Modal title={t(titles[current])} description={t(bodies[current])} onClose={onDone} closeLabel={t('common.close')} wide labelledBy="onboarding-title" footer={
      <div className="onboarding-footer">
        <label className="onboarding-language"><span>{t('onboarding.language')}</span><select value={locale} aria-label={t('onboarding.language')} onChange={(event) => onLocale(event.currentTarget.value as Locale)}><option value="en">{t('settings.english')}</option><option value="de">{t('settings.german')}</option></select></label>
        <div className="onboarding-steps" aria-label={`${current + 1} / 4`}>{[0, 1, 2, 3].map((index) => <button key={index} type="button" className={index === current ? 'is-current' : index < current ? 'is-complete' : ''} aria-label={t('onboarding.goToStep', { count: index + 1 })} onClick={() => onStep(index)} />)}</div>
        <div className="onboarding-actions">
          {current > 0 ? <Button size="small" onClick={previous}>{t('common.back')}</Button> : <button type="button" className="onboarding-skip" onClick={onDone}>{t('common.skip')}</button>}
          {current === 1 ? <Button size="small" icon={ArrowUpRight} onClick={onOpenFlow}>{t('onboarding.openFlow')}</Button> : null}
          <Button variant="primary" size="small" onClick={next}>{current === 3 ? t('onboarding.start') : t('common.continue')}</Button>
        </div>
      </div>
    }>
      <div className={`onboarding-visual onboarding-visual-${current}`}>
        {current === 0 ? <div className="onboarding-flow-map"><StepMark icon={Users} label={t('onboarding.characters')} /><span /><StepMark icon={Images} label={t('onboarding.images')} /><span /><StepMark icon={Clapperboard} label={t('onboarding.video')} /></div>
          : current === 1 ? <div className="onboarding-browser-visual"><span className="browser-topline"><i /><i /><i /></span><div className="browser-site-mark">Flow</div><div className="browser-site-line" /><div className="browser-site-line short" /><ArrowUpRight size={19} aria-hidden="true" /></div>
            : current === 2 ? <div className="onboarding-local-visual"><div className="local-visual-folder"><FolderClosed size={26} strokeWidth={1.4} /></div><div className="local-visual-lines"><span /><span /><span /></div><span className="local-visual-rule" /></div>
              : <div className="onboarding-ready-visual"><span className="ready-mark"><Sparkles size={24} strokeWidth={1.4} /></span><span className="ready-rail" /><span className="ready-rail short" /></div>}
      </div>
    </Modal>
  );
}

function StepMark({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return <div className="onboarding-step-mark"><span><Icon size={19} strokeWidth={1.5} aria-hidden="true" /></span><strong>{label}</strong></div>;
}
