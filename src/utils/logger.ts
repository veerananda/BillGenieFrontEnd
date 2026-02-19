/**
 * Logger utility for production-ready logging
 * Only logs in development mode to avoid performance issues in production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private isDevelopment: boolean;

  constructor() {
    // Check if we're in development mode
    this.isDevelopment = __DEV__ || process.env.NODE_ENV === 'development' ||
                        process.env.EXPO_PUBLIC_ENABLE_DEBUG_MODE === 'true';
  }

  private shouldLog(): boolean {
    return this.isDevelopment;
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog()) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog()) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog()) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    // Always log errors, even in production
    console.error(this.formatMessage('error', message), ...args);
  }

  // Specific methods for common use cases
  api(message: string, ...args: any[]): void {
    this.debug(`🌐 API: ${message}`, ...args);
  }

  auth(message: string, ...args: any[]): void {
    this.debug(`🔑 AUTH: ${message}`, ...args);
  }

  storage(message: string, ...args: any[]): void {
    this.debug(`💾 STORAGE: ${message}`, ...args);
  }

  websocket(message: string, ...args: any[]): void {
    this.debug(`🔌 WS: ${message}`, ...args);
  }

  inventory(message: string, ...args: any[]): void {
    this.debug(`📦 INVENTORY: ${message}`, ...args);
  }

  orders(message: string, ...args: any[]): void {
    this.debug(`📋 ORDERS: ${message}`, ...args);
  }
}

export const logger = new Logger();