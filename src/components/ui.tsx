'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, LoaderCircle, X, Check, type LucideIcon } from 'lucide-react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'small' | 'normal';
  icon?: LucideIcon;
  busy?: boolean;
};

export function Button({ variant = 'secondary', size = 'normal', icon: Icon, busy, children, className = '', disabled, ...props }: ButtonProps) {
  const IconView = busy ? LoaderCircle : Icon;
  return (
    <button className={`button button-${variant} button-${size} ${className}`} disabled={disabled || busy} {...props}>
      {IconView ? <IconView size={size === 'small' ? 15 : 16} strokeWidth={1.8} className={busy ? 'spin' : undefined} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  size?: 'small' | 'normal';
};

export function IconButton({ label, icon: Icon, active, size = 'normal', className = '', ...props }: IconButtonProps) {
  return (
    <button className={`icon-button tooltip-trigger ${size === 'small' ? 'icon-button-small' : ''} ${active ? 'is-active' : ''} ${className}`} aria-label={label} data-tooltip={label} {...props}>
      <Icon size={size === 'small' ? 15 : 17} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

export function Modal({ title, description, onClose, children, footer, wide = false, labelledBy, closeLabel, className = '', transitionKey, dismissible = true }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  labelledBy?: string;
  closeLabel: string;
  className?: string;
  transitionKey?: string | number;
  dismissible?: boolean;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const modal = panel.current;
    if (!modal) return;
    if (!modal.open) modal.showModal();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus = panel.current?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')
      ?? panel.current?.querySelector<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])');
    if (initialFocus) initialFocus.focus();
    else panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (modal.open) modal.close();
      previous?.focus();
    };
  }, []);

  return (
    <dialog ref={panel} className="modal-scrim" aria-modal="true" aria-labelledby={labelledBy ?? 'dialog-title'} tabIndex={-1} onCancel={(event) => { event.preventDefault(); if (dismissible) onClose(); }}>
      <div className={`modal-panel ${wide ? 'modal-wide' : ''} ${className}`}>
        <header className="modal-header">
          <div key={transitionKey} className="min-width-zero">
            <h2 id={labelledBy ?? 'dialog-title'}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {dismissible ? <IconButton label={closeLabel} icon={X} onClick={onClose} /> : null}
        </header>
        <div className="modal-content">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

export function TooltipLayer() {
  const [tip, setTip] = useState<{ target: HTMLElement; label: string; x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const place = useCallback((target: HTMLElement, label: string) => {
    const bounds = target.getBoundingClientRect();
    const margin = 8;
    const likelyWidth = Math.min(250, window.innerWidth - margin * 2);
    const isRail = target.classList.contains('rail-nav-item');
    let side: 'top' | 'bottom' | 'left' | 'right' = 'top';
    let x = bounds.left + bounds.width / 2;
    let y = bounds.top - 9;
    if (isRail && bounds.right + likelyWidth + 18 <= window.innerWidth - margin) {
      side = 'right'; x = bounds.right + 10; y = bounds.top + bounds.height / 2;
    } else if (isRail && bounds.left - likelyWidth - 18 >= margin) {
      side = 'left'; x = bounds.left - 10; y = bounds.top + bounds.height / 2;
    } else if (bounds.top < 48) {
      side = 'bottom'; y = bounds.bottom + 9;
    }
    setTip({ target, label, x, y, side });
    target.setAttribute('aria-describedby', 'clips-tooltip');
  }, []);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (targetRef.current) targetRef.current.removeAttribute('aria-describedby');
    targetRef.current = null;
    setTip(null);
  }, []);
  useEffect(() => {
    const findTarget = (element: EventTarget | null) => element instanceof Element ? element.closest<HTMLElement>('[data-tooltip]') : null;
    const schedule = (target: HTMLElement | null) => {
      if (timer.current) clearTimeout(timer.current);
      if (!target?.dataset.tooltip) { dismiss(); return; }
      if (targetRef.current !== target) {
        if (targetRef.current) targetRef.current.removeAttribute('aria-describedby');
        targetRef.current = target;
        setTip(null);
      }
      const label = target.dataset.tooltip;
      timer.current = setTimeout(() => { if (targetRef.current === target) place(target, label); }, 140);
    };
    const onPointerOver = (event: PointerEvent) => schedule(findTarget(event.target));
    const onPointerOut = (event: PointerEvent) => {
      const current = findTarget(event.target);
      const next = findTarget(event.relatedTarget);
      if (current && current !== next && document.activeElement !== current) dismiss();
    };
    const onFocusIn = (event: FocusEvent) => schedule(findTarget(event.target));
    const onFocusOut = (event: FocusEvent) => {
      const current = findTarget(event.target);
      if (current && document.activeElement !== current) dismiss();
    };
    const onClick = () => dismiss();
    const reposition = () => { if (targetRef.current?.dataset.tooltip) place(targetRef.current, targetRef.current.dataset.tooltip); };
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('click', onClick);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('click', onClick);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [dismiss, place]);
  useLayoutEffect(() => {
    if (!tip || !tooltipRef.current) return;
    const bounds = tooltipRef.current.getBoundingClientRect();
    const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
    let x = tip.x;
    let y = tip.y;
    if (tip.side === 'right' && x + bounds.width > window.innerWidth - 8) { x = tip.target.getBoundingClientRect().left - 10; setTip({ ...tip, x, side: 'left' }); return; }
    if (tip.side === 'left' && x - bounds.width < 8) { x = tip.target.getBoundingClientRect().right + 10; setTip({ ...tip, x, side: 'right' }); return; }
    if (tip.side === 'top' && y - bounds.height < 8) { y = tip.target.getBoundingClientRect().bottom + 9; setTip({ ...tip, y, side: 'bottom' }); return; }
    const left = tip.side === 'right' ? x : tip.side === 'left' ? x - bounds.width : clamp(x - bounds.width / 2, 8, window.innerWidth - bounds.width - 8);
    const top = tip.side === 'top' ? y - bounds.height : tip.side === 'bottom' ? y : clamp(y - bounds.height / 2, 8, window.innerHeight - bounds.height - 8);
    tooltipRef.current.style.left = `${clamp(left, 8, window.innerWidth - bounds.width - 8)}px`;
    tooltipRef.current.style.top = `${clamp(top, 8, window.innerHeight - bounds.height - 8)}px`;
    tooltipRef.current.dataset.ready = 'true';
  }, [tip]);
  if (!tip || typeof document === 'undefined') return null;
  return createPortal(<div ref={tooltipRef} id="clips-tooltip" role="tooltip" className="clips-tooltip">{tip.label}</div>, document.body);
}

export interface MenuSelectOption {
  value: string;
  label: string;
  description?: string;
  imageUrl?: string;
}

export function MenuSelect({ value, options, label, onChange, className = '', disabled = false }: {
  value: string;
  options: MenuSelectOption[];
  label: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(Math.max(bounds.width, 210), window.innerWidth - 16);
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      const opensAbove = below < Math.min(260, options.length * 58) && above > below;
      const maxHeight = Math.max(120, Math.min(360, opensAbove ? above : below));
      const top = opensAbove ? Math.max(8, bounds.top - maxHeight - 6) : Math.min(window.innerHeight - maxHeight - 8, bounds.bottom + 6);
      setPosition({ top, left, width, maxHeight });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popover.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    updatePosition();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    requestAnimationFrame(() => popover.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, options.length]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!options.length) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    popover.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
  };

  const list = open && position ? <div
    ref={popover}
    className="menu-select-options"
    id={id}
    role="listbox"
    aria-label={label}
    style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
  >
    {options.map((option, index) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className="menu-select-option" onKeyDown={(event) => moveFocus(event, index)} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}>
      {option.imageUrl ? <img src={option.imageUrl} alt="" /> : <span className="menu-select-option-icon" aria-hidden="true">{option.value === value ? <Check size={14} /> : null}</span>}
      <span className="menu-select-copy"><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
      {option.value === value ? <Check className="menu-select-check" size={15} aria-hidden="true" /> : null}
    </button>)}
    {!options.length ? <p className="menu-select-empty">{label}</p> : null}
  </div> : null;

  return <div ref={root} className={`menu-select ${className} ${open ? 'is-open' : ''}`}>
    <button ref={trigger} type="button" className="menu-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={label} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => { if (!open) setPortalHost(root.current?.closest('dialog') ?? document.body); setOpen((current) => !current); }}>
      {selected?.imageUrl ? <img src={selected.imageUrl} alt="" /> : null}
      <span className="menu-select-copy"><strong>{selected?.label ?? label}</strong>{selected?.description ? <small>{selected.description}</small> : null}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {list ? createPortal(list, portalHost ?? document.body) : null}
  </div>;
}

export function SectionHeading({ title, action, children, className = '' }: { title: string; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`section-heading ${className}`}>
      <div className="section-heading-copy">
        <h2>{title}</h2>
        {children}
      </div>
      {action ? <div className="section-heading-action">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action, className = '' }: { icon?: LucideIcon; title: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`empty-state ${className}`}>
      {Icon ? <div className="empty-mark"><Icon size={22} strokeWidth={1.5} aria-hidden="true" /></div> : null}
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field-label-row">
      <label className="field-label" htmlFor={htmlFor}>{children}</label>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function QuietRule(props: HTMLAttributes<HTMLDivElement>) {
  return <div className="quiet-rule" {...props} />;
}
