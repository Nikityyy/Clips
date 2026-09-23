'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, FolderOpen, Info, UserRound } from 'lucide-react';
import type { AppSnapshot, SettingsPatch, StorageSummary } from '@/shared/contracts';
import type { Translate } from '@/lib/app-types';
import { Button, FieldLabel } from '@/components/ui';
import { fileSize } from '@/lib/i18n';

const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];

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
  const modelName = (id: string, label: string) => id === 'mock-image' ? t('model.portraitStudy') : id === 'mock-video' ? t('model.motionStudy') : label;
  return (
    <main className="workspace-content settings-workspace" id="workspace-content" tabIndex={-1}>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.general')}</h2></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.language')}</h3><p>{t('settings.languageHint')}</p></div><select className="select-control setting-select" value={snapshot.settings.locale} aria-label={t('settings.language')} onChange={(event) => onLocale(event.currentTarget.value as 'en' | 'de')}><option value="en">{t('settings.english')}</option><option value="de">{t('settings.german')}</option></select></div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.generation')}</h2></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.imageModel')}</h3></div><select className="select-control setting-select" value={snapshot.settings.imageModelId} aria-label={t('settings.imageModel')} onChange={(event) => onSettings({ imageModelId: event.currentTarget.value })}>{imageModels.map((model) => <option key={model.id} value={model.id}>{modelName(model.id, model.label)}</option>)}</select></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.videoModel')}</h3></div><select className="select-control setting-select" value={snapshot.settings.videoModelId} aria-label={t('settings.videoModel')} onChange={(event) => onSettings({ videoModelId: event.currentTarget.value })}>{videoModels.map((model) => <option key={model.id} value={model.id}>{modelName(model.id, model.label)}</option>)}</select></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.imageRatio')}</h3></div><RatioSelect value={snapshot.settings.imageAspectRatio} label={t('settings.imageRatio')} onChange={(value) => onSettings({ imageAspectRatio: value })} /></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.videoRatio')}</h3></div><RatioSelect value={snapshot.settings.videoAspectRatio} label={t('settings.videoRatio')} onChange={(value) => onSettings({ videoAspectRatio: value })} /></div>
        <div className="setting-row"><div className="setting-row-copy"><h3>{t('settings.outputCount')}</h3></div><select className="select-control setting-select" value={snapshot.settings.outputCount} aria-label={t('settings.outputCount')} onChange={(event) => onSettings({ outputCount: Number(event.currentTarget.value) })}>{[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{new Intl.NumberFormat(snapshot.settings.locale).format(count)}</option>)}</select></div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>{t('settings.storage')}</h2></div>
        <p className="settings-explainer">{t('settings.storageHint')}</p>
        <p className="location-note" data-testid="storage-directory" title={storage?.directory ?? undefined}><FolderOpen size={15} aria-hidden="true" /><span>{storage?.directory ?? t(storageUnavailable ? 'settings.storageUnavailable' : 'settings.storageLoading')}</span></p>
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

export function AccountsWorkspace({ snapshot, onOpenFlow, onAddLabel, onSwitch, onRemove, busy, t }: {
  snapshot: AppSnapshot;
  onOpenFlow: () => void;
  onAddLabel: (label: string) => void;
  onSwitch: (id: string) => void;
  onRemove: (accountId: string) => void;
  busy: boolean;
  t: Translate;
}) {
  const [label, setLabel] = useState('');
  return (
    <main className="workspace-content accounts-workspace" id="workspace-content" tabIndex={-1}>
      <section className="accounts-local-section">
        <div className="account-mark"><FolderOpen size={19} strokeWidth={1.5} /></div>
        <div><h2>{t('account.localTitle')}</h2><p>{t('account.localBody')}</p></div>
        <span className="local-state-line" aria-hidden="true" />
      </section>
      <section className="flow-connection-section">
        <div className="settings-section-heading"><h2>{t('account.flowTitle')}</h2></div>
        <p>{t('account.flowBody')}</p>
        <p className="account-boundary-note"><Info size={15} aria-hidden="true" />{t('account.flowBoundary')}</p>
        <Button variant="primary" icon={ArrowUpRight} onClick={onOpenFlow}>{t('account.openFlow')}</Button>
      </section>
      <section className="browser-label-section">
        <div className="settings-section-heading"><h2>{t('account.title')}</h2></div>
        <form className="account-label-form" onSubmit={(event) => { event.preventDefault(); if (label.trim()) { onAddLabel(label.trim()); setLabel(''); } }}>
          <div><FieldLabel htmlFor="account-label">{t('account.addLabel')}</FieldLabel><input id="account-label" className="text-input" maxLength={80} value={label} onChange={(event) => setLabel(event.currentTarget.value)} placeholder={t('account.labelHint')} /></div>
          <Button type="submit" disabled={!label.trim() || busy}>{t('account.addLabelButton')}</Button>
        </form>
        <p className="field-hint block-hint">{t('account.creditsUnavailable')}</p>
        <div className="account-list">
          {snapshot.accounts.map((account) => {
            const local = account.provider === 'mock';
            const active = snapshot.settings.activeAccountId === account.id;
            return <div key={account.id} className={`account-row ${active ? 'is-active' : ''}`}>
              <span className="account-provider-mark">{local ? <FolderOpen size={17} /> : <UserRound size={17} />}</span>
              <span className="account-copy"><strong>{local ? t('account.localTitle') : account.label}</strong><span>{local ? t('source.mock') : t('account.browserProfile')}</span></span>
              {active ? <span className="active-account-state">{t('account.active')}</span> : <Button size="small" onClick={() => onSwitch(account.id)} disabled={busy}>{t('account.switch')}</Button>}
              {!local ? <Button variant="quiet" size="small" onClick={() => onRemove(account.id)} disabled={busy}>{t('account.remove')}</Button> : null}
            </div>;
          })}
        </div>
      </section>
    </main>
  );
}

function RatioSelect({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  return <select className="select-control setting-select" value={value} aria-label={label} onChange={(event) => onChange(event.currentTarget.value)}>{ratios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select>;
}

function Shortcut({ label, keys }: { label: string; keys: string }) {
  return <div className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>;
}
