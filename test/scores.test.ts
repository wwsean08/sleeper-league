import { describe, expect, it } from 'vitest';
import { fetchScores } from '../src/server/sleeper/scores.js';

const q = { season: '2026', seasonType: 'regular', week: 9 };
const okFetch = (body: unknown, status = 200) =>
  (async (_url: unknown, init?: RequestInit) => {
    calls.push({ url: String(_url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
let calls: Array<{ url: string; init?: RequestInit }> = [];

describe('fetchScores', () => {
  it('posts a GraphQL query with variables to sleeper.com/graphql and returns the games', async () => {
    calls = [];
    const games = await fetchScores(q, okFetch({ data: { scores: [
      { game_id: '1', metadata: { home_team: 'BAL', away_team: 'JAX', status: 'closed' } },
      { game_id: '2', metadata: { home_team: 'KC', away_team: 'DEN', status: 'inprogress' } },
    ] } }));
    expect(games.map((g) => g.game_id)).toEqual(['1', '2']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://sleeper.com/graphql');
    expect(calls[0]!.init?.method).toBe('POST');
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.variables).toEqual({ season: '2026', season_type: 'regular', week: 9 });
    expect(body.query).toContain('scores(');
    expect(body.query).toContain('game_id');
    expect(body.query).toContain('metadata');
  });
  it('sends only a content-type header: no spoofed User-Agent, no cookies, no token', async () => {
    calls = [];
    await fetchScores(q, okFetch({ data: { scores: [] } }));
    const headers = new Headers(calls[0]!.init?.headers);
    expect([...headers.keys()]).toEqual(['content-type']);
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('drops entries without a game id and treats a missing list as empty', async () => {
    const games = await fetchScores(q, okFetch({ data: { scores: [{ metadata: {} }, { game_id: '3', metadata: {} }, null] } }));
    expect(games.map((g) => g.game_id)).toEqual(['3']);
    expect(await fetchScores(q, okFetch({ data: { scores: null } }))).toEqual([]);
    expect(await fetchScores(q, okFetch({ data: {} }))).toEqual([]);
  });
  it('throws a short error for a non-200 response without echoing the body', async () => {
    const err = await fetchScores(q, okFetch({ secret: 'do-not-leak' }, 403)).then(() => undefined, (e: Error) => e);
    expect(err?.message).toContain('403');
    expect(err?.message).toContain('scores');
    expect(err?.message).not.toContain('do-not-leak');
  });
  it('throws when GraphQL reports errors and returns no data', async () => {
    await expect(fetchScores(q, okFetch({ errors: [{ message: 'bad query' }] }))).rejects.toThrow(/scores/);
  });
  it('times out a hung request using the abort signal', async () => {
    const hung = ((_u: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
      })) as unknown as typeof fetch;
    await expect(fetchScores(q, hung, 20)).rejects.toThrow(/timed out/);
  });
});
