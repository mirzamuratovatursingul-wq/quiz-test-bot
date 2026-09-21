import { ChevronLeft, LayoutGrid, Plus, User2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Sahifa sarlavhasi: orqaga tugmasi + nom + o'ng tomonda amal */
export function PageHeader({
  title,
  meta,
  back,
  action,
}: {
  title: string;
  meta?: string;
  back?: boolean;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2 bg-background/85 px-4 py-3 backdrop-blur">
      {back && (
        <button
          onClick={() => navigate(-1)}
          className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground"
          aria-label="Orqaga"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-semibold leading-tight">{title}</h1>
        {meta && <p className="truncate text-[13px] text-muted-foreground">{meta}</p>}
      </div>
      {action}
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-lg px-4 pb-6 animate-fade-in', className)}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 mt-5 px-1">
      <div className="text-[14px] font-semibold">{children}</div>
      {hint && <div className="text-[12.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <p className="text-[15px] text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}

export function LoadingList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 pt-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[62px] w-full" />
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2 text-[13px] text-destructive">{children}</div>
  );
}

/** Pastki navigatsiya: uchta bo'lim */
export function BottomNav() {
  const items: { to: string; icon: LucideIcon; label: string; end?: boolean }[] = [
    { to: '/', icon: LayoutGrid, label: 'Shablonlar', end: true },
    { to: '/new', icon: Plus, label: 'Yangi' },
    { to: '/profile', icon: User2, label: 'Profil' },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur">
      {items.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
        >
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Sahifa pastidagi yopishqoq asosiy amal */
export function StickyAction({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto w-full max-w-lg">{children}</div>
    </div>
  );
}

export { Button };
