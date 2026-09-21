import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backButton, mainButton, setClosingConfirmation } from '@/telegram';

/**
 * Telegram'ning tepasidagi "orqaga" tugmasi.
 * Telegram ichida bo'lmasa hech narsa qilmaydi (sahifadagi tugma ishlaydi).
 */
export function useTelegramBackButton(handler?: () => void) {
  const navigate = useNavigate();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const btn = backButton;
    if (!btn) return;
    const onClick = () => {
      if (handlerRef.current) handlerRef.current();
      else navigate(-1);
    };
    btn.onClick(onClick);
    btn.show();
    return () => {
      btn.offClick(onClick);
      btn.hide();
    };
  }, [navigate]);
}

export interface MainButtonOptions {
  text: string;
  onClick: () => void;
  visible?: boolean;
  enabled?: boolean;
  loading?: boolean;
}

/**
 * Telegram'ning pastdagi asosiy tugmasi.
 * Sahifa o'z tugmasini ham ko'rsatadi — Telegram tashqarisida ishlashi uchun.
 */
export function useTelegramMainButton({
  text,
  onClick,
  visible = true,
  enabled = true,
  loading = false,
}: MainButtonOptions) {
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    const btn = mainButton;
    if (!btn) return;
    const handler = () => onClickRef.current();
    btn.onClick(handler);
    return () => {
      btn.offClick(handler);
      btn.hide();
    };
  }, []);

  useEffect(() => {
    if (!mainButton) return;
    mainButton.setParams({ text, is_active: enabled && !loading, is_visible: visible });
    if (loading) mainButton.showProgress(true);
    else mainButton.hideProgress();
  }, [text, visible, enabled, loading]);
}

/** Saqlanmagan o'zgarishlar bo'lsa, Mini App yopilishidan oldin so'raladi */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    setClosingConfirmation(dirty);
    return () => setClosingConfirmation(false);
  }, [dirty]);
}

/**
 * Ro'yxatni bo'lib-bo'lib ko'rsatish (cheksiz skroll).
 * Boshida `step` ta element, pastga yetganda yana `step` ta qo'shiladi.
 */
export function useInfiniteList<T>(items: T[], step = 10) {
  const [count, setCount] = useState(step);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const total = items.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || count >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setCount((c) => Math.min(c + step, total));
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [count, total, step]);

  return {
    visible: items.slice(0, count),
    shown: Math.min(count, total),
    total,
    hasMore: count < total,
    sentinelRef,
    loadMore: () => setCount((c) => Math.min(c + step, total)),
  };
}
