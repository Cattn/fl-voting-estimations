import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fixture from '../fixtures/feed.json';
import { simulateElection } from '../fixtures/simulation.ts';
import { observations } from '../../src/lib/live.ts';
import { ELECTION_MIDNIGHT } from '../../src/lib/election-clock.ts';
import type { ElectionSnapshot } from '../../src/lib/live.ts';

const bindings = vi.hoisted(() => ({ env: {} as Record<string, unknown>, put: vi.fn() }));
vi.mock('../../src/lib/server/bindings.ts', () => ({ env: bindings.env, waitUntil: vi.fn() }));
const { getPlatformProxy } = createRequire(import.meta.url)('wrangler');
let proxy: { env: { ELECTION_HISTORY: D1Database }; dispose(): Promise<void> };
const now = Date.parse('2026-11-03T20:00:00-05:00');
const full = (() => {
	const { state, projectable, currentNight, ...record } = simulateElection(
		fixture,
		'closed',
		new Date(now)
	);
	const s: ElectionSnapshot = {
		at: now,
		data: {
			...fixture,
			counties: state.counties,
			early: state.early,
			mail: state.mail,
			eday: state.eday
		},
		election: { ...record, history: [], night: [] }
	};
	for (let minute = 420; minute < 1440; minute += 3) {
		const at = new Date(ELECTION_MIDNIGHT + minute * 60_000);
		s.election.sources.turnout.acceptedAt = +at;
		s.election.sources.results.acceptedAt = +at;
		s.election = observations(s, at);
	}
	return s;
})();
const snapshot = (at = now): ElectionSnapshot => structuredClone({ ...full, at });

beforeAll(async () => {
	proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: false });
	bindings.env.ELECTION_HISTORY = proxy.env.ELECTION_HISTORY;
	bindings.env.FEED_CACHE = { put: bindings.put };
}, 30_000);
beforeEach(async () => {
	await proxy.env.ELECTION_HISTORY.prepare('DROP TABLE IF EXISTS election_records').run();
	bindings.put.mockClear();
});
afterAll(async () => {
	await proxy?.dispose();
});

describe('real D1 storage and publication budgets', () => {
	it('publishes once and rejects duplicated, stale and conflicting writes', async () => {
		const { persistElection, loadElectionDatabase } =
			await import('../../src/lib/server/election-store.ts');
		expect(await persistElection(snapshot(), null)).toBe(true);
		expect(await persistElection(snapshot(), null)).toBe(false);
		expect(await persistElection(snapshot(now - 180_000), now)).toBe(false);
		expect(await persistElection(snapshot(now + 180_000), now - 180_000)).toBe(false);
		expect(bindings.put).toHaveBeenCalledTimes(1);
		expect((await loadElectionDatabase())?.at).toBe(now);
		expect(await persistElection(snapshot(now + 180_000), now)).toBe(true);
		expect(bindings.put).toHaveBeenCalledTimes(2);
	});
	it('retains bounded daily archives with a large margin under free storage and row budgets', async () => {
		const { persistElection, MAX_DATABASE_BYTES, COLLECTION_INTERVAL } =
			await import('../../src/lib/server/election-store.ts');
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			let previous: number | null = null;
			for (let day = 0; day < 36; day++) {
				const at = now + day * 86_400_000;
				await persistElection(snapshot(at), previous);
				previous = at;
			}
			const row = await proxy.env.ELECTION_HISTORY.prepare(
				'SELECT COUNT(*) AS count FROM election_records'
			).first<{ count: number }>();
			expect(row?.count).toBe(33);
			const metrics = log.mock.calls
				.map(
					([v]) =>
						v as {
							event: string;
							rows_written: number;
							database_bytes: number;
							published_bytes: number;
						}
				)
				.filter((v) => v.event === 'election_storage');
			expect(metrics).toHaveLength(36);
			expect(Math.max(...metrics.map((v) => v.database_bytes))).toBeLessThan(MAX_DATABASE_BYTES);
			expect(
				Math.max(...metrics.map((v) => v.rows_written)) * (86_400_000 / COLLECTION_INTERVAL)
			).toBeLessThan(10_000);
			expect(86_400_000 / COLLECTION_INTERVAL).toBe(480);
			expect(Math.max(...metrics.map((v) => v.published_bytes))).toBeLessThan(1_500_000);
		} finally {
			log.mockRestore();
		}
	});
	it('rejects oversized snapshots before publication', async () => {
		const { persistElection } = await import('../../src/lib/server/election-store.ts');
		const s = snapshot();
		s.election.warnings.push('x'.repeat(1_500_000));
		await expect(persistElection(s, null)).rejects.toThrow('storage budget');
		expect(bindings.put).not.toHaveBeenCalled();
	});
});
