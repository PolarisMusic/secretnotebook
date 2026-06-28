import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { PromptsStore, StoredPrompt } from '../storage/types.js';

export interface AdminUiRouteOptions {
  store: PromptsStore;
  token: string;
  now?: () => Date;
}

// Hand-synced with apps/mobile/src/features/secret-unlock/categories.ts.
// Server-side validation accepts ANY snake-case category string (so an
// admin can introduce a new tag without a server deploy), but the UI
// offers these 18 as checkboxes for ease of selection.
const CATEGORY_HINTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'dating', label: 'Dating' },
  { key: 'cohabitation', label: 'Cohabitation' },
  { key: 'engaged', label: 'Engaged' },
  { key: 'newlywed', label: 'Newlywed' },
  { key: 'married', label: 'Married (no kids)' },
  { key: 'expecting', label: 'Expecting' },
  { key: 'raising_babies', label: 'Raising babies (0–2)' },
  { key: 'raising_toddlers', label: 'Raising toddlers (2–5)' },
  { key: 'raising_kids', label: 'Raising kids (5–12)' },
  { key: 'raising_teens', label: 'Raising teens (13–18)' },
  { key: 'raising_adults', label: 'Raising adults (18+)' },
  { key: 'empty_nest', label: 'Empty nest' },
  { key: 'blended_family', label: 'Blended family' },
  { key: 'intimacy', label: 'Intimacy' },
  { key: 'reconnection', label: 'Reconnection' },
  { key: 'long_distance', label: 'Long distance' },
  { key: 'caregiving', label: 'Caregiving' },
  { key: 'general', label: 'General' },
  { key: 'platonic', label: 'Platonic' },
];

const COOKIE_NAME = 'admin_token';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readCookie(req: { headers: { cookie?: string } }, name: string): string | null {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name) return v ?? '';
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a.charCodeAt(i) ^ b.charCodeAt(i)) & 0xff;
  }
  return diff === 0;
}

function isAuthed(req: { headers: { cookie?: string } }, token: string): boolean {
  const c = readCookie(req, COOKIE_NAME);
  return c != null && constantTimeEqual(c, token);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark light; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #0a0a0a; color: #f5f5f5; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  h2 { font-size: 16px; margin: 24px 0 8px; color: #9ec5ff; }
  a { color: #9ec5ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top; font-size: 14px; }
  th { color: #9e9e9e; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  tr.retired td { opacity: 0.4; }
  td.cats { color: #9e9e9e; font-size: 12px; font-family: ui-monospace, monospace; }
  td.actions { white-space: nowrap; }
  form.inline { display: inline; }
  button { background: #2a2a3a; color: #cdd6ff; border: 0; padding: 6px 10px; border-radius: 6px; font-size: 13px; cursor: pointer; }
  button.danger { background: #3a1a1a; color: #ff8a8a; }
  button.primary { background: #9ec5ff; color: #0a0a0a; font-weight: 700; padding: 10px 16px; font-size: 14px; }
  label { display: block; margin: 12px 0 4px; color: #9e9e9e; font-size: 13px; }
  input[type=text], textarea, input[type=url] { width: 100%; box-sizing: border-box; background: #161616; color: #f5f5f5; border: 1px solid #2a2a2a; border-radius: 6px; padding: 10px; font-size: 14px; font-family: inherit; }
  textarea { min-height: 80px; resize: vertical; }
  .cats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 16px; margin-top: 4px; }
  .cats-grid label { display: flex; gap: 8px; align-items: center; margin: 0; padding: 4px 0; color: #f5f5f5; }
  .row { display: flex; gap: 16px; align-items: center; margin: 12px 0; }
  .nav { display: flex; gap: 16px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #2a2a2a; }
  .flash { padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; }
  .flash.ok { background: #16241a; color: #9eff9e; }
  .flash.err { background: #2a1414; color: #ff8a8a; }
  .meta { color: #6e6e6e; font-size: 12px; }
</style>
</head>
<body>${body}</body></html>`;
}

function navBar(): string {
  return `<div class="nav">
    <a href="/v1/admin/ui">Prompts</a>
    <a href="/v1/admin/ui/new">Add new</a>
    <form class="inline" method="POST" action="/v1/admin/ui/logout"><button type="submit">Sign out</button></form>
  </div>`;
}

function loginPage(message: string | null): string {
  return page(
    'Admin · Sign in',
    `
    <h1>Prompt admin</h1>
    ${message ? `<div class="flash err">${escapeHtml(message)}</div>` : ''}
    <form method="POST" action="/v1/admin/ui/login">
      <label for="token">Admin token</label>
      <input id="token" name="token" type="text" autocomplete="off" autofocus required>
      <div class="row"><button type="submit" class="primary">Sign in</button></div>
    </form>
  `,
  );
}

function listPage(rows: StoredPrompt[], flash: { ok?: string; err?: string }): string {
  return page(
    'Admin · Prompts',
    `
    ${navBar()}
    ${flash.ok ? `<div class="flash ok">${escapeHtml(flash.ok)}</div>` : ''}
    ${flash.err ? `<div class="flash err">${escapeHtml(flash.err)}</div>` : ''}
    <h1>Prompts (${rows.length})</h1>
    <table>
      <thead><tr>
        <th>Key</th><th>Text</th><th>Categories</th><th>Source</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr${r.retiredAt ? ' class="retired"' : ''}>
          <td><code>${escapeHtml(r.key)}</code>${r.retiredAt ? '<div class="meta">retired</div>' : ''}${r.sponsored ? '<div class="meta">sponsored</div>' : ''}</td>
          <td>${escapeHtml(r.text)}</td>
          <td class="cats">${r.categories.map(escapeHtml).join(', ')}</td>
          <td>${r.sourceName ? `${escapeHtml(r.sourceName)}${r.sourceUrl ? `<br><a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener">link</a>` : ''}` : '<span class="meta">—</span>'}</td>
          <td class="actions">
            <a href="/v1/admin/ui/edit/${encodeURIComponent(r.key)}">Edit</a>
            ${
              r.retiredAt
                ? `<form class="inline" method="POST" action="/v1/admin/ui/unretire/${encodeURIComponent(r.key)}"><button type="submit">Restore</button></form>`
                : `<form class="inline" method="POST" action="/v1/admin/ui/retire/${encodeURIComponent(r.key)}"><button type="submit" class="danger">Retire</button></form>`
            }
          </td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `,
  );
}

function categoryCheckboxes(selected: ReadonlySet<string>): string {
  return `<div class="cats-grid">${CATEGORY_HINTS.map(
    (c) =>
      `<label><input type="checkbox" name="categories" value="${escapeHtml(c.key)}"${selected.has(c.key) ? ' checked' : ''}> ${escapeHtml(c.label)}</label>`,
  ).join('')}</div>`;
}

function editPage(row: StoredPrompt | null, formError: string | null): string {
  const isNew = row == null;
  const selected = new Set(row?.categories ?? ['general']);
  return page(
    isNew ? 'Admin · New prompt' : `Admin · Edit ${row?.key ?? ''}`,
    `
    ${navBar()}
    ${formError ? `<div class="flash err">${escapeHtml(formError)}</div>` : ''}
    <h1>${isNew ? 'Add prompt' : `Edit ${escapeHtml(row?.key ?? '')}`}</h1>
    <form method="POST" action="/v1/admin/ui/save">
      ${isNew ? '' : `<input type="hidden" name="key" value="${escapeHtml(row?.key ?? '')}">`}
      ${
        isNew
          ? `<label for="key">Key (snake_case, immutable)</label>
        <input id="key" name="key" type="text" autocomplete="off" required pattern="[a-z0-9_]+" value="${escapeHtml((row as { key?: string } | null)?.key ?? '')}">`
          : ''
      }
      <label for="text">Text</label>
      <textarea id="text" name="text" required maxlength="600">${escapeHtml(row?.text ?? '')}</textarea>
      <label>Categories</label>
      ${categoryCheckboxes(selected)}
      <label for="sourceName">Source name (optional)</label>
      <input id="sourceName" name="sourceName" type="text" value="${escapeHtml(row?.sourceName ?? '')}">
      <label for="sourceUrl">Source URL (optional)</label>
      <input id="sourceUrl" name="sourceUrl" type="url" value="${escapeHtml(row?.sourceUrl ?? '')}">
      <label><input type="checkbox" name="sponsored" value="1"${row?.sponsored ? ' checked' : ''}> Sponsored</label>
      <div class="row"><button type="submit" class="primary">${isNew ? 'Create' : 'Save changes'}</button>
        <a href="/v1/admin/ui">Cancel</a></div>
    </form>
  `,
  );
}

/** Parse url-encoded form bodies. `categories` may repeat; collect them
 *  as an array. Everything else collapses to the last value (which is
 *  how browsers submit a single-text-field form anyway). */
function parseForm(body: unknown): Record<string, string | string[]> {
  if (typeof body !== 'string') return {};
  const out: Record<string, string | string[]> = {};
  for (const part of body.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decodeURIComponent((eq === -1 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    const v = decodeURIComponent((eq === -1 ? '' : part.slice(eq + 1)).replace(/\+/g, ' '));
    const existing = out[k];
    if (existing === undefined) {
      out[k] = v;
    } else if (Array.isArray(existing)) {
      existing.push(v);
    } else {
      out[k] = [existing, v];
    }
  }
  return out;
}

function asArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export const adminUiRoute: FastifyPluginAsyncZod<AdminUiRouteOptions> = async (fastify, opts) => {
  const now = opts.now ?? (() => new Date());

  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, body),
  );

  fastify.get('/v1/admin/ui', async (req, reply) => {
    await reply.type('text/html; charset=utf-8');
    if (!isAuthed(req, opts.token)) {
      return loginPage(null);
    }
    const rows = await opts.store.listAll();
    const flash = (req.query as { ok?: string; err?: string }) ?? {};
    return listPage(rows, flash);
  });

  fastify.post('/v1/admin/ui/login', async (req, reply) => {
    const body = parseForm(req.body);
    const provided = typeof body.token === 'string' ? body.token : '';
    if (!constantTimeEqual(provided, opts.token)) {
      await reply.type('text/html; charset=utf-8');
      return loginPage('That token did not match.');
    }
    // 12h session; HttpOnly + SameSite=Strict so the cookie can't be
    // read by JS or sent via cross-site requests. Secure flag too — the
    // admin surface is intended behind HTTPS in production.
    await reply
      .header(
        'Set-Cookie',
        `${COOKIE_NAME}=${encodeURIComponent(provided)}; HttpOnly; Secure; SameSite=Strict; Path=/v1/admin; Max-Age=43200`,
      )
      .redirect(303, '/v1/admin/ui');
    return reply;
  });

  fastify.post('/v1/admin/ui/logout', async (_req, reply) => {
    await reply
      .header(
        'Set-Cookie',
        `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/v1/admin; Max-Age=0`,
      )
      .redirect(303, '/v1/admin/ui');
    return reply;
  });

  fastify.get('/v1/admin/ui/new', async (req, reply) => {
    await reply.type('text/html; charset=utf-8');
    if (!isAuthed(req, opts.token)) return loginPage(null);
    return editPage(null, null);
  });

  fastify.get<{ Params: { key: string } }>('/v1/admin/ui/edit/:key', async (req, reply) => {
    await reply.type('text/html; charset=utf-8');
    if (!isAuthed(req, opts.token)) return loginPage(null);
    const row = await opts.store.findByKey(req.params.key);
    if (!row) {
      await reply.redirect(303, '/v1/admin/ui?err=' + encodeURIComponent('prompt not found'));
      return reply;
    }
    return editPage(row, null);
  });

  fastify.post('/v1/admin/ui/save', async (req, reply) => {
    if (!isAuthed(req, opts.token)) {
      await reply.type('text/html; charset=utf-8').code(401);
      return loginPage(null);
    }
    const body = parseForm(req.body);
    const keyRaw = typeof body.key === 'string' ? body.key.trim() : '';
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const categories = asArray(body.categories).filter((c) => c.length > 0);
    const sourceName =
      typeof body.sourceName === 'string' && body.sourceName.trim().length > 0
        ? body.sourceName.trim()
        : null;
    const sourceUrl =
      typeof body.sourceUrl === 'string' && body.sourceUrl.trim().length > 0
        ? body.sourceUrl.trim()
        : null;
    const sponsored = body.sponsored === '1' || body.sponsored === 'on';

    if (!/^[a-z0-9_]+$/.test(keyRaw) || keyRaw.length > 64) {
      await reply.type('text/html; charset=utf-8').code(400);
      return editPage(null, 'Key must be snake_case ASCII (a–z, 0–9, _), up to 64 chars.');
    }
    if (text.length < 1 || text.length > 600) {
      await reply.type('text/html; charset=utf-8').code(400);
      return editPage(null, 'Text must be 1–600 characters.');
    }
    if (categories.length === 0) {
      await reply.type('text/html; charset=utf-8').code(400);
      return editPage(null, 'Pick at least one category.');
    }

    const existing = await opts.store.findByKey(keyRaw);
    if (existing) {
      await opts.store.update(
        keyRaw,
        { text, categories, sourceName, sourceUrl, sponsored },
        now(),
      );
    } else {
      await opts.store.create(
        { key: keyRaw, text, categories, sourceName, sourceUrl, sponsored },
        now(),
      );
    }
    await reply.redirect(303, '/v1/admin/ui?ok=' + encodeURIComponent('Saved.'));
    return reply;
  });

  fastify.post<{ Params: { key: string } }>('/v1/admin/ui/retire/:key', async (req, reply) => {
    if (!isAuthed(req, opts.token)) {
      await reply.type('text/html; charset=utf-8').code(401);
      return loginPage(null);
    }
    const ok = await opts.store.retire(req.params.key, now());
    await reply.redirect(
      303,
      ok
        ? '/v1/admin/ui?ok=' + encodeURIComponent('Retired.')
        : '/v1/admin/ui?err=' + encodeURIComponent('Could not retire (already retired?).'),
    );
    return reply;
  });

  fastify.post<{ Params: { key: string } }>('/v1/admin/ui/unretire/:key', async (req, reply) => {
    if (!isAuthed(req, opts.token)) {
      await reply.type('text/html; charset=utf-8').code(401);
      return loginPage(null);
    }
    const ok = await opts.store.unretire(req.params.key, now());
    await reply.redirect(
      303,
      ok
        ? '/v1/admin/ui?ok=' + encodeURIComponent('Restored.')
        : '/v1/admin/ui?err=' + encodeURIComponent('Could not restore (not retired?).'),
    );
    return reply;
  });
};
