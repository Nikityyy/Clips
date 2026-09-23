'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, Clapperboard, Film, FolderClosed, Images, Settings2, Sparkles, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';
import type { AppSnapshot, ErrorCode, Locale, ProviderAccount, SettingsPatch } from '@/shared/contracts';
import type { Notice, Translate, View } from '@/lib/app-types';
import { translate, type TranslationKey } from '@/lib/i18n';
import { AccountsWorkspace, PhaseWorkspace, SettingsWorkspace, StudioLanding } from '@/components/Workspace';
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
        announce(translate(locale, 'settings.saved'));
      } else announce(translate(locale, errorCopy[result.error.code]), 'error');
    } catch {
      announce(translate(locale, 'settings.saveError'), 'error');
    } finally {
      setPending('');
    }
  }, [announce, locale]);

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
  const currentView = view === 'create' ? <StudioLanding snapshot={snapshot} t={t} onOpenFlow={() => void openFlow()} />
    : view === 'settings' ? <SettingsWorkspace snapshot={snapshot} onLocale={(value) => void setLocale(value)} onSettings={(patch) => void updateSettings(patch)} onReplayTutorial={() => setOnboardingStep(0)} t={t} />
      : view === 'profile' ? <AccountsWorkspace snapshot={snapshot} onOpenFlow={() => void openFlow()} onAddLabel={(label) => void addAccountLabel(label)} onSwitch={(id) => void switchAccount(id)} onRemove={(id) => setRemoveAccount(snapshot.accounts.find((account) => account.id === id) ?? null)} busy={Boolean(pending)} t={t} />
        : <PhaseWorkspace view={view} t={t} />;

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

      <aside className="phase-one-panel">
        <div className="phase-panel-brand"><span className="brand-wordmark">{t('app.name')}</span><span className="local-mark">{t('header.sampleMode')}</span></div>
        <div className="phase-panel-content">
          {view === 'settings' ? <><h2>{t('settings.title')}</h2><p>{t('settings.languageHint')}</p><div className="panel-rail-line" /><p>{t('settings.storageLocation')}</p></>
            : view === 'profile' ? <><h2>{t('account.title')}</h2><p>{t('account.flowBoundary')}</p><div className="panel-rail-line" /><Button variant="quiet" icon={Settings2} onClick={() => setView('settings')}>{t('nav.settings')}</Button></>
              : <><h2>{t('workspace.sideTitle')}</h2><p>{t('workspace.sideBody')}</p><div className="side-process-list"><span><i />{t('onboarding.characters')}</span><span><i />{t('onboarding.images')}</span><span><i />{t('onboarding.video')}</span></div><div className="panel-rail-line" /><p className="side-footnote">{t('workspace.localPromise')}</p></>}
        </div>
        <div className="phase-panel-footer"><span className="footer-key-mark">⌘</span><span>{t('settings.version')}</span></div>
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

      <aside className="context-panel">
        <div className="context-panel-heading"><span className="context-overline">{t('account.profile')}</span><span className="context-heading-line" /></div>
        <div className="context-account-mark"><UserRound size={20} strokeWidth={1.5} aria-hidden="true" /></div>
        <h2>{activeAccount?.provider === 'mock' ? t('account.localTitle') : activeAccount?.label ?? t('account.accountUnavailable')}</h2>
        <p>{activeAccount?.provider === 'mock' ? t('account.localBody') : t('account.flowBody')}</p>
        <div className="context-separator"><span className="context-separator-line" /><span>{t('account.credits')}</span></div>
        <p className="credits-unavailable">{t('account.creditsUnavailable')}</p>
        <div className="context-actions"><Button variant="primary" icon={ArrowUpRight} busy={pending === 'flow'} onClick={() => void openFlow()}>{t('account.openFlow')}</Button><Button variant="quiet" onClick={() => setView('profile')}>{t('account.title')}</Button></div>
        <div className="context-footer"><span className="context-footer-line" /><p>{t('create.localOnly')}</p></div>
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
