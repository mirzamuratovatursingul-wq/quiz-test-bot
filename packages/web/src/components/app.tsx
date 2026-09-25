import { ChevronLeft, LayoutGrid, Plus, RotateCw, User2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { hasNativeButtons, tap } from '@/telegram';

/**
 * Sahifa sarlavhasi: orqaga tugmasi + nom + o'ng tomonda amal.
 * Telegram ichida tepada native "Orqaga" bor — sahifadagisi takrorlanmaydi.
 */
export function PageHeader({
  title,
  meta,
  back,
  action,
}: {
  title: string;
  meta?: ReactNode;
  back?: boolean;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2 bg-background/90 px-4 py-3 backdrop-blur">
      {back && !hasNativeButtons && (
        <button
          onClick={() => navigate(-1)}
          className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          aria-label="Orqaga"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[18px] font-bold leading-tight tracking-tight">{title}</h1>
        {meta && <p className="truncate text-[13px] text-muted-foreground">{meta}</p>}
      </div>
      {action}
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-lg px-4 pb-6 animate-fade-in', className)}>{children}</div>;
}

export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between gap-3 px-1">
      <div className="min-w-0">
        <div className="text-[15px] font-bold">{children}</div>
        {hint && <div className="text-[12.5px] text-muted-foreground">{hint}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <div className="mb-1 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-6" />
      </div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="text-[13.5px] leading-relaxed text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2 w-full">{action}</div>}
    </div>
  );
}

export function LoadingList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 pt-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Xato xabari + "Qayta urinish" (sahifani qaytadan yuklaydi) */
export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13.5px]">
      <span className="min-w-0 flex-1 text-destructive">⚠️ {children}</span>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={() => (onRetry ? onRetry() : window.location.reload())}
      >
        <RotateCw /> Qayta
      </Button>
    </div>
  );
}

/** Ichki qismlarga bo'lingan karta (ro'yxat qatorlari uchun) */
export function IconTile({ emoji, tone = 'primary' }: { emoji: string; tone?: 'primary' | 'warning' | 'muted' }) {
  return (
    <span
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl text-[20px] leading-none',
        tone === 'primary' && 'bg-primary/10',
        tone === 'warning' && 'bg-warning/15',
        tone === 'muted' && 'bg-muted',
      )}
    >
      {emoji}
    </span>
  );
}

const NAV_ROUTES = ['/', '/new', '/profile'];

/**
 * Pastki navigatsiya: faqat asosiy bo'limlarda ko'rinadi.
 * Ichki sahifalarda (shablon, qoralama) joy MainButton va kontentga beriladi.
 */
export function BottomNav() {
  const { pathname } = useLocation();
  if (!NAV_ROUTES.includes(pathname)) return null;

  const items: { to: string; icon: LucideIcon; label: string; end?: boolean }[] = [
    { to: '/', icon: LayoutGrid, label: 'Shablonlar', end: true },
    { to: '/new', icon: Plus, label: 'Yangi test' },
    { to: '/profile', icon: User2, label: 'Profil' },
  ];

  return (
    <>
      {/* Kontent nav ostida qolib ketmasligi uchun joy */}
      <div className="h-[calc(64px+env(safe-area-inset-bottom,0px))]" aria-hidden />
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur">
        <div className="mx-auto flex max-w-lg">
          {items.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={tap}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-semibold transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                      isActive && 'bg-primary/15',
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}

/**
 * Sahifa pastidagi yopishqoq asosiy amal — faqat Telegram tashqarisida
 * (Telegram ichida bu vazifani native MainButton bajaradi).
 */
export function StickyAction({ children }: { children: ReactNode }) {
  if (hasNativeButtons) return null;
  return (
    <>
      <div className="h-20" aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] backdrop-blur">
        <div className="mx-auto w-full max-w-lg">{children}</div>
      </div>
    </>
  );
}

export { Button };
