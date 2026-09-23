'use client';

import { useEffect, useState } from 'react';
import { Check, FolderOpen, Info, LogOut, Plus, UserRound } from 'lucide-react';
import type { AppSnapshot, SettingsPatch, StorageSummary } from '@/shared/contracts';
import type { Translate } from '@/lib/app-types';
import { Button, MenuSelect } from '@/components/ui';
import { fileSize } from '@/lib/i18n';

export function SettingsWorkspace({ snapshot, onLocale, onSettings, onReplayTutorial, onOpenDataFolder, busy, t }: {
  snapshot: AppSnapshot;
  onLocale: (locale: 'en' | 'de') => void;
  onSettings: (patch: SettingsPatch) => void;
  onReplayTutorial: () => void;
  onOpenDataFolder: () => void;
  busy: boolean;
  t: Translate;
}) {
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  useEffect(() => {
    let mounted = true;
    void window.clips?.getStorageSummary().then((result) => {
      if (!mounted) return;
      if (result.ok) setStorage(result.data);
      else setStorageUnavailable(true);
    }).catch(() => { if (mounted) setStorageUnavailable(true); });
    return () => { mounted = false; };
  }, []);
  const imageModels = snapshot.capabilities.models.filter((model) => model.kind === 'image');
  const videoModels = snapshot.capabilities.models.filter((model) => model.kind === 'video');
  const maxOutputs = snapshot.capabilities.provider === 'google-flow' ? 4 : 6;
  return (
    <main className="workspace-content settings-workspace" id="workspace-content" tabIndex={-1}>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.general')}</h2></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.language')}</h3><p>{t('settings.languageHint')}</p></div><MenuSelect className="setting-select" label={t('settings.language')} value={snapshot.settings.locale} options={[{ value: 'en', label: t('settings.english') }, { value: 'de', label: t('settings.german') }]} onChange={(value) => onLocale(value as 'en' | 'de')} /></div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.generation')}</h2><p>{snapshot.capabilities.detail}</p></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.imageModel')}</h3></div><MenuSelect className="setting-select" value={snapshot.settings.imageModelId} label={t('settings.imageModel')} options={imageModels.map((model) => ({ value: model.id, label: model.label }))} disabled={!imageModels.length} onChange={(value) => onSettings({ imageModelId: value })} /></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.videoModel')}</h3></div><MenuSelect className="setting-select" value={snapshot.settings.videoModelId} label={t('settings.videoModel')} options={videoModels.map((model) => ({ value: model.id, label: model.label }))} disabled={!videoModels.length} onChange={(value) => onSettings({ videoModelId: value })} /></div>
        <div className="setting-row setting-row-stack"><div className="setting-row-copy"><h3>{t('settings.imageRatio')}</h3></div><RatioOptions value={snapshot.settings.imageAspectRatio} options={snapshot.capabilities.imageAspectRatios} label={t('settings.imageRatio')} onChange={(value) => onSettings({ imageAspectRatio: value })} /></div>
        <div className="setting-row setting-row-stack"><div className="setting-row-copy"><h3>{t('settings.videoRatio')}</h3></div><RatioOptions value={snapshot.settings.videoAspectRatio} options={snapshot.capabilities.videoAspectRatios} label={t('settings.videoRatio')} onChange={(value) => onSettings({ videoAspectRatio: value })} /></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.outputCount')}</h3></div><MenuSelect className="setting-select" value={String(snapshot.settings.outputCount)} label={t('settings.outputCount')} options={Array.from({ length: maxOutputs }, (_, index) => ({ value: String(index + 1), label: new Intl.NumberFormat(snapshot.settings.locale).format(index + 1) }))} onChange={(value) => onSettings({ outputCount: Number(value) })} /></div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.storage')}</h2></div>
        <p className="settings-explainer">{t('settings.storageHint')}</p>
        <p className="location-note tooltip-trigger" data-testid="storage-directory" data-tooltip={storage?.directory ?? undefined}><FolderOpen size={15} aria-hidden="true" /><span>{storage?.directory ?? t(storageUnavailable ? 'settings.storageUnavailable' : 'settings.storageLoading')}</span></p>
        <div className="storage-metrics" aria-label={t('settings.storageUsage')}>
          <div><span>{t('settings.mediaFiles')}</span><strong>{storage ? `${new Intl.NumberFormat(snapshot.settings.locale).format(storage.mediaFiles)} · ${fileSize(snapshot.settings.locale, storage.mediaBytes)}` : '—'}</strong></div>
          <div><span>{t('settings.databaseSize')}</span><strong>{storage ? fileSize(snapshot.settings.locale, storage.databaseBytes) : '—'}</strong></div>
        </div>
        <Button size="small" icon={FolderOpen} disabled={busy || !storage} onClick={onOpenDataFolder}>{t('settings.openDataFolder')}</Button>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.appearance')}</h2></div><p className="settings-explainer">{t('settings.appearanceHint')}</p>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.shortcuts')}</h2></div>
        <div className="shortcut-list"><Shortcut label={t('settings.shortcutSettings')} keys="Ctrl / ⌘ ," /><Shortcut label={t('settings.shortcutEscape')} keys="Esc" /></div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.tutorial')}</h2></div><div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.tutorial')}</h3><p>{t('settings.tutorialHint')}</p></div><Button onClick={onReplayTutorial}>{t('settings.replay')}</Button></div>
      </section>
      <section className="settings-section settings-about">
        <div className="settings-section-heading"><h2>{t('settings.about')}</h2></div>
        <div className="about-line"><strong>{t('app.name')}</strong><span>{t('settings.version')}</span></div>
        <div className="about-line"><span>{t('settings.license')}</span><span>{t('settings.copyright')}</span></div>
      </section>
    </main>
  );
}

function RatioOptions({ value, options, label, onChange }: { value: string; options: string[]; label: string; onChange: (value: string) => void }) {
  return <div className="ratio-options settings-ratios" role="group" aria-label={label}>{options.map((ratio) => <button key={ratio} type="button" className={value === ratio ? 'is-selected' : ''} aria-pressed={value === ratio} onClick={() => onChange(ratio)}>{ratio}</button>)}</div>;
}

export function AccountsWorkspace({ snapshot, onConnectFlow, onAddAccount, onSelectAccount, onLogout, busy, t }: {
  snapshot: AppSnapshot;
  onConnectFlow: () => void;
  onAddAccount: () => void;
  onSelectAccount: (accountId: string) => void;
  onLogout: () => void;
  busy: boolean;
  t: Translate;
}) {
  const status = snapshot.capabilities.status;
  const isLocal = snapshot.capabilities.provider === 'mock';
  const accounts = snapshot.accounts.filter((item) => item.provider === 'google-flow');
  const account = accounts.find((item) => item.id === snapshot.settings.activeAccountId);
  const statusKey = status === 'ready' ? 'account.statusReady'
    : status === 'checking' ? 'account.statusChecking'
      : status === 'unavailable' ? 'account.statusUnavailable'
        : status === 'mock-ready' ? 'account.statusLocal' : 'account.statusNeedsLogin';
  return (
    <main className="workspace-content accounts-workspace" id="workspace-content" tabIndex={-1}>
      <section className={`flow-account-card ${status === 'ready' ? 'is-connected' : ''}`}>
        <div className="flow-account-mark" aria-hidden="true"><UserRound size={22} strokeWidth={1.6} /></div>
        <div className="flow-account-copy">
          <span className="account-overline">{t('account.flowTitle')}</span>
          <h2>{status === 'ready' ? account?.label ?? t('account.flowTitle') : t(statusKey)}</h2>
          <p>{t(isLocal ? 'account.localBody' : status === 'unavailable' ? 'account.installBody' : status === 'ready' ? 'account.connectedBody' : 'account.flowBody')}</p>
        </div>
        <span className={`account-status-mark status-${status}`} aria-hidden="true" />
        {!isLocal ? <Button variant="primary" busy={busy && status !== 'ready'} disabled={busy || status === 'checking'} onClick={onConnectFlow}>{t(status === 'ready' ? 'account.reconnect' : status === 'unavailable' ? 'account.checkInstall' : 'account.connect')}</Button> : null}
      </section>
      {!isLocal ? <section className="flow-saved-accounts" aria-labelledby="saved-accounts-title">
        <div className="flow-saved-accounts-heading"><div><h3 id="saved-accounts-title">{t('account.savedAccounts')}</h3><p>{t('account.savedAccountsHint')}</p></div></div>
        {accounts.map((item) => {
          const active = item.id === snapshot.settings.activeAccountId;
          const connected = active ? status === 'ready' : item.connection === 'connected';
          return <div className={`flow-account-row${active ? ' is-active' : ''}`} key={item.id}>
            <span className={`flow-account-row-mark${connected ? ' is-connected' : ''}`} aria-hidden="true"><UserRound size={17} /></span>
            <div className="flow-account-row-copy"><strong>{item.label}</strong><span>{t(connected ? 'account.statusReady' : active ? statusKey : 'account.statusNeedsLogin')}</span></div>
            <div className="flow-account-row-actions">
              <Button size="small" variant={active ? 'secondary' : 'quiet'} icon={active ? Check : undefined} disabled={busy || active} onClick={() => onSelectAccount(item.id)}>{t(active ? 'account.activeAccount' : 'account.useAccount')}</Button>
              {active && status === 'ready' ? <Button size="small" icon={LogOut} disabled={busy} onClick={onLogout}>{t('account.logout')}</Button> : null}
            </div>
          </div>;
        })}
        <Button icon={Plus} disabled={busy} onClick={onAddAccount}>{t('account.addAccount')}</Button>
      </section> : null}
      {status === 'unavailable' && !isLocal ? <section className="gflow-install-panel">
        <h3>{t('account.installTitle')}</h3>
        <p>{snapshot.capabilities.detail}</p>
        <p className="account-boundary-note"><Info size={15} aria-hidden="true" />{t('account.installFootnote')}</p>
      </section> : null}
      <section className="account-privacy-note"><Info size={16} aria-hidden="true" /><p>{t(isLocal ? 'account.testProviderNote' : 'account.flowBoundary')}</p></section>
    </main>
  );
}

function Shortcut({ label, keys }: { label: string; keys: string }) {
  return <div className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>;
}
