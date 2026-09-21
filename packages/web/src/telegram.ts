/** Telegram Mini App SDK ustidan yupqa qatlam (brauzerda ham ishlaydi). */

interface MainButton {
  text: string;
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  enable: () => void;
  disable: () => void;
  showProgress: (leaveActive?: boolean) => void;
  hideProgress: () => void;
  setText: (text: string) => void;
  setParams: (params: {
    text?: string;
    color?: string;
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
  }) => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
    start_param?: string;
  };
  version: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready: () => void;
  expand: () => void;
  close: () => void;
  openTelegramLink: (url: string) => void;
  showAlert: (message: string, cb?: () => void) => void;
  showConfirm: (message: string, cb: (ok: boolean) => void) => void;
  showPopup?: (
    params: {
      title?: string;
      message: string;
      buttons?: { id?: string; type?: string; text?: string }[];
    },
    cb?: (buttonId: string) => void,
  ) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  disableVerticalSwipes?: () => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  MainButton: MainButton;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export const tg = window.Telegram?.WebApp;
export const isTelegram = Boolean(tg?.initData);

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  document.documentElement.dataset.theme = tg.colorScheme;
  // Ro'yxatni aylantirganda Mini App tasodifan yopilib qolmasligi uchun
  tg.disableVerticalSwipes?.();
  const bg = tg.themeParams?.bg_color;
  if (bg) tg.setHeaderColor?.(bg);
}

export function initData(): string {
  return tg?.initData ?? '';
}

export function currentUser() {
  return tg?.initDataUnsafe?.user ?? null;
}

/* ---------------- Haptics ---------------- */

export function haptic(type: 'success' | 'error' | 'warning' = 'success') {
  tg?.HapticFeedback?.notificationOccurred(type);
}

export function tap() {
  tg?.HapticFeedback?.impactOccurred('light');
}

export function selectionTap() {
  tg?.HapticFeedback?.selectionChanged();
}

/* ---------------- Dialoglar ---------------- */

export function alertMsg(message: string) {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
}

export function confirmMsg(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg?.showConfirm) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

/** Telegram'ning native popup'i: sarlavha + matn + tugmalar */
export function popup(params: {
  title?: string;
  message: string;
  buttons?: { id?: string; type?: string; text?: string }[];
}): Promise<string> {
  return new Promise((resolve) => {
    if (tg?.showPopup) tg.showPopup(params, resolve);
    else {
      window.alert(`${params.title ? `${params.title}\n\n` : ''}${params.message}`);
      resolve('ok');
    }
  });
}

export function openTelegramLink(url: string) {
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

/** Saqlanmagan o'zgarish bo'lsa, yopishdan oldin so'rash */
export function setClosingConfirmation(enabled: boolean) {
  if (enabled) tg?.enableClosingConfirmation?.();
  else tg?.disableClosingConfirmation?.();
}

export const mainButton = tg?.MainButton;
export const backButton = tg?.BackButton;
