'use client';

import { useEffect, useRef, useState } from 'react';
import type { Translate } from '@/lib/app-types';
import type { TranslationKey } from '@/lib/i18n';

const steps: { target: string; title: TranslationKey; body: TranslationKey }[] = [
  { target: 'prompt', title: 'tour.promptTitle', body: 'tour.promptBody' },
  { target: 'references', title: 'tour.referencesTitle', body: 'tour.referencesBody' },
  { target: 'options', title: 'tour.optionsTitle', body: 'tour.optionsBody' },
  { target: 'characters', title: 'tour.charactersTitle', body: 'tour.charactersBody' },
  { target: 'library', title: 'tour.libraryTitle', body: 'tour.libraryBody' },
];

type Bounds = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export function GuidedTour({ step, onStep, onDone, t }: { step: number; onStep: (step: number) => void; onDone: () => void; t: Translate }) {
  const current = Math.max(0, Math.min(steps.length - 1, step));
  const definition = steps[current];
  const targetRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [cardPosition, setCardPosition] = useState({ top: 24, left: 24 });

  useEffect(() => {
    const findTarget = () => {
      const element = document.querySelector<HTMLElement>(`[data-tour="${definition.target}"]`);
      if (!element) {
        targetRef.current = null;
        setBounds(null);
        return;
      }
      targetRef.current = element;
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      const measure = () => {
        const rect = element.getBoundingClientRect();
        const padding = 7;
        const nextBounds = {
          top: Math.max(0, rect.top - padding),
          left: Math.max(0, rect.left - padding),
          right: Math.min(window.innerWidth, rect.right + padding),
          bottom: Math.min(window.innerHeight, rect.bottom + padding),
          width: Math.min(window.innerWidth, rect.right + padding) - Math.max(0, rect.left - padding),
          height: Math.min(window.innerHeight, rect.bottom + padding) - Math.max(0, rect.top - padding),
        };
        setBounds(nextBounds);
        const card = cardRef.current?.getBoundingClientRect();
        const cardWidth = card?.width ?? Math.min(340, window.innerWidth - 32);
        const cardHeight = card?.height ?? 190;
        const left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, nextBounds.left));
        const below = nextBounds.bottom + 16 + cardHeight <= window.innerHeight - 16;
        const top = below ? nextBounds.bottom + 16 : Math.max(16, nextBounds.top - cardHeight - 16);
        setCardPosition({ top, left });
      };
      requestAnimationFrame(measure);
      return measure;
    };
    let measure = findTarget();
    const onLayout = () => { measure?.(); };
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    const observer = new ResizeObserver(onLayout);
    if (targetRef.current) observer.observe(targetRef.current);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
      observer.disconnect();
    };
  }, [definition.target]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDone();
        return;
      }
      if (event.key !== 'Tab') return;
      const targetControls = targetRef.current ? [...targetRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')] : [];
      const cardControls = cardRef.current ? [...cardRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')] : [];
      const controls = [...targetControls, ...cardControls];
      if (!controls.length) { event.preventDefault(); return; }
      const index = controls.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index < 0 || index === controls.length - 1 ? 0 : index + 1);
      event.preventDefault();
      controls[next]?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onDone]);

  const next = () => current === steps.length - 1 ? onDone() : onStep(current + 1);
  const previous = () => onStep(Math.max(0, current - 1));
  const panes = bounds ? [
    { top: 0, left: 0, width: '100vw', height: bounds.top },
    { top: bounds.top, left: 0, width: bounds.left, height: bounds.height },
    { top: bounds.top, left: bounds.right, width: `calc(100vw - ${bounds.right}px)`, height: bounds.height },
    { top: bounds.bottom, left: 0, width: '100vw', height: `calc(100vh - ${bounds.bottom}px)` },
  ] : [{ top: 0, left: 0, width: '100vw', height: '100vh' }];

  return <div className="guided-tour" data-testid="guided-tour">
    {panes.map((pane, index) => <div key={index} className="guided-tour-shade" aria-hidden="true" style={{ ...pane, bottom: undefined }} />)}
    {bounds ? <div className="guided-tour-spotlight" aria-hidden="true" style={{ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height }} /> : null}
    <section ref={cardRef} className="guided-tour-card" role="dialog" aria-modal="true" aria-labelledby="guided-tour-title" aria-describedby="guided-tour-body" style={{ top: cardPosition.top, left: cardPosition.left }}>
      <div className="guided-tour-progress"><span>{t('tour.progress', { current: current + 1, total: steps.length })}</span><button type="button" onClick={onDone}>{t('tour.skip')}</button></div>
      <h2 id="guided-tour-title">{t(definition.title)}</h2>
      <p id="guided-tour-body">{t(definition.body)}</p>
      <div className="guided-tour-actions">
        {current > 0 ? <button type="button" className="guided-tour-back" onClick={previous}>{t('tour.back')}</button> : <span />}
        <button type="button" className="guided-tour-next" onClick={next}>{t(current === steps.length - 1 ? 'tour.finish' : 'tour.next')}</button>
      </div>
    </section>
  </div>;
}
