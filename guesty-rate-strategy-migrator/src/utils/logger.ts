import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'password',
      'email',
      'token',
      'clientSecret',
      'clientId',
      'encryptedEmail',
      'encryptedPassword',
      '*.password',
      '*.email',
      '*.token',
      '*.secret',
      '*.clientSecret',
      '*.clientId',
      '*.encryptedEmail',
      '*.encryptedPassword',
    ],
    censor: '[REDACTED]',
  },
});
