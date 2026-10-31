import { electionClock, UI_SWITCH_AT } from '../election-clock.ts';
import {
	observations,
	reconcileCounties,
	type ElectionRecord,
	type ElectionSnapshot,
	type SourceHealth
} from '../live.ts';
import { RESULTS_URL } from '../results.ts';
import type { FeedData } from '../types.ts';
import { carryRegistration, fetchWithRetry, getFeed, retainTodayMail, SOURCE_URL } from './feed.ts';
import {
	fetchResults,
	parseReporting,
	REPORTING_URL,
	validateTurnout
} from './election-sources.ts';
import { sourceText } from './http.ts';
import { COLLECTION_INTERVAL, loadElectionDatabase, persistElection } from './election-store.ts';
import { loadSnapshot, runInBackground } from './store.ts';

let cache: ElectionSnapshot | null = null;
let reading: Promise<ElectionSnapshot> | null = null;
let checkedAt = 0;
const health = (url: string): SourceHealth => ({
	url,
	checkedAt: 0,
	acceptedAt: null,
	updatedAt: null,
	error: null
});

export function emptyElection(): ElectionRecord {
	return {
		sources: {
			turnout: health(SOURCE_URL),
			results: health(RESULTS_URL),
			reporting: health(REPORTING_URL)
		},
		results: [],
		reporting: [],
		history: [],
		night: [],
		baseline: null,
		warnings: []
	};
}

const mergeDays = <T extends { date: string }>(incoming: T[], previous: T[] = []): T[] =>
	[...new Map([...previous, ...incoming].map((p) => [p.date, p])).values()].sort((a, b) =>
		a.date.localeCompare(b.date)
	);

export async function collectElection(
	previous: ElectionSnapshot | null,
	now = new Date(),
	initial?: FeedData
): Promise<ElectionSnapshot> {
	const at = now.getTime();
	const old = previous?.election ?? emptyElection();
	const record: ElectionRecord = {
		...old,
		sources: structuredClone(old.sources),
		corrections: [...(old.corrections ?? [])],
		warnings: []
	};
	const correction = (source: 'turnout' | 'results', before: number, after: number) => {
		if (after >= before) return;
		record.corrections = [...(record.corrections ?? []), { at, source, before, after }].slice(-64);
		record.warnings.push(`The ${source} source has posted a downward correction.`);
	};
	const jobs = await Promise.allSettled([
		initial ? Promise.resolve(initial) : fetchWithRetry(),
		fetchResults(now),
		sourceText(REPORTING_URL)
	]);
	let feed = previous?.data;
	const failures: string[] = [];
	for (const name of ['turnout', 'results', 'reporting'] as const)
		record.sources[name].checkedAt = at;
	const fail = (name: keyof ElectionRecord['sources'], e: unknown) => {
		const message = e instanceof Error ? e.message : String(e);
		record.sources[name].error = message;
		failures.push(`${name}: ${message}`);
	};
	const turnout = jobs[0];
	if (turnout.status === 'fulfilled') {
		try {
			turnout.value = carryRegistration(turnout.value, feed);
			record.warnings.push(...validateTurnout(turnout.value, now));
			if (feed && Date.parse(turnout.value.fetchedAt) < Date.parse(feed.fetchedAt))
				throw new Error('Turnout response is older than the saved snapshot');
			if (feed?.eday?.total && !turnout.value.eday?.total && electionClock(now).minute >= 7 * 60)
				throw new Error('Election Day totals unexpectedly reset');
			feed = reconcileCounties(
				retainTodayMail(
					{
						...turnout.value,
						earlyDays: mergeDays(turnout.value.earlyDays, feed?.earlyDays),
						mailDays: mergeDays(turnout.value.mailDays, feed?.mailDays)
					},
					feed,
					electionClock(now).date
				),
				feed
			);
			record.warnings.push(...validateTurnout(feed, now));
			record.sources.turnout = {
				url: SOURCE_URL,
				checkedAt: at,
				acceptedAt: at,
				updatedAt: feed.fetchedAt,
				error: null
			};
		} catch (e) {
			fail('turnout', e);
		}
	} else fail('turnout', turnout.reason);
	if (!feed) throw new Error(`No usable turnout snapshot: ${failures.join('; ')}`);
	const results = jobs[1];
	if (results.status === 'fulfilled') {
		try {
			if (old.results.some((r) => r.votes) && !results.value.rows.some((r) => r.votes))
				throw new Error('Results unexpectedly reset to zero');
			const modified = results.value.updated;
			if (
				modified &&
				old.sources.results.updatedAt &&
				Date.parse(modified) < Date.parse(old.sources.results.updatedAt)
			)
				throw new Error('Results response is older than the saved snapshot');
			record.results = results.value.rows;
			correction(
				'results',
				old.results.reduce((sum, r) => sum + r.votes, 0),
				record.results.reduce((sum, r) => sum + r.votes, 0)
			);
			record.sources.results = {
				url: results.value.url,
				checkedAt: at,
				acceptedAt: at,
				updatedAt: modified,
				error: null
			};
		} catch (e) {
			fail('results', e);
		}
	} else fail('results', results.reason);
	const reporting = jobs[2];
	if (reporting.status === 'fulfilled') {
		try {
			record.reporting = parseReporting(reporting.value.text, feed);
			record.sources.reporting = {
				url: REPORTING_URL,
				checkedAt: at,
				acceptedAt: at,
				updatedAt: reporting.value.modified,
				error: null
			};
		} catch (e) {
			fail('reporting', e);
		}
	} else fail('reporting', reporting.reason);
	if (
		!record.baseline &&
		at >= UI_SWITCH_AT &&
		previous?.election.sources.turnout.acceptedAt &&
		previous.election.sources.turnout.acceptedAt < UI_SWITCH_AT &&
		previous.election.sources.turnout.acceptedAt >= UI_SWITCH_AT - 30 * 60_000
	)
		record.baseline = {
			at: previous.election.sources.turnout.acceptedAt,
			early: previous.data.early,
			mail: previous.data.mail
		};
	if (at >= UI_SWITCH_AT && !record.baseline)
		record.warnings.push(
			'The end-of-early-voting mail baseline is unavailable; late-mail estimates are paused.'
		);
	if (feed.counties.some((c) => c.status && !['live', 'ok'].includes(c.status)))
		record.warnings.push('Some counties are using delayed turnout reports.');
	if (previous)
		correction(
			'turnout',
			previous.data.early.total + previous.data.mail.total + (previous.data.eday?.total ?? 0),
			feed.early.total + feed.mail.total + (feed.eday?.total ?? 0)
		);
	record.warnings.push(...failures.map((f) => `${f}. Last accepted data is retained.`));
	const snapshot = { at, data: feed, election: record };
	snapshot.election = observations(snapshot, now);
	return snapshot;
}

export async function refreshElectionSnapshot(now = new Date()): Promise<void> {
	const started = Date.now();
	try {
		const previous = await loadPrevious();
		const bucket = Math.floor(now.getTime() / COLLECTION_INTERVAL);
		if (previous && Math.floor(previous.at / COLLECTION_INTERVAL) >= bucket) return;
		const next = await collectElection(previous, now);
		if (await persistElection(next, previous?.at ?? null)) cache = next;
		console.log({
			event: 'election_refresh',
			outcome: 'success',
			duration_ms: Date.now() - started,
			sources: Object.fromEntries(
				Object.entries(next.election.sources).map(([k, v]) => [k, !v.error])
			),
			warnings: next.election.warnings.length
		});
	} catch (e) {
		console.error({
			event: 'election_refresh',
			outcome: 'error',
			duration_ms: Date.now() - started,
			error: (e as Error).message
		});
		throw e;
	}
}

async function loadPrevious(): Promise<ElectionSnapshot | null> {
	const authoritative = await loadElectionDatabase();
	if (authoritative) return authoritative;
	const stored = await loadSnapshot();
	if (!stored) return null;
	const election = stored.election ?? emptyElection();
	if (!stored.election)
		election.sources.turnout = {
			url: SOURCE_URL,
			checkedAt: stored.at,
			acceptedAt: stored.at,
			updatedAt: stored.data.fetchedAt,
			error: null
		};
	return { ...stored, election };
}

async function readElection(): Promise<ElectionSnapshot> {
	checkedAt = Date.now();
	const stored = await loadSnapshot();
	if (stored?.election && (!cache || stored.at > cache.at))
		cache = { ...stored, election: stored.election };
	if (stored?.election) return cache!;
	const authoritative = await loadElectionDatabase();
	if (authoritative) return (cache = authoritative);
	if (cache) return (cache = await collectElection(cache));
	if (stored) {
		const election = emptyElection();
		election.sources.turnout = {
			url: SOURCE_URL,
			checkedAt: stored.at,
			acceptedAt: stored.at,
			updatedAt: stored.data.fetchedAt,
			error: null
		};
		return (cache = await collectElection({ ...stored, election }));
	}
	return (cache = await collectElection(null, new Date(), await getFeed()));
}

export async function getElectionSnapshot(): Promise<ElectionSnapshot> {
	if (cache && Date.now() - checkedAt < COLLECTION_INTERVAL) return cache;
	reading ??= readElection().finally(() => (reading = null));
	if (cache) {
		runInBackground(reading.catch(() => undefined));
		return cache;
	}
	return reading;
}
