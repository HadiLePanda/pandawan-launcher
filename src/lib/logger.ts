type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

type LogSink = (entry: LogEntry) => void;

const defaultSink: LogSink = (entry) => {
  const { level, message, context } = entry;
  if (context && Object.keys(context).length > 0) {
    console[level](message, context);
  } else {
    console[level](message);
  }
};

let sink: LogSink = defaultSink;

export function setLogSink(newSink: LogSink): void {
  sink = newSink;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  sink({
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  });
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
};
