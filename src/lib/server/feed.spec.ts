import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from './store.ts';

const page = `<script>$R[3]={fetchedAt:"2026-10-28T00:00:00Z",fromCache:!1,windowOpen:!0,counties:[],
mail:{rep:300,dem:500,npa:200,oth:0,total:1000},early:{rep:1100,dem:700,npa:200,oth:0,total:2000},
outstanding:{rep:100,dem:100,npa:0,oth:0,total:200},registered:5000,
earlyDays:[{date:"2026-10-27",rep:1100,dem:700,npa:200,oth:0,total:2000,counties:[{code:"ALA",name:"Alachua",rep:1100,dem:700,npa:200,oth:0,total:2000}]}],
mailDays:[{date:"2026-10-27",rep:300,dem:500,npa:200,oth:0,total:1000}]}</script>`;

const store = vi.hoisted(() => ({
	snapshot: null as Snapshot | null,
	background: [] as Promise<unknown>[]
}));

vi.mock('./store.ts', () => ({
	loadSnapshot: vi.fn(async () => store.snapshot),
	saveSnapshot: vi.fn(async (s: Snapshot) => {
		store.snapshot = s;
	}),
	runInBackground: vi.fn((p: Promise<unknown>) => store.background.push(p))
}));

const old = (): Snapshot => ({
	at: 0,
	data: { source: 'x', fetchedAt: 'old', earlyDays: [], mail: { total: 1 } } as never
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
	feed: await import('./feed.ts'),
	kv: await import('./store.ts')
});

describe('getFeed', () => {
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
