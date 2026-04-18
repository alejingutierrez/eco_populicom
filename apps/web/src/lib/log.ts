type Level = 'info' | 'warn' | 'error';

interface LogRecord {
  level: Level;
  scope: string;
  msg: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

function emit(record: LogRecord): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
  if (record.level === 'error') console.error(line);
  else if (record.level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info(scope: string, msg: string, extra?: Record<string, unknown>) { emit({ level: 'info', scope, msg, ...extra }); },
  warn(scope: string, msg: string, extra?: Record<string, unknown>) { emit({ level: 'warn', scope, msg, ...extra }); },
  error(scope: string, msg: string, extra?: Record<string, unknown>) { emit({ level: 'error', scope, msg, ...extra }); },
};
