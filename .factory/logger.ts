import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
}

export class Logger {
  private logsDir: string;
  private currentLogFile: string;
  private level: LogLevel;
  private levelPriority: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  };

  constructor(logsDir?: string, level: LogLevel = 'INFO') {
    this.logsDir = logsDir || path.join(__dirname, '..', 'logs');
    this.level = level;
    this.ensureLogsDir();
    this.currentLogFile = this.getLogFilePath();
  }

  private ensureLogsDir(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private getLogFilePath(): string {
    const today = new Date().toISOString().split('T')[0];
    return path.join(this.logsDir, `factory-${today}.log`);
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private writeLog(entry: LogEntry): void {
    try {
      const logPath = this.getLogFilePath();

      // Handle log rotation
      if (logPath !== this.currentLogFile) {
        this.currentLogFile = logPath;
      }

      const logLine = JSON.stringify(entry) + '\n';
      fs.appendFileSync(logPath, logLine);
    } catch (error) {
      console.error(`Failed to write log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('DEBUG')) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'DEBUG',
        message,
        context
      };
      this.writeLog(entry);
      console.log(`[DEBUG] ${message}`, context || '');
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('INFO')) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message,
        context
      };
      this.writeLog(entry);
      console.log(`[INFO] ${message}`, context || '');
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('WARN')) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'WARN',
        message,
        context
      };
      this.writeLog(entry);
      console.warn(`[WARN] ${message}`, context || '');
    }
  }

  error(message: string, error?: Error | string, context?: Record<string, unknown>): void {
    if (this.shouldLog('ERROR')) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        message,
        error: error instanceof Error ? error.message : error,
        context
      };
      this.writeLog(entry);
      console.error(`[ERROR] ${message}`, error || '', context || '');
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLogsDir(): string {
    return this.logsDir;
  }

  getLogs(days: number = 7): LogEntry[] {
    const logs: LogEntry[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    if (!fs.existsSync(this.logsDir)) {
      return logs;
    }

    const files = fs.readdirSync(this.logsDir);

    for (const file of files) {
      const filePath = path.join(this.logsDir, file);
      const stats = fs.statSync(filePath);

      if (stats.mtime < cutoffDate) {
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const entry: LogEntry = JSON.parse(line);
            logs.push(entry);
          } catch {
            // Skip malformed log lines
          }
        }
      } catch (error) {
        console.error(`Failed to read log file ${file}`);
      }
    }

    return logs.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }
}
