import { describe, expect, it } from '@jest/globals';
import { pickPromptWeighted, type Prompt } from '../src/index.js';

const A: Prompt = {
  key: 'a',
  title: 'A',
  body: 'aaaaaaaaaa',
  suggestedAssignee: 'either',
  tags: [],
};
const B: Prompt = {
  key: 'b',
  title: 'B',
  body: 'bbbbbbbbbb',
  suggestedAssignee: 'curator',
  tags: [],
};
const C: Prompt = {
  key: 'c',
  title: 'C',
  body: 'cccccccccc',
  suggestedAssignee: 'enactor',
  tags: [],
};
const D: Prompt = {
  key: 'd',
  title: 'D',
  body: 'dddddddddd',
  suggestedAssignee: 'either',
  tags: [],
};
const LIBRARY = [A, B, C, D];

describe('pickPromptWeighted — selection', () => {
  it('returns the first eligible prompt when random() = 0', () => {
    const picked = pickPromptWeighted(LIBRARY, { random: () => 0 });
    expect(picked.prompt.key).toBe('a');
    expect(picked.index).toBe(0);
  });

  it('returns a deterministic pick given a fixed random source', () => {
    // 4 prompts, all weight 1 → total 4; r = 0.6 * 4 = 2.4 → index 2 (C)
    const picked = pickPromptWeighted(LIBRARY, { random: () => 0.6 });
    expect(picked.prompt.key).toBe('c');
  });

  it('lands on the last candidate when random() rounds up to the boundary', () => {
    // edge case: random() can technically return very-close-to-1
    const picked = pickPromptWeighted(LIBRARY, { random: () => 0.999_999 });
    expect(picked.prompt.key).toBe('d');
  });
});

describe('pickPromptWeighted — excludeKeys filter', () => {
  it("respects array excludeKeys — won't pick anything in the list", () => {
    const picks = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const p = pickPromptWeighted(LIBRARY, {
        excludeKeys: ['a', 'b'],
        random: () => i / 100,
      });
      picks.add(p.prompt.key);
    }
    expect(picks).not.toContain('a');
    expect(picks).not.toContain('b');
    expect(picks.has('c') || picks.has('d')).toBe(true);
  });

  it('accepts a Set as excludeKeys (same behaviour)', () => {
    const picked = pickPromptWeighted(LIBRARY, {
      excludeKeys: new Set(['a', 'b', 'c']),
      random: () => 0.5,
    });
    expect(picked.prompt.key).toBe('d');
  });

  it('throws when every prompt is excluded', () => {
    expect(() =>
      pickPromptWeighted(LIBRARY, {
        excludeKeys: ['a', 'b', 'c', 'd'],
      }),
    ).toThrow(/no prompt available/);
  });

  it('throws when the library is empty', () => {
    expect(() => pickPromptWeighted([])).toThrow(/empty/);
  });
});

describe('pickPromptWeighted — preferForAssignee bias', () => {
  it("'curator' bias makes B (suggestedAssignee=curator) 2x as likely vs neutrals", () => {
    // Library: A (1) + B (2) + C (1) + D (1) = 5
    // B at random 0.2 → cumulative reaches B (1 + 2 = 3, r=0.2*5=1.0 → falls in B's range [1,3))
    const picked = pickPromptWeighted(LIBRARY, {
      preferForAssignee: 'curator',
      random: () => 0.2,
    });
    expect(picked.prompt.key).toBe('b');
  });

  it("'enactor' bias does NOT also boost 'curator'", () => {
    // Library: A (1) + B (1) + C (2) + D (1) = 5
    // r = 0.5 → 2.5 → A(1), B(2), then C starts at 2... falls in C (2..4) → C
    const picked = pickPromptWeighted(LIBRARY, {
      preferForAssignee: 'enactor',
      random: () => 0.5,
    });
    expect(picked.prompt.key).toBe('c');
  });

  it("'either' is treated as no bias", () => {
    const withEither = pickPromptWeighted(LIBRARY, {
      preferForAssignee: 'either',
      random: () => 0.5,
    });
    const without = pickPromptWeighted(LIBRARY, { random: () => 0.5 });
    expect(withEither.prompt.key).toBe(without.prompt.key);
  });

  it('null preference is treated as no bias', () => {
    const withNull = pickPromptWeighted(LIBRARY, {
      preferForAssignee: null,
      random: () => 0.5,
    });
    const without = pickPromptWeighted(LIBRARY, { random: () => 0.5 });
    expect(withNull.prompt.key).toBe(without.prompt.key);
  });
});

describe('pickPromptWeighted — statistical sanity', () => {
  it('uniform random across 4 equal-weight prompts approximately hits each ~25% of the time', () => {
    let n = 0;
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    let r = 1;
    const rng: () => number = () => {
      // Tiny mulberry32 — deterministic, good distribution for tests.
      r = (1_103_515_245 * r + 12_345) >>> 0;
      n += 1;
      return (r / 4_294_967_296) % 1;
    };
    void n;
    for (let i = 0; i < 4_000; i++) {
      const picked = pickPromptWeighted(LIBRARY, { random: rng });
      counts[picked.prompt.key] = (counts[picked.prompt.key] ?? 0) + 1;
    }
    for (const key of ['a', 'b', 'c', 'd']) {
      // 25% ± 5% wiggle. 4000 samples → expected 1000 per bucket.
      expect(counts[key]).toBeGreaterThan(800);
      expect(counts[key]).toBeLessThan(1200);
    }
  });
});
