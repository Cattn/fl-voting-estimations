import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../src/lib/server/store.ts';
import { toCrossJSON } from 'seroval';
import fixture from '../fixtures/feed.json';

const page = `<script>$R[3]={fetchedAt:"2026-10-28T00:00:00Z",fromCache:!1,windowOpen:!0,counties:[],
mail:{rep:300,dem:500,npa:200,oth:0,total:1000},early:{rep:1100,dem:700,npa:200,oth:0,total:2000},
outstanding:{rep:100,dem:100,npa:0,oth:0,total:200},registered:5000,
earlyDays:[{date:"2026-10-27",rep:1100,dem:700,npa:200,oth:0,total:2000,counties:[{code:"ALA",name:"Alachua",rep:1100,dem:700,npa:200,oth:0,total:2000}]}],
mailDays:[{date:"2026-10-27",rep:300,dem:500,npa:200,oth:0,total:1000}]}</script>`;

const store = vi.hoisted(() => ({
	snapshot: null as Snapshot | null,
	background: [] as Promise<unknown>[]
}));

vi.mock('../../src/lib/server/store.ts', () => ({
	loadSnapshot: vi.fn(async () => store.snapshot),
	saveSnapshot: vi.fn(async (s: Snapshot) => {
		store.snapshot = s;
	}),
	runInBackground: vi.fn((p: Promise<unknown>) => store.background.push(p))
}));

const old = (): Snapshot => ({
	at: 0,
	data: { source: 'x', fetchedAt: 'old', earlyDays: [], mailDays: [], mail: { total: 1 } } as never
});

beforeEach(() => {
	store.snapshot = null;
	store.background = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	vi.clearAllMocks();
});

const load = async () => ({
	feed: await import('../../src/lib/server/feed.ts'),
	kv: await import('../../src/lib/server/store.ts')
});

describe('today mail retention', () => {
	it('keeps today when the source omits or zeroes it without changing overall totals', async () => {
		const { feed } = await load();
		const previous = feed.extractFeed(page);
		previous.mailDays[0].date = '2026-10-28';
		for (const mailDays of [[], [{ ...previous.mailDays[0], rep: 0, dem: 0, total: 0 }]]) {
			const incoming = { ...previous, mailDays };
			const result = feed.retainTodayMail(incoming, previous, '2026-10-28');
			expect(result.mailDays).toBe(incoming.mailDays);
			expect(result.lastReportedMail).toEqual({ ...previous.mailDays[0], retained: true });
			expect(result.mail).toBe(incoming.mail);
		}
	});

	it('accepts a new nonzero report, including downward corrections', async () => {
		const { feed } = await load();
		const previous = feed.extractFeed(page);
		previous.mailDays[0].date = '2026-10-28';
		const incoming = {
			...previous,
			mailDays: [{ ...previous.mailDays[0], rep: 100, dem: 200, total: 500 }]
		};
		expect(feed.retainTodayMail(incoming, previous, '2026-10-28')).toBe(incoming);
	});

	it('retains the display report through repeated omissions without inserting historical votes', async () => {
		const { feed } = await load();
		const previous = feed.extractFeed(page);
		previous.mailDays[0].date = '2026-10-28';
		const empty = { ...previous, mailDays: [] };
		const first = feed.retainTodayMail(empty, previous, '2026-10-28');
		const second = feed.retainTodayMail(empty, first, '2026-10-28');
		expect(second.lastReportedMail).toEqual(first.lastReportedMail);
		expect(second.mailDays).toEqual([]);
	});

	it('never substitutes yesterday or carries counts into the next day', async () => {
		const { feed } = await load();
		const previous = feed.extractFeed(page);
		const incoming = { ...previous, mailDays: [] };
		expect(feed.retainTodayMail(incoming, previous, '2026-10-28')).toBe(incoming);
		previous.mailDays[0].date = '2026-10-28';
		expect(feed.retainTodayMail(incoming, previous, '2026-10-29')).toBe(incoming);
	});
});

describe('getFeed', () => {
	it('normalizes server-function data with county Election Day fields and partial metadata', async () => {
		const id = 'b'.repeat(64);
		const raw = {
			...fixture,
			partial: true,
			received: 64,
			counties: fixture.counties.map((c) => ({
				...c,
				status: 'live',
				updated: fixture.fetchedAt,
				eday: { rep: 10, dem: 5, npa: 3, oth: 1, total: 19 }
			}))
		};
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(new Response('<script src="/assets/current.js"></script>'))
				.mockResolvedValueOnce(
					new Response(
						'var XY=fn({method:`GET`}).handler(server(`' + id + '`));await XY({data:{force:false}})'
					)
				)
				.mockResolvedValueOnce(Response.json(toCrossJSON({ result: raw }, { refs: new Map() })))
		);
		const { feed } = await load();
		const data = await feed.fetchWithRetry();
		expect(data.partial).toBe(true);
		expect(data.received).toBe(64);
		expect(data.counties[0].eday).toEqual(raw.counties[0].eday);
		expect(data.counties[0].updated).toBe(fixture.fetchedAt);
		expect(data.counties[0].status).toBe('live');
	});
	it('returns the saved snapshot immediately when the source hangs', async () => {
		store.snapshot = old();
		const hanging = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_, reject) =>
					init.signal?.addEventListener('abort', () => reject(init.signal!.reason))
				)
		);
		vi.stubGlobal('fetch', hanging);
		const { feed } = await load();

		const started = Date.now();
		const data = await feed.getFeed();
		expect(Date.now() - started).toBeLessThan(500);
		expect(data.fetchedAt).toBe('old');
		expect(hanging.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
	});

	it('fetches the source once no matter how many requests arrive at once', async () => {
		const ok = vi.fn(async () => new Response(page));
		vi.stubGlobal('fetch', ok);
		const { feed, kv } = await load();

		await Promise.all(Array.from({ length: 50 }, () => feed.getFeed()));
		await Promise.all(Array.from({ length: 50 }, () => feed.getFeed()));
		expect(ok).toHaveBeenCalledOnce();
		expect(kv.saveSnapshot).not.toHaveBeenCalled();
	});

	it('writes the feed snapshot only from the scheduled refresh', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(page))
		);
		const { feed, kv } = await load();
		await feed.refreshSnapshot();
		expect(kv.saveSnapshot).toHaveBeenCalledOnce();
		expect(store.snapshot?.data.early.total).toBe(2000);
	});

	it('skips the KV write when another instance saved recently', async () => {
		store.snapshot = old();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				store.snapshot = { ...old(), at: Date.now() };
				return new Response(page);
			})
		);
		const { feed, kv } = await load();

		await feed.getFeed();
		await Promise.all(store.background);
		expect(kv.saveSnapshot).not.toHaveBeenCalled();
	});

	it('keeps per-county rows for each IPEV day', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(page))
		);
		const { feed } = await load();
		const data = await feed.getFeed();
		expect(data.earlyDays[0].counties).toEqual([
			{ code: 'ALA', rep: 1100, dem: 700, npa: 200, oth: 0, total: 2000 }
		]);
	});

	it('reads KV at most once per interval while data is stale', async () => {
		store.snapshot = old();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise<Response>((_, reject) =>
						init.signal?.addEventListener('abort', () => reject(init.signal!.reason))
					)
			)
		);
		const { feed, kv } = await load();

		await Promise.all(Array.from({ length: 20 }, () => feed.getFeed()));
		for (let i = 0; i < 200; i++) await feed.getFeed();
		expect(kv.loadSnapshot).toHaveBeenCalledOnce();
	});

	it('serves a fresh KV snapshot without touching the source', async () => {
		store.snapshot = { ...old(), at: Date.now() };
		const spy = vi.fn();
		vi.stubGlobal('fetch', spy);
		const { feed } = await load();

		expect((await feed.getFeed()).fetchedAt).toBe('old');
		expect(spy).not.toHaveBeenCalled();
	});
});
