import { describe, expect, it } from '@jest/globals';

import { scrubSentryEvent } from '../src/observability/sentry-scrubber';

describe('scrubSentryEvent — connection-content fields are redacted wholesale', () => {
  it('redacts the obvious sensitive top-level keys inside `extra`', () => {
    const out = scrubSentryEvent({
      extra: {
        body: 'this is a private journal entry',
        rating: 7,
        prompt_body: 'cuddle for 30s',
        unrelated: 'this is fine',
      },
    });
    expect((out.extra as Record<string, unknown>).body).toBe('<redacted>');
    expect((out.extra as Record<string, unknown>).rating).toBe('<redacted>');
    expect((out.extra as Record<string, unknown>).prompt_body).toBe('<redacted>');
    expect((out.extra as Record<string, unknown>).unrelated).toBe('this is fine');
  });

  it('treats camelCase variants the same as snake_case', () => {
    const out = scrubSentryEvent({
      extra: {
        promptBody: 'still secret',
        gratitudePromptTitle: 'also secret',
        partnerAPubkey: 'aabbccdd',
      },
    });
    const extra = out.extra as Record<string, unknown>;
    expect(extra.promptBody).toBe('<redacted>');
    expect(extra.gratitudePromptTitle).toBe('<redacted>');
    expect(extra.partnerAPubkey).toBe('<redacted>');
  });

  it('walks nested objects and arrays', () => {
    const out = scrubSentryEvent({
      breadcrumbs: [
        { category: 'nav', message: 'opened detail' },
        {
          category: 'sync',
          data: {
            envelope: 'aGVsbG8=',
            innerOps: [{ op: 'roleplay.rating', rating: 9 }],
          },
        },
      ],
    });
    const bcs = out.breadcrumbs as Array<Record<string, unknown>>;
    const data = bcs[1]!.data as Record<string, unknown>;
    expect(data.envelope).toBe('<redacted>');
    const inner = data.innerOps as Array<Record<string, unknown>>;
    expect(inner[0]!.op).toBe('<redacted>');
    expect(inner[0]!.rating).toBe('<redacted>');
  });

  it('redacts pubkey hex literals in free-text values', () => {
    const aaa = 'a'.repeat(64);
    const out = scrubSentryEvent({
      message: `Could not decrypt for partner ${aaa} — retrying`,
    });
    expect(out.message).toBe('Could not decrypt for partner <pubkey> — retrying');
  });

  it('redacts emails in free-text values', () => {
    const out = scrubSentryEvent({
      message: 'Crash while logging in as testuser@example.com',
    });
    expect(out.message).toBe('Crash while logging in as <email>');
  });

  it('redacts UUIDs in free-text values', () => {
    const out = scrubSentryEvent({
      message: 'Failed to find session 11111111-2222-3333-4444-555555555555 in DB',
    });
    expect(out.message).toBe('Failed to find session <uuid> in DB');
  });

  it('redacts the `user.email` field reliably (Sentry default surface)', () => {
    const out = scrubSentryEvent({
      user: { id: 'abc', email: 'leak@example.com', username: 'leak' },
    });
    const u = out.user as Record<string, unknown>;
    expect(u.email).toBe('<redacted>');
    expect(u.id).toBe('abc');
    expect(u.username).toBe('leak');
  });

  it('does not mutate the input event', () => {
    const input = { extra: { body: 'secret' } };
    const before = JSON.stringify(input);
    scrubSentryEvent(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('passes through nulls / undefined / primitive booleans + numbers', () => {
    const out = scrubSentryEvent({
      extra: {
        ok: true,
        attempts: 3,
        ignored: null,
        unset: undefined,
      },
    });
    const extra = out.extra as Record<string, unknown>;
    expect(extra.ok).toBe(true);
    expect(extra.attempts).toBe(3);
    expect(extra.ignored).toBeNull();
    expect(extra.unset).toBeUndefined();
  });

  it('does not leak connection ratings via stack-trace local-variable dumps', () => {
    // Sentry's `extra.exception.values[].stacktrace.frames[].vars` is a
    // notorious leak surface — local variables in scope at the throw
    // site get serialised wholesale. Make sure our walker catches it.
    const out = scrubSentryEvent({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  function: 'setRoleplayRating',
                  vars: { sessionId: 'abc', rating: 9, actorPubkey: 'deadbeef' },
                },
              ],
            },
          },
        ],
      },
    });
    const frames = (
      (out.exception as Record<string, unknown>).values as Array<Record<string, unknown>>
    )[0]!.stacktrace as Record<string, unknown>;
    const vars = (frames.frames as Array<Record<string, unknown>>)[0]!.vars as Record<
      string,
      unknown
    >;
    expect(vars.rating).toBe('<redacted>');
    expect(vars.actorPubkey).toBe('<redacted>');
    expect(vars.sessionId).toBe('abc');
  });
});
