'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clapperboard, ExternalLink, FolderClosed, Images, ListTodo, Settings2, ShieldCheck, Sparkles, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';
import type { AppSnapshot, Asset, Character, CreateCharacterInput, ErrorCode, GenerationDraft, GenerationJob, ImportIssue, JobKind, Locale, NativeMenuAction, SettingsPatch, UpdateCharacterInput } from '@/shared/contracts';
import type { Notice, Translate, View } from '@/lib/app-types';
import { translate, type TranslationKey } from '@/lib/i18n';
import { AccountsWorkspace, SettingsWorkspace } from '@/components/Workspace';
import { CharactersWorkspace } from '@/components/Characters';
import { LibraryWorkspace } from '@/components/Library';
import { QueueWorkspace } from '@/components/Queue';
import { AssetDetails, CreatorCanvas, CreatorPanel } from '@/components/Studio';
import { Button, IconButton, MenuSelect, Modal, TooltipLayer } from '@/components/ui';

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
  PERMISSION_DENIED: 'error.permission',
  INTERNAL: 'error.internal',
};

const navDefinition = [
  { view: 'create', key: 'nav.create', icon: Sparkles },
  { view: 'characters', key: 'nav.characters', icon: Users },
  { view: 'library', key: 'nav.library', icon: FolderClosed },
  { view: 'queue', key: 'nav.queue', icon: ListTodo },
] as const;

export function ClipsApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<View>('create');
  const [libraryKind, setLibraryKind] = useState<'all' | 'image' | 'video'>('all');
  const [welcomeStep, setWelcomeStep] = useState<number | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [flowNoticeChecked, setFlowNoticeChecked] = useState(false);
  const [gateError, setGateError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState('');
  const [deleteCharacter, setDeleteCharacter] = useState<Character | null>(null);
  const [importIssues, setImportIssues] = useState<ImportIssue[] | null>(null);
  const [createMode, setCreateMode] = useState<JobKind>('image');
  const [drafts, setDrafts] = useState<AppSnapshot['settings']['drafts'] | null>(null);
  const draftsInitialized = useRef(false);
  const onboardingResetConsumed = useRef(false);
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
      const forceOnboarding = !onboardingResetConsumed.current && new URLSearchParams(window.location.search).get('clips-reset-onboarding') === '1';
      onboardingResetConsumed.current = true;
      if (forceOnboarding) {
        localStorage.removeItem('clips-welcome-complete');
        localStorage.removeItem('clips-onboarding-complete');
      }
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
      setSnapshot((current) => current && current.revision > data.revision ? current : data);
      if (forceOnboarding || !localStorage.getItem('clips-welcome-complete')) setWelcomeStep(0);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- this effect hydrates the app snapshot from the local SQLite bridge.
    void load();
    if (!window.clips) return;
    const unsubscribe = window.clips.subscribe((next) => {
      setSnapshot((current) => current && current.revision > next.revision ? current : next);
      if (!draftsInitialized.current) return;
      const imageModels = next.capabilities.models.filter((model) => model.kind === 'image');
      const videoModels = next.capabilities.models.filter((model) => model.kind === 'video');
      if (!imageModels.length || !videoModels.length) return;
      setDrafts((current) => {
        const base = current ?? next.settings.drafts;
        const imageModelId = imageModels.some((model) => model.id === base.image.modelId) ? base.image.modelId : next.settings.drafts.image.modelId;
        const videoModelId = videoModels.some((model) => model.id === base.video.modelId) ? base.video.modelId : next.settings.drafts.video.modelId;
        const imageAspectRatio = next.capabilities.imageAspectRatios.includes(base.image.aspectRatio) ? base.image.aspectRatio : next.settings.drafts.image.aspectRatio;
        const videoAspectRatio = next.capabilities.videoAspectRatios.includes(base.video.aspectRatio) ? base.video.aspectRatio : next.settings.drafts.video.aspectRatio;
        if (imageModelId === base.image.modelId && videoModelId === base.video.modelId && imageAspectRatio === base.image.aspectRatio && videoAspectRatio === base.video.aspectRatio) return base;
        return {
          ...base,
          image: { ...base.image, modelId: imageModelId, aspectRatio: imageAspectRatio },
          video: { ...base.video, modelId: videoModelId, aspectRatio: videoAspectRatio },
        };
      });
    });
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
    if (!draftsInitialized.current || !imageDraft || !window.clips || !snapshot?.capabilities.models.some((model) => model.kind === 'image')) return;
    const timer = window.setTimeout(() => {
      void window.clips.saveDraft('image', imageDraft).then((result) => {
        if (!result.ok) announce(translate(locale, errorCopy[result.error.code]), 'error');
      }).catch(() => announce(translate(locale, 'settings.saveError'), 'error'));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [imageDraft, announce, locale, snapshot?.capabilities.models]);
  useEffect(() => {
    if (!draftsInitialized.current || !videoDraft || !window.clips || !snapshot?.capabilities.models.some((model) => model.kind === 'video')) return;
    const timer = window.setTimeout(() => {
      void window.clips.saveDraft('video', videoDraft).then((result) => {
        if (!result.ok) announce(translate(locale, errorCopy[result.error.code]), 'error');
      }).catch(() => announce(translate(locale, 'settings.saveError'), 'error'));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [videoDraft, announce, locale, snapshot?.capabilities.models]);

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

  useEffect(() => {
    if (!window.clips) return;
    return window.clips.subscribeMenuAction((action: NativeMenuAction) => {
      if (action === 'import') {
        void importFiles();
        return;
      }
      setView(action);
    });
  }, [importFiles]);

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
    if (snapshot.capabilities.provider === 'google-flow' && snapshot.capabilities.status !== 'ready') {
      setView('profile');
      return;
    }
    setPending('generation');
    try {
      const result = createMode === 'image'
        ? await window.clips.generate({ prompt: draft.prompt, characterId: draft.characterId, referenceAssetIds: draft.referenceAssetIds, modelId: draft.modelId, aspectRatio: draft.aspectRatio, outputCount: draft.outputCount })
        : await window.clips.generateImageToVideo({ prompt: draft.prompt, referenceAssetIds: draft.referenceAssetIds, characterId: draft.characterId, modelId: draft.modelId, aspectRatio: draft.aspectRatio });
      if (result.ok) {
        setSelectedAssetId(null);
        announce(translate(locale, 'toast.generationQueued'));
      } else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'error.provider'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, createMode, drafts, locale, snapshot]);

  const retryGenerationJob = useCallback(async (job: GenerationJob) => {
    if (!window.clips) return;
    setPending(`job:${job.id}`);
    try {
      const result = await window.clips.retryJob(job.id);
      if (result.ok) announce(translate(locale, 'queue.retryStarted'));
      else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

  const cancelGenerationJob = useCallback(async (job: GenerationJob) => {
    if (!window.clips) return;
    setPending(`job:${job.id}`);
    try {
      const result = await window.clips.cancelJob(job.id);
      if (result.ok) announce(translate(locale, 'queue.cancelledBody'));
      else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'toast.error'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

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

  const useAsReference = (asset: Asset) => {
    if (asset.kind !== 'image') return;
    setCreateMode('image');
    updateDraft('image', { referenceAssetIds: [...new Set([...(drafts?.image ?? snapshot?.settings.drafts.image)?.referenceAssetIds ?? [], asset.id])].slice(0, 12) });
    setView('create');
    announce(translate(locale, 'create.referencesAdded'));
  };

  const useAsVideoSource = useCallback((asset: Asset) => {
    if (asset.kind !== 'image') return;
    setCreateMode('video');
    const current = drafts?.video ?? snapshot?.settings.drafts.video;
    updateDraft('video', { referenceAssetIds: [...new Set([...(current?.referenceAssetIds ?? []), asset.id])].slice(0, 12), sourceImageId: null });
    setView('create');
  }, [drafts, snapshot, updateDraft]);

  const createWithCharacter = useCallback((character: Character) => {
    setCreateMode('image');
    updateDraft('image', { characterId: character.id, referenceAssetIds: character.referenceAssetIds.slice(0, 12) });
    setView('create');
  }, [updateDraft]);

  const reuseJobSettings = useCallback((job: GenerationJob) => {
    if (!snapshot) return;
    updateDraft(job.kind, {
      prompt: job.prompt,
      characterId: job.characterId,
      referenceAssetIds: job.inputAssetIds.slice(0, 12),
      sourceImageId: null,
      modelId: job.modelId,
      aspectRatio: job.aspectRatio,
      outputCount: job.outputCount,
    });
    setCreateMode(job.kind);
    setSelectedAssetId(null);
    setView('create');
    announce(translate(locale, 'queue.settingsReused'));
  }, [announce, locale, snapshot, updateDraft]);

  const openDataFolder = useCallback(async () => {
    if (!window.clips) return;
    setPending('openDataFolder');
    try {
      const result = await window.clips.openDataFolder();
      if (result.ok) announce(translate(locale, 'settings.folderOpened'));
      else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'error.storage'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

  const acceptFlowNotice = useCallback(async () => {
    if (!window.clips || !flowNoticeChecked) return;
    setPending('accept-notice');
    setGateError('');
    try {
      const result = await window.clips.acceptFlowNotice();
      if (!result.ok) setGateError(result.error.message);
      else await load();
    } catch { setGateError(t('error.storage')); }
    finally { setPending(''); }
  }, [flowNoticeChecked, load, t]);

  const connectFlow = useCallback(async () => {
    if (!window.clips) return;
    setPending('flow');
    setGateError('');
    try {
      const result = await window.clips.connectFlow();
      if (result.ok) {
        setSnapshot((current) => current ? { ...current, capabilities: result.data } : current);
        announce(translate(locale, 'account.connectedToast'));
        if (!localStorage.getItem('clips-onboarding-complete')) setOnboardingStep(0);
      } else { setGateError(result.error.message); announce(result.error.message, 'error'); }
    } catch {
      setGateError(translate(locale, 'startup.loginError'));
      announce(translate(locale, 'error.provider'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

  const addFlowAccount = useCallback(async () => {
    if (!window.clips) return;
    setPending('add-flow-account');
    setGateError('');
    try {
      const result = await window.clips.addFlowAccount();
      if (result.ok) {
        await load();
        announce(translate(locale, 'account.connectedToast'));
      } else {
        setGateError(result.error.message);
        announce(result.error.message, 'error');
      }
    } catch {
      setGateError(translate(locale, 'startup.loginError'));
    } finally {
      setPending('');
    }
  }, [announce, load, locale]);

  const selectFlowAccount = useCallback(async (accountId: string) => {
    if (!window.clips) return;
    setPending('select-flow-account');
    setGateError('');
    try {
      const result = await window.clips.selectFlowAccount(accountId);
      if (result.ok) await load();
      else setGateError(result.error.message);
    } catch {
      setGateError(translate(locale, 'error.provider'));
    } finally {
      setPending('');
    }
  }, [load, locale]);

  const logoutFlow = useCallback(async () => {
    if (!window.clips) return;
    setPending('logout-flow');
    setGateError('');
    try {
      const result = await window.clips.logoutFlow();
      if (result.ok) await load();
      else setGateError(result.error.message);
    } catch {
      setGateError(translate(locale, 'error.provider'));
    } finally {
      setPending('');
    }
  }, [load, locale]);

  const finishWelcome = useCallback(() => {
    localStorage.setItem('clips-welcome-complete', 'true');
    setWelcomeStep(null);
  }, []);

  const finishOnboarding = useCallback(() => {
    localStorage.setItem('clips-onboarding-complete', 'true');
    setOnboardingStep(null);
  }, []);



  useEffect(() => {
    document.documentElement.classList.toggle('is-windows', /Windows/i.test(navigator.userAgent));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onboardingStep !== null) {
        event.preventDefault();
        finishOnboarding();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finishOnboarding, onboardingStep]);

  const titleKey: TranslationKey = view === 'settings' ? 'header.settings' : view === 'profile' ? 'header.profile' : `header.${view}` as TranslationKey;

  if (!snapshot) return <div className="boot-screen"><div className="boot-mark"><Clapperboard size={30} strokeWidth={2.4} aria-hidden="true" /></div><p>{loadError ? t('app.unavailable') : t('app.loading')}</p>{loadError ? <Button onClick={() => void load()}>{t('app.retry')}</Button> : <span className="loading-rule" aria-hidden="true" />}</div>;

  if (welcomeStep !== null) return <Onboarding step={welcomeStep} locale={locale} onStep={setWelcomeStep} onDone={finishWelcome} onLocale={(value) => void setLocale(value)} t={t} />;
  if (!snapshot.flowNoticeAccepted) return <TermsGate checked={flowNoticeChecked} error={gateError} busy={pending === 'accept-notice'} onChecked={setFlowNoticeChecked} onAccept={() => void acceptFlowNotice()} t={t} />;
  if (snapshot.capabilities.provider === 'google-flow' && snapshot.capabilities.status !== 'ready') return <FlowSignInGate snapshot={snapshot} status={snapshot.capabilities.status} detail={snapshot.capabilities.detail} error={gateError} busy={Boolean(pending)} onConnect={() => void connectFlow()} onAddAccount={() => void addFlowAccount()} onSelectAccount={(id) => void selectFlowAccount(id)} t={t} />;
  if (snapshot.capabilities.provider === 'google-flow' && onboardingStep === null && typeof window !== 'undefined' && !localStorage.getItem('clips-onboarding-complete')) return <Onboarding step={0} locale={locale} onStep={setOnboardingStep} onDone={finishOnboarding} onLocale={(value) => void setLocale(value)} t={t} />;
  if (snapshot.capabilities.provider === 'mock' && onboardingStep === null && typeof window !== 'undefined' && !localStorage.getItem('clips-onboarding-complete')) return <FlowSignInGate snapshot={snapshot} status="mock-ready" detail={snapshot.capabilities.detail} error={gateError} busy={false} onConnect={() => { setOnboardingStep(0); }} onAddAccount={() => undefined} onSelectAccount={() => undefined} t={t} />;

  const activeAccount = snapshot.accounts.find((account) => account.id === snapshot.settings.activeAccountId) ?? null;
  const currentDraft = drafts?.[createMode] ?? snapshot.settings.drafts[createMode];
  const selectedAsset = snapshot.assets.find((asset) => asset.id === selectedAssetId && !asset.deletedAt) ?? null;
  const currentView = view === 'create'
    ? <CreatorCanvas snapshot={snapshot} mode={createMode} selectedAssetId={selectedAssetId} t={t} onSelect={(asset) => setSelectedAssetId(asset.id)} onOpenLibrary={() => setView('library')} onUseReference={useAsReference} onUseVideoSource={useAsVideoSource} onInspect={(asset) => setSelectedAssetId(asset.id)} />
    : view === 'settings'
      ? <SettingsWorkspace snapshot={snapshot} onLocale={(value) => void setLocale(value)} onSettings={(patch) => void updateSettings(patch)} onReplayTutorial={() => setOnboardingStep(0)} onOpenDataFolder={() => void openDataFolder()} busy={Boolean(pending)} t={t} />
      : view === 'profile'
        ? <AccountsWorkspace snapshot={snapshot} onConnectFlow={() => void connectFlow()} onAddAccount={() => void addFlowAccount()} onSelectAccount={(id) => void selectFlowAccount(id)} onLogout={() => void logoutFlow()} busy={Boolean(pending)} t={t} />
        : view === 'characters'
          ? <CharactersWorkspace characters={snapshot.characters} assets={snapshot.assets} locale={locale} t={t} busy={Boolean(pending)} onSave={saveCharacter} onDelete={(character) => setDeleteCharacter(character)} onCreateImage={createWithCharacter} />
          : view === 'queue'
            ? <QueueWorkspace snapshot={snapshot} busyJobId={pending.startsWith('job:') ? pending.slice(4) : null} t={t} onCreate={() => setView('create')} onRetry={(job) => void retryGenerationJob(job)} onCancel={(job) => void cancelGenerationJob(job)} onReuse={reuseJobSettings} onSelectAsset={(asset) => setSelectedAssetId(asset.id)} />
            : <LibraryWorkspace snapshot={snapshot} kind={libraryKind} locale={locale} t={t} busy={Boolean(pending)} onKind={setLibraryKind} onImport={() => void importFiles()} onPaste={() => void pasteClipboardImage()} onDrop={(files) => void importDroppedFiles(files)} onReveal={(asset) => void revealAsset(asset)} onDelete={(asset) => void removeAsset(asset)} onUseReference={useAsReference} onUseVideoSource={useAsVideoSource} onAssign={(assetIds, characterId) => void assignAssets(assetIds, characterId)} />;

  return (
    <div className={`app-shell ${view === 'create' ? 'has-composer' : ''} ${selectedAsset ? 'has-inspector' : ''}`}>
      <TooltipLayer />
      <a className="skip-link" href="#workspace-content">{t('accessibility.skipToContent')}</a>
      <nav className="navigation-rail" aria-label={t('accessibility.primaryNavigation')}>
        <button className="brand-mark" type="button" aria-label={t('app.name')} onClick={() => setView('create')}><Clapperboard size={26} strokeWidth={2.4} aria-hidden="true" /></button>
        <div className="rail-nav">
          {navDefinition.map(({ view: itemView, key, icon: Icon }) => <button key={itemView} type="button" className={`rail-nav-item tooltip-trigger ${view === itemView ? 'is-active' : ''}`} aria-label={t(key)} aria-current={view === itemView ? 'page' : undefined} data-tooltip={t(key)} onClick={() => setView(itemView)}>
            <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>)}
        </div>
        <div className="rail-footer">
          <IconButton label={t('nav.settings')} icon={Settings2} active={view === 'settings'} onClick={() => setView('settings')} />
        </div>
      </nav>

      {view === 'create' ? <aside className="phase-one-panel creator-side-panel">
        <div className="phase-panel-brand"><span className="brand-wordmark">{t('app.name')}</span><span className="local-mark">{t(snapshot.capabilities.provider === 'mock' ? 'header.sampleMode' : 'account.flowTitle')}</span></div>
        <CreatorPanel snapshot={snapshot} mode={createMode} draft={currentDraft} busy={pending === 'generation'} t={t} onMode={setCreateMode} onDraft={(patch) => updateDraft(createMode, patch)} onImport={() => void importReferences()} onPaste={() => void pasteReference()} onDrop={(files) => void dropReferences(files)} onCreate={() => void createGeneration()} onCharacters={() => setView('characters')} onConnectFlow={() => snapshot.capabilities.status === 'unavailable' ? setView('profile') : void connectFlow()} />
      </aside> : null}

      <section className="main-column">
        <header className="workspace-toolbar">
          <div className="workspace-toolbar-title"><span className="toolbar-context-line" /><h1>{t(titleKey)}</h1></div>
          <div className="toolbar-actions">
            <button type="button" className={`toolbar-account ${view === 'profile' ? 'is-current' : ''}`} onClick={() => setView('profile')} aria-label={t('nav.profile')}><UserRound size={17} strokeWidth={1.7} /><span>{activeAccount?.provider === 'mock' ? t('account.localTitle') : activeAccount?.label ?? t('common.noAccount')}</span></button>
          </div>
        </header>
        <div key={`${view}-${createMode}`} className="workspace-route">{currentView}</div>
      </section>

      {selectedAsset ? <aside className="context-panel context-work-panel">
        <div className="context-panel-heading"><span className="context-overline">{t('library.inspector')}</span><span className="context-heading-line" /></div>
        <AssetDetails asset={selectedAsset} snapshot={snapshot} t={t} onDelete={(asset) => void removeAsset(asset)} onReveal={(asset) => void revealAsset(asset)} onUseReference={useAsReference} onUseVideoSource={useAsVideoSource} />
      </aside> : null}

      {notice ? <div key={notice.id} className={`toast ${notice.tone === 'error' ? 'toast-error' : ''}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}>
        <span className="toast-indicator" aria-hidden="true" />
        <span>{notice.message}</span>
        {notice.action ? <button type="button" onClick={() => { notice.action?.run(); setNotice(null); }}>{notice.action.label}</button> : null}
        <IconButton label={t('common.close')} icon={X} size="small" onClick={() => setNotice(null)} />
      </div> : null}

      {onboardingStep !== null ? <Onboarding step={onboardingStep} locale={locale} onStep={setOnboardingStep} onDone={finishOnboarding} onLocale={(value) => void setLocale(value)} t={t} /> : null}

      {deleteCharacter ? <Modal title={t('character.deleteTitle')} description={t('character.deleteBody')} onClose={() => setDeleteCharacter(null)} closeLabel={t('common.close')} footer={<><Button onClick={() => setDeleteCharacter(null)}>{t('common.cancel')}</Button><Button variant="danger" busy={pending === deleteCharacter.id} onClick={() => void confirmDeleteCharacter()}>{t('common.delete')}</Button></>}><p className="remove-account-label">{deleteCharacter.name}</p></Modal> : null}
      {importIssues ? <Modal title={t('modal.importIssues')} description={t('modal.importIssuesHint')} onClose={() => setImportIssues(null)} closeLabel={t('common.close')}><ul className="import-issues-list">{importIssues.map((issue, index) => <li key={`${issue.name}-${index}`}><strong>{issue.name}</strong><span>{issue.message}</span></li>)}</ul><div className="import-issues-footer"><Button variant="primary" onClick={() => setImportIssues(null)}>{t('common.done')}</Button></div></Modal> : null}
    </div>
  );
}

function TermsGate({ checked, error, busy, onChecked, onAccept, t }: {
  checked: boolean; error: string; busy: boolean; onChecked: (checked: boolean) => void; onAccept: () => void; t: Translate;
}) {
  const legalLinks = [
    ['google-terms', 'startup.googleTerms'],
    ['flow-terms', 'startup.flowTerms'],
    ['gflow-disclaimer', 'startup.connectorDisclaimer'],
  ] as const;
  return <div className="startup-screen"><Modal title={t('startup.termsTitle')} description={t('startup.termsBody')} onClose={() => undefined} closeLabel={t('common.close')} dismissible={false} wide className="startup-gate" draggableTitlebar focusSurface footer={<div className="startup-footer"><span>{t('startup.required')}</span><Button variant="primary" icon={ShieldCheck} busy={busy} disabled={!checked} onClick={onAccept}>{t('startup.continueToLogin')}</Button></div>}>
    <div className="startup-legal-links">{legalLinks.map(([link, key]) => <button type="button" key={link} onClick={() => void window.clips?.openLegalLink(link)}>{t(key)}<ExternalLink size={13} aria-hidden="true" /></button>)}</div>
    <label className="startup-consent"><input type="checkbox" checked={checked} onChange={(event) => onChecked(event.currentTarget.checked)} /><span>{t('startup.termsCheckbox')}</span></label>
    <p className="startup-legal-limit">{t('startup.legalNote')}</p>
    {error ? <p className="startup-error" role="alert">{error}</p> : null}
  </Modal></div>;
}

function FlowSignInGate({ snapshot, status, detail, error, busy, onConnect, onAddAccount, onSelectAccount, t }: {
  snapshot: AppSnapshot;
  status: AppSnapshot['capabilities']['status'];
  detail: string;
  error: string;
  busy: boolean;
  onConnect: () => void;
  onAddAccount: () => void;
  onSelectAccount: (accountId: string) => void;
  t: Translate;
}) {
  const local = status === 'mock-ready';
  const accounts = snapshot.accounts.filter((item) => item.provider === 'google-flow');
  const activeAccount = accounts.find((item) => item.id === snapshot.settings.activeAccountId);
  return <div className="startup-screen"><Modal title={t('startup.loginTitle')} description={t('startup.loginBody')} onClose={() => undefined} closeLabel={t('common.close')} dismissible={false} wide className="startup-gate startup-login" draggableTitlebar focusSurface footer={<div className="startup-footer"><span>{busy ? t('startup.loginBusy') : t('startup.loginPrivacy')}</span><Button variant="primary" busy={busy && status !== 'checking'} disabled={busy || status === 'checking'} onClick={onConnect}>{t(local ? 'startup.localAction' : activeAccount ? 'startup.loginSavedAccount' : 'startup.loginAction')}</Button></div>}>
    <div className="startup-login-card"><span className="startup-login-icon"><UserRound size={24} strokeWidth={1.7} aria-hidden="true" /></span><div><strong>{local ? t('account.localTitle') : activeAccount?.label ?? t('account.flowTitle')}</strong><p>{local ? detail : status === 'unavailable' ? detail || t('startup.loginError') : t('startup.loginPrivacy')}</p></div></div>
    {!local && accounts.length > 1 ? <div className="startup-account-options" aria-label={t('account.savedAccounts')}>
      {accounts.map((account) => {
        const active = account.id === snapshot.settings.activeAccountId;
        return <button type="button" className={`startup-account-option${active ? ' is-active' : ''}`} key={account.id} disabled={busy || active} onClick={() => onSelectAccount(account.id)}>
          <span>{account.label}</span><small>{t(active ? 'account.activeAccount' : account.connection === 'connected' ? 'account.statusReady' : 'account.statusNeedsLogin')}</small>
        </button>;
      })}
    </div> : null}
    {!local && activeAccount ? <Button className="startup-switch-account" size="small" icon={UserRound} disabled={busy} onClick={onAddAccount}>{t('startup.useAnotherAccount')}</Button> : null}
    {error ? <p className="startup-error" role="alert">{error}</p> : null}
  </Modal></div>;
}

function Onboarding({ step, locale, onStep, onDone, onLocale, t }: {
  step: number;
  locale: Locale;
  onStep: (step: number) => void;
  onDone: () => void;
  onLocale: (locale: Locale) => void;
  t: Translate;
}) {
  const titles: TranslationKey[] = ['onboarding.welcomeTitle', 'onboarding.flowTitle', 'onboarding.localTitle', 'onboarding.readyTitle'];
  const bodies: TranslationKey[] = ['onboarding.welcomeBody', 'onboarding.flowBody', 'onboarding.localBody', 'onboarding.readyBody'];
  const current = Math.max(0, Math.min(3, step));
  const previous = useCallback(() => onStep(Math.max(0, current - 1)), [current, onStep]);
  const next = useCallback(() => current >= 3 ? onDone() : onStep(current + 1), [current, onDone, onStep]);
  useEffect(() => {
    document.documentElement.classList.toggle('is-windows', /Windows/i.test(navigator.userAgent));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
      if (event.key === 'ArrowLeft' && current > 0) { event.preventDefault(); previous(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, next, previous]);
  return (
    <Modal title={t(titles[current])} description={t(bodies[current])} onClose={onDone} closeLabel={t('common.close')} wide labelledBy="onboarding-title" className="onboarding-modal" transitionKey={current} draggableTitlebar focusSurface footer={
      <div className="onboarding-footer">
        <div className="onboarding-language"><span>{t('onboarding.language')}</span><MenuSelect label={t('onboarding.language')} value={locale} options={[{ value: 'en', label: t('settings.english') }, { value: 'de', label: t('settings.german') }]} onChange={(value) => onLocale(value as Locale)} /></div>
        <div className="onboarding-steps" aria-label={`${current + 1} / 4`}>{[0, 1, 2, 3].map((index) => <button key={index} type="button" className={index === current ? 'is-current' : index < current ? 'is-complete' : ''} aria-label={t('onboarding.goToStep', { count: index + 1 })} onClick={() => onStep(index)} />)}</div>
        <div className="onboarding-actions">
          {current > 0 ? <Button size="small" onClick={previous}>{t('common.back')}</Button> : <button type="button" className="onboarding-skip" onClick={onDone}>{t('common.skip')}</button>}
          <Button variant="primary" size="small" onClick={next}>{current === 3 ? t('onboarding.start') : t('common.continue')}</Button>
        </div>
      </div>
    }>
      <div key={current} className={`onboarding-visual onboarding-visual-${current}`}>
        {current === 0 ? <div className="onboarding-flow-map"><StepMark icon={Users} label={t('onboarding.characters')} /><span /><StepMark icon={Images} label={t('onboarding.images')} /><span /><StepMark icon={Clapperboard} label={t('onboarding.video')} /></div>
          : current === 1 ? <div className="onboarding-account-visual"><span className="onboarding-google-mark"><UserRound size={22} aria-hidden="true" /></span><div><strong>Google Flow</strong><span>{t('account.connect')}</span></div><span className="onboarding-account-rule" /></div>
            : current === 2 ? <div className="onboarding-library-visual"><div className="onboarding-reference-tile"><span /><span /><span /></div><div className="onboarding-reference-tile landscape"><span /><span /></div><div className="onboarding-reference-tile portrait"><span /><span /><span /></div></div>
              : <div className="onboarding-ready-visual"><span className="ready-mark"><Sparkles size={24} strokeWidth={1.4} /></span><span className="ready-rail" /><span className="ready-rail short" /></div>}
      </div>
    </Modal>
  );
}

function StepMark({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return <div className="onboarding-step-mark"><span><Icon size={19} strokeWidth={1.5} aria-hidden="true" /></span><strong>{label}</strong></div>;
}
