import { describe, expect, it } from '@jest/globals';
import { loadEnv } from '../src/config.js';

const BASE = { LOG_LEVEL: 'fatal' as const };

describe('loadEnv blob backend', () => {
  it('defaults to the postgres backend with no S3 vars required', () => {
    const env = loadEnv({ ...BASE });
    expect(env.BLOB_BACKEND).toBe('postgres');
    expect(env.BLOB_TTL_DAYS).toBe(3);
  });

  it('rejects BLOB_BACKEND=s3 when bucket / credentials are missing', () => {
    expect(() => loadEnv({ ...BASE, BLOB_BACKEND: 's3' })).toThrow(/S3_BUCKET/);
  });

  it('accepts a complete s3 config and coerces S3_FORCE_PATH_STYLE', () => {
    const env = loadEnv({
      ...BASE,
      BLOB_BACKEND: 's3',
      S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      S3_BUCKET: 'blobs',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: '1',
    });
    expect(env.BLOB_BACKEND).toBe('s3');
    expect(env.S3_REGION).toBe('auto');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('defaults S3_FORCE_PATH_STYLE to false', () => {
    const env = loadEnv({
      ...BASE,
      BLOB_BACKEND: 's3',
      S3_BUCKET: 'blobs',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });
});
