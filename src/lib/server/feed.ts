import { parseLiteral } from './literal.ts';
import { floridaClock } from '../model.ts';
import { loadSnapshot, runInBackground, saveSnapshot, type Snapshot } from './store.ts';
import type { County, CountyDayCounts, DayCounts, FeedData, PartyCounts } from '#lib/types.ts';

export const SOURCE_URL = 'https://acorn-maple-earth-lake.grok.me/';
const TTL_MS = 3 * 60 * 1000;

let cache: Snapshot | null = null;

const party = (p: unknown): PartyCounts => {
	const o = (p ?? {}) as Record<string, unknown>;
	const n = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
	return { rep: n('rep'), dem: n('dem'), npa: n('npa'), oth: n('oth'), total: n('total') };
};

const day = (d: unknown): DayCounts => {
	const o = d as Record<string, unknown>;
	const out: DayCounts = { date: String(o.date), ...party(d) };
	if (Array.isArray(o.counties)) {
		out.counties = o.counties.map((c): CountyDayCounts => ({
			code: String((c as Record<string, unknown>).code),
			...party(c)
		}));
	}
	return out;
};

export function extractFeed(html: string): FeedData {
	const anchor = html.indexOf('{fetchedAt:');
	if (anchor < 0) throw new Error('Could not find turnout payload in source page');
	const raw = parseLiteral(html, anchor) as Record<string, unknown>;

	const counties = ((raw.counties as unknown[]) ?? []).map((c): County => {
		const o = c as Record<string, unknown>;
		return {
			code: String(o.code),
			name: String(o.name),
			registered: Number(o.registered) || 0,
			mail: party(o.mail),
			early: party(o.early)
		};
	});

	const byDate = (a: DayCounts, b: DayCounts) => a.date.localeCompare(b.date);
	const data: FeedData = {
		source: SOURCE_URL,
		fetchedAt: String(raw.fetchedAt),
		windowOpen: Boolean(raw.windowOpen),
		registered: Number(raw.registered) || 0,
		mail: party(raw.mail),
		early: party(raw.early),
		outstanding: party(raw.outstanding),
		counties,
		earlyDays: ((raw.earlyDays as unknown[]) ?? []).map(day).sort(byDate),
		mailDays: ((raw.mailDays as unknown[]) ?? []).map(day).sort(byDate)
	};

	if (!data.earlyDays.length || !data.mail.total)
		throw new Error('Source payload is missing daily data');
	return data;
}

export function retainTodayMail(
	data: FeedData,
	previous?: FeedData,
	today = floridaClock().today
): FeedData {
	if (data.mailDays.some((d) => d.date === today && d.total > 0)) return data;
	const reported =
		previous?.mailDays.find((d) => d.date === today && d.total > 0) ??
		(previous?.lastReportedMail?.date === today ? previous.lastReportedMail : undefined);
	if (!reported) return data;
	return {
		...data,
		lastReportedMail: { ...reported, retained: true }
	};
}

const RETRY_DELAYS_MS = [1500, 3000, 5000];
const ATTEMPT_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 20_000;

const KV_CHECK_INTERVAL_MS = 10_000;

let inflight: Promise<FeedData> | null = null;
let kvRead: Promise<Snapshot | null> | null = null;
let lastKvCheck = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isFresh = (s: Snapshot | null) => !!s && Date.now() - s.at < TTL_MS;

async function fetchOnce(timeoutMs: number): Promise<FeedData> {
	const res = await fetch(SOURCE_URL, {
		headers: { 'user-agent': 'Mozilla/5.0 (fl-voting-estimations)', accept: 'text/html' },
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`Source responded ${res.status}`);
	return extractFeed(await res.text());
}

async function fetchWithRetry(): Promise<FeedData> {
	const deadline = Date.now() + TOTAL_BUDGET_MS;
	let lastError: unknown;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		const left = deadline - Date.now();
		if (left < 1000) break;
		try {
			return await fetchOnce(Math.min(ATTEMPT_TIMEOUT_MS, left));
		} catch (e) {
			lastError =
				(e as Error).name === 'TimeoutError' ? new Error('Source timed out') : (e as Error);
			const wait = RETRY_DELAYS_MS[attempt];
			if (wait !== undefined && deadline - Date.now() > wait + 1000) await sleep(wait);
		}
	}
	throw lastError ?? new Error('Source timed out');
}

async function refresh(): Promise<FeedData> {
	try {
		const data = retainTodayMail(await fetchWithRetry(), cache?.data);
		cache = { at: Date.now(), data };
		return data;
	} catch (e) {
		const fallback = cache ?? (await loadSnapshot());
		if (!fallback) throw e;
		const data = { ...fallback.data, stale: (e as Error).message };
		cache = { at: Date.now() - TTL_MS + 30_000, data };
		return data;
	}
}

export async function refreshSnapshot(): Promise<void> {
	const started = Date.now();
	try {
		const previous = await loadSnapshot();
		const data = retainTodayMail(await fetchWithRetry(), previous?.data ?? cache?.data);
		const snapshot = { at: Date.now(), data };
		await saveSnapshot(snapshot);
		cache = snapshot;
		console.log({
			event: 'feed_refresh',
			outcome: 'success',
			duration_ms: Date.now() - started,
			source_updated_at: data.fetchedAt,
			ipev_votes: data.early.total,
			mail_votes: data.mail.total,
			kv_writes: 1
		});
	} catch (error) {
		console.error({
			event: 'feed_refresh',
			outcome: 'error',
			duration_ms: Date.now() - started,
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}

function startRefresh(): Promise<FeedData> {
	inflight ??= refresh().finally(() => (inflight = null));
	return inflight;
}

export async function getFeed(): Promise<FeedData> {
	if (cache && isFresh(cache)) return cache.data;

	if (!cache || Date.now() - lastKvCheck >= KV_CHECK_INTERVAL_MS) {
		lastKvCheck = Date.now();
		kvRead ??= loadSnapshot().finally(() => (kvRead = null));
		const stored = await kvRead;
		if (stored && (!cache || stored.at > cache.at)) {
			cache = { ...stored, data: retainTodayMail(stored.data, cache?.data) };
		}
		if (cache && isFresh(cache)) return cache.data;
	}

	if (!cache) return startRefresh();
	runInBackground(startRefresh().catch(() => undefined));
	return cache.data;
}
