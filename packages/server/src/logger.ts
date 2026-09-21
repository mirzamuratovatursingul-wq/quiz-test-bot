/** Oddiy, bog'liqliksiz logger (pino kerak bo'lsa oson almashtiriladi). */
type Level = 'debug' | 'info' | 'warn' | 'error';

const ICONS: Record<Level, string> = {
  debug: '\u{1F50E}',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(level: Level, message: unknown, ...rest: unknown[]) {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  const line = `${ts()} ${ICONS[level]} ${typeof message === 'string' ? message : JSON.stringify(message)}`;
  if (level === 'error') console.error(line, ...rest);
  else if (level === 'warn') console.warn(line, ...rest);
  else console.log(line, ...rest);
}

export const logger = {
  debug: (m: unknown, ...r: unknown[]) => log('debug', m, ...r),
  info: (m: unknown, ...r: unknown[]) => log('info', m, ...r),
  warn: (m: unknown, ...r: unknown[]) => log('warn', m, ...r),
  error: (m: unknown, ...r: unknown[]) => log('error', m, ...r),
};
