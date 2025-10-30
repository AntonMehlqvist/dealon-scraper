import pino from 'pino';

// Set log level via env LOG_LEVEL (default: info)
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

export enum LogLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug',
}

export interface LogMeta {
  site?: string;
  url?: string;
  duration?: number;
  count?: number;
  error?: string;
  [key: string]: any;
}

export class Logger {
  static info(message: string, meta?: LogMeta): void {
    logger.info(meta || {}, message);
  }
  static warn(message: string, meta?: LogMeta): void {
    logger.warn(meta || {}, message);
  }
  static error(message: string, error?: Error, meta?: LogMeta): void {
    const errorMeta = {
      ...meta,
      error: error?.message,
      stack: error?.stack,
    };
    logger.error(errorMeta, message);
  }
  static debug(message: string, meta?: LogMeta): void {
    logger.debug(meta || {}, message);
  }
  // Convenience methods for common logging patterns
  static productExtracted(site: string, productName: string, price: number | null): void {
    this.info(`Product extracted: ${productName}`, {
      site,
      productName,
      price,
    });
  }
  static discoveryComplete(site: string, urlCount: number, duration: number): void {
    this.info(`Discovery complete`, { site, urlCount, duration });
  }
  static batchProgress(site: string, processed: number, total: number, rate: number): void {
    this.info(`Progress: ${processed}/${total}`, { site, processed, total, rate: rate.toFixed(1) });
  }
  static errorOccurred(site: string, url: string, error: Error): void {
    this.error(`PDP extraction failed: ${url}`, error, { site, url });
  }
  static cooldownActivated(site: string, consecutiveErrors: number): void {
    this.warn(
      `Cooldown activated due to ${consecutiveErrors} consecutive errors`,
      { site, consecutiveErrors },
    );
  }
}
