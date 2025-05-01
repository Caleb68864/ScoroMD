import { Notice } from 'obsidian';

export enum NotificationLevel {
  ERROR = 'error',
  WARNING = 'warning',
  SUCCESS = 'success',
  INFO = 'info'
}

export interface NotificationOptions {
  level: NotificationLevel;
  message: string;
  duration?: number;
  error?: Error;
}

export class NotificationService {
  private static readonly DEFAULT_DURATIONS = {
    [NotificationLevel.ERROR]: 8000,
    [NotificationLevel.WARNING]: 5000,
    [NotificationLevel.SUCCESS]: 3000,
    [NotificationLevel.INFO]: 2000
  };

  private static readonly ICONS = {
    [NotificationLevel.ERROR]: '❌',
    [NotificationLevel.WARNING]: '⚠️',
    [NotificationLevel.SUCCESS]: '✅',
    [NotificationLevel.INFO]: 'ℹ️'
  };

  static show(options: NotificationOptions) {
    const { level, message, duration, error } = options;
    const icon = this.ICONS[level];
    const defaultDuration = this.DEFAULT_DURATIONS[level];

    if (error) {
      console.error(`${message}:`, error);
      if (error instanceof ScoroError && error.details) {
        console.error('Additional details:', error.details);
      }
    }

    new Notice(
      `${icon} ${message}${error instanceof ScoroError ? `\n${error.message}` : ''}`,
      duration ?? defaultDuration
    );
  }

  static showError(message: string, error?: unknown) {
    let errorMessage = message;
    if (error) {
      if (error instanceof Error) {
        errorMessage += `: ${error.message}`;
      } else if (typeof error === 'string') {
        errorMessage += `: ${error}`;
      } else if (error && typeof error === 'object' && 'message' in error) {
        errorMessage += `: ${error.message}`;
      }
    }
    new Notice(errorMessage);
  }

  static showWarning(message: string) {
    new Notice(message);
  }

  static showSuccess(message: string) {
    new Notice(message);
  }

  static showInfo(message: string) {
    new Notice(message);
  }
}

export class ScoroError extends Error {
  constructor(message: string, public readonly details?: any) {
    super(message);
    this.name = 'ScoroError';
  }
}

export class ScoroApiError extends ScoroError {
  constructor(message: string, public readonly response?: any) {
    super(message, response);
    this.name = 'ScoroApiError';
  }
}

export class ScoroSyncError extends ScoroError {
  constructor(message: string, public readonly entity: string, details?: any) {
    super(`Failed to sync ${entity}: ${message}`, details);
    this.name = 'ScoroSyncError';
  }
}

export class ScoroValidationError extends ScoroError {
  constructor(message: string, public readonly field: string) {
    super(`Validation error for ${field}: ${message}`);
    this.name = 'ScoroValidationError';
  }
} 