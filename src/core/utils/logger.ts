/**
 * Centralized logging service
 */

export enum LogLevel {
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  DEBUG = "debug",
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
  private static formatMessage(
    level: LogLevel,
    message: string,
    meta?: LogMeta,
  ): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  static info(message: string, meta?: LogMeta): void {
    console.log(this.formatMessage(LogLevel.INFO, message, meta));
  }

  static warn(message: string, meta?: LogMeta): void {
    console.warn(this.formatMessage(LogLevel.WARN, message, meta));
  }

  static error(message: string, error?: Error, meta?: LogMeta): void {
    const errorMeta = {
      ...meta,
      error: error?.message,
      stack: error?.stack,
    };
    console.error(this.formatMessage(LogLevel.ERROR, message, errorMeta));
  }

  static debug(message: string, meta?: LogMeta): void {
    if (process.env.DEBUG === "true") {
      console.log(this.formatMessage(LogLevel.DEBUG, message, meta));
    }
  }

  // Convenience methods for common logging patterns
  static productExtracted(
    site: string,
    productName: string,
    price: number | null,
  ): void {
    this.info(`Product extracted: ${productName}`, {
      site,
      productName,
      price,
    });
  }

  static discoveryComplete(
    site: string,
    urlCount: number,
    duration: number,
  ): void {
    this.info(`Discovery complete`, {
      site,
      urlCount,
      duration,
    });
  }

  static batchProgress(
    site: string,
    processed: number,
    total: number,
    rate: number,
  ): void {
    this.info(`Progress: ${processed}/${total}`, {
      site,
      processed,
      total,
      rate: rate.toFixed(1),
    });
  }

  static errorOccurred(site: string, url: string, error: Error): void {
    this.error(`PDP extraction failed: ${url}`, error, {
      site,
      url,
    });
  }

  static cooldownActivated(site: string, consecutiveErrors: number): void {
    this.warn(
      `Cooldown activated due to ${consecutiveErrors} consecutive errors`,
      {
        site,
        consecutiveErrors,
      },
    );
  }
}
