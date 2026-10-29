import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/feed.json';
import { simulateElection } from '../fixtures/simulation.ts';
import { emptyRecord } from '../fixtures/record.ts';
import { UI_SWITCH_AT } from '../../src/lib/election-clock.ts';
import type { FeedData } from '../../src/lib/types.ts';
import type { ElectionSnapshot } from '../../src/lib/live.ts';
import { viewElection } from '../../src/lib/view-election.ts';

const mocks = vi.hoisted(() => ({
	turnout: vi.fn(),
	results: vi.fn(),
	status: vi.fn(),
	snapshot: null as ElectionSnapshot | null,
	persist: vi.fn()
}));
vi.mock('../../src/lib/server/bindings.ts', () => ({ env: {}, waitUntil: vi.fn() }));
vi.mock('../../src/lib/server/feed.ts', async (original) => ({
	...(await original<typeof import('../../src/lib/server/feed.ts')>()),
	fetchWithRetry: mocks.turnout
}));
vi.mock('../../src/lib/server/http.ts', () => ({ sourceText: mocks.status }));
vi.mock('../../src/lib/server/election-sources.ts', async (original) => ({
	...(await original<typeof import('../../src/lib/server/election-sources.ts')>()),
	fetchResults: mocks.results
}));
vi.mock('../../src/lib/server/store.ts', () => ({
	loadSnapshot: async () => null,
	runInBackground: vi.fn()
}));
vi.mock('../../src/lib/server/election-store.ts', () => ({
	COLLECTION_INTERVAL: 180_000,
	loadElectionDatabase: async () => mocks.snapshot,
	persistElection: mocks.persist
}));
const now = new Date('2026-11-03T22:15:00-05:00');

function makeSnapshot(): ElectionSnapshot {
	const view = simulateElection(fixture, 'closed', now);
	return {
		at: +now,
		data: {
			...fixture,
			fetchedAt: now.toISOString(),
			early: view.state.early,
			mail: view.state.mail,
			eday: view.state.eday,
			counties: view.state.counties
		},
		election: view
	};
}

function responses(s: ElectionSnapshot) {
	mocks.turnout.mockResolvedValue(structuredClone(s.data));
	mocks.results.mockResolvedValue({
		rows: structuredClone(s.election.results),
		url: 'official',
		updated: null
	});
	mocks.status.mockResolvedValue({
		text: `County Reporting Status 2026<table>${s.data.counties.map((c) => `<tr><td>${c.name}</td><td>${Math.round(c.early.total + c.mail.total + (c.eday?.total ?? 0))}</td><td>${c.registered}</td><td>0%</td><td>100%</td>${'<td><span class="Y"></span></td>'.repeat(5)}</tr>`).join('')}</table>`,
		modified: null
	});
}

beforeEach(() => {
	responses(makeSnapshot());
	mocks.snapshot = null;
});
afterEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
});

describe('independent source collection', () => {
	it('accepts valid partial reports while pausing comparisons and retaining completion uncertainty', async () => {
		const { collectElection } = await import('../../src/lib/server/election-feed.ts');
		const previous = makeSnapshot();
		const incoming = structuredClone(previous);
		incoming.data.partial = true;
		incoming.data.received = 64;
		incoming.data.counties[0].eday!.rep += 100;
		incoming.data.counties[0].eday!.total += 100;
		incoming.data.eday!.rep += 100;
		incoming.data.eday!.total += 100;
		responses(incoming);
		const next = await collectElection(previous, now);
		expect(next.data.eday!.total).toBe(previous.data.eday!.total + 100);
		expect(next.election.sources.turnout.error).toBeNull();
		expect(next.election.warnings.join()).toContain('64/67');
		const view = viewElection(next, now);
		expect(view.projectable).toBe(false);
		expect(view.state.turnoutFinal).toBe(false);
		expect(next.election.night).toEqual(previous.election.night);
		responses(previous);
		const recovered = viewElection(await collectElection(next, now), now);
		expect(recovered.projectable).toBe(true);
		expect(recovered.sources.reporting.error).toBeNull();
		expect(recovered.state.turnoutFinal).toBe(true);
	});
	it('retains old turnout during a malformed response while accepting new results and recovering next time', async () => {
		const { collectElection } = await import('../../src/lib/server/election-feed.ts');
		const previous = makeSnapshot();
		mocks.turnout.mockRejectedValueOnce(new Error('Missing turnout payload'));
		const failed = await collectElection(previous, now);
		expect(failed.data).toBe(previous.data);
		expect(failed.election.sources.turnout.error).toContain('Missing turnout payload');
		expect(failed.election.sources.results.error).toBeNull();
		expect(failed.election.sources.results.acceptedAt).toBe(+now);
		const recovered = await collectElection(failed, now);
		expect(recovered.election.sources.turnout.error).toBeNull();
	});
	it('retains results during their outage while turnout still updates', async () => {
		const { collectElection } = await import('../../src/lib/server/election-feed.ts');
		const previous = makeSnapshot();
		mocks.results.mockRejectedValueOnce(new Error('HTTP 503'));
		const next = await collectElection(previous, now);
		expect(next.election.results).toBe(previous.election.results);
		expect(next.election.sources.results.error).toContain('HTTP 503');
		expect(next.election.sources.turnout.error).toBeNull();
	});
	it('accepts validated downward corrections and records them', async () => {
		const { collectElection } = await import('../../src/lib/server/election-feed.ts');
		const previous = makeSnapshot();
		const incoming = structuredClone(previous);
		incoming.data.counties[0].eday!.rep -= 50;
		incoming.data.counties[0].eday!.total -= 50;
		incoming.data.eday!.rep -= 50;
		incoming.data.eday!.total -= 50;
		incoming.election.results.find((r) => r.votes > 100)!.votes -= 50;
		responses(incoming);
		const next = await collectElection(previous, now);
		expect(next.data.eday!.total).toBe(previous.data.eday!.total - 50);
		expect(next.election.corrections?.map((c) => c.source).sort()).toEqual(['results', 'turnout']);
	});
	it('captures an observed EV baseline without inventing one after a missed transition', async () => {
		const { collectElection } = await import('../../src/lib/server/election-feed.ts');
		const before = new Date(UI_SWITCH_AT - 180_000);
		const after = new Date(UI_SWITCH_AT + 180_000);
		const feed: FeedData = { ...fixture, fetchedAt: after.toISOString() };
		const previous: ElectionSnapshot = {
			at: +before,
			data: { ...fixture, fetchedAt: before.toISOString() },
			election: emptyRecord(+before)
		};
		mocks.turnout.mockResolvedValue(feed);
		const next = await collectElection(previous, after);
		expect(next.election.baseline?.mail).toEqual(previous.data.mail);
		const missed = await collectElection(null, after);
		expect(missed.election.baseline).toBeNull();
		expect(missed.election.warnings.join()).toContain('baseline is unavailable');
	});
	it('skips a scheduled bucket already committed', async () => {
		const { refreshElectionSnapshot } = await import('../../src/lib/server/election-feed.ts');
		mocks.snapshot = makeSnapshot();
		await refreshElectionSnapshot(now);
		expect(mocks.turnout).not.toHaveBeenCalled();
		expect(mocks.persist).not.toHaveBeenCalled();
	});
});
