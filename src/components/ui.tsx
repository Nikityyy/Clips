'use client';

import { useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle, X, type LucideIcon } from 'lucide-react';

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
    <button className={`icon-button ${size === 'small' ? 'icon-button-small' : ''} ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} {...props}>
      <Icon size={size === 'small' ? 15 : 17} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

export function Modal({ title, description, onClose, children, footer, wide = false, labelledBy, closeLabel }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  labelledBy?: string;
  closeLabel: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
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
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} className={`modal-panel ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? 'dialog-title'} tabIndex={-1}>
        <header className="modal-header">
          <div className="min-width-zero">
            <h2 id={labelledBy ?? 'dialog-title'}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton label={closeLabel} icon={X} onClick={onClose} />
        </header>
        <div className="modal-content">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
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
