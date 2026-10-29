import { addCounts, ZERO, type EdSnapshot, type EdState } from './election.ts';
import { ELECTION_DAY, marginOf } from './model.ts';
import { countedMix, raceMargin, tallyRaces, type ResultRow } from './results.ts';
import { electionClock } from './election-clock.ts';
import type { County, FeedData, PartyCounts } from './types.ts';

export const ELECTION_REGISTRATION = {
	rep: 5_687_032,
	dem: 4_146_172,
	total: 13_704_495,
	asOf: '2026-10-05',
	source: 'https://dos.fl.gov/media/711452/1-party-by-county.pdf'
};

export interface SourceHealth {
	url: string;
	checkedAt: number;
	acceptedAt: number | null;
	updatedAt: string | null;
	error: string | null;
}

export interface CountyReporting {
	code: string;
	turnout: number;
	registered: number;
	precinctsComplete: boolean;
	mailComplete: boolean;
	earlyComplete: boolean;
	provisionalComplete: boolean;
	overseasComplete: boolean;
}

export interface NightObservation {
	race: string;
	name: string;
	minute: number;
	counted: number;
	margin: number;
	registration: number;
}

export interface Baseline {
	at: number;
	mail: PartyCounts;
	early: PartyCounts;
}

export interface ElectionRecord {
	sources: { turnout: SourceHealth; results: SourceHealth; reporting: SourceHealth };
	results: ResultRow[];
	reporting: CountyReporting[];
	history: EdSnapshot[];
	night: NightObservation[];
	baseline: Baseline | null;
	warnings: string[];
	corrections?: { at: number; source: 'turnout' | 'results'; before: number; after: number }[];
}

export interface ElectionSnapshot {
	at: number;
	data: FeedData;
	election: ElectionRecord;
}

export function turnoutIsFinal(snapshot: ElectionSnapshot, now: Date): boolean {
	if (electionClock(now).phase !== 'closed') return false;
	return (
		!snapshot.data.partial &&
		(snapshot.data.received === undefined || snapshot.data.received === 67) &&
		snapshot.data.counties.length === 67 &&
		snapshot.election.reporting.length === 67 &&
		snapshot.election.reporting.every((r) => {
			const c = snapshot.data.counties.find((c) => c.code === r.code);
			return (
				c &&
				r.precinctsComplete &&
				r.earlyComplete &&
				r.mailComplete &&
				Math.abs(r.turnout - addCounts(c.early, c.mail, c.eday ?? ZERO).total) <= 1
			);
		}) &&
		!snapshot.election.warnings.some((w) => /totals differ/.test(w)) &&
		['turnout', 'reporting'].every((name) => {
			const at = snapshot.election.sources[name as 'turnout' | 'reporting'].acceptedAt;
			return at !== null && now.getTime() - at < 20 * 60_000;
		}) &&
		!snapshot.election.sources.turnout.error &&
		!snapshot.election.sources.reporting.error
	);
}

export function electionState(snapshot: ElectionSnapshot, now = new Date()): EdState {
	const c = electionClock(now);
	const feed = snapshot.data;
	return {
		minute: c.minute,
		phase: c.phase,
		counties: feed.counties,
		early: feed.early,
		mail: feed.mail,
		evMail: snapshot.election.baseline?.mail ?? feed.mail,
		eday: feed.eday ?? addCounts(...feed.counties.map((c) => c.eday ?? ZERO)),
		history: snapshot.election.history,
		turnoutFinal: turnoutIsFinal(snapshot, now),
		completedCounties: snapshot.election.reporting
			.filter((r) => {
				const county = feed.counties.find((c) => c.code === r.code);
				return (
					county &&
					r.precinctsComplete &&
					r.earlyComplete &&
					r.mailComplete &&
					Math.abs(r.turnout - addCounts(county.early, county.mail, county.eday ?? ZERO).total) <= 1
				);
			})
			.map((r) => r.code),
		registration: ELECTION_REGISTRATION,
		lateMailEstimate: snapshot.election.baseline !== null
	};
}

export function observations(snapshot: ElectionSnapshot, now: Date): ElectionRecord {
	const at = now.getTime();
	const record = snapshot.election;
	const minute = electionClock(now).minute;
	const baseline = record.baseline;
	let history = record.history;
	if (minute >= 7 * 60 && minute < 24 * 60 && record.sources.turnout.acceptedAt === at) {
		const point: EdSnapshot = {
			minute,
			eday: snapshot.data.eday ?? ZERO,
			mail: snapshot.data.mail,
			counties: snapshot.data.counties.map(({ code, eday, updated, edayUpdated }) => ({
				code,
				eday,
				updated,
				edayUpdated
			}))
		};
		const points = new Map(history.map((p) => [Math.floor(p.minute / 3), p]));
		points.set(Math.floor(minute / 3), point);
		const coarse = new Map<number, EdSnapshot>();
		for (const p of [...points.values()].sort((a, b) => a.minute - b.minute)) {
			const bucket = Math.floor(p.minute / 30);
			if (p.minute < minute - 120 && !coarse.has(bucket)) coarse.set(bucket, p);
		}
		history = [
			...coarse.values(),
			...[...points.values()].filter((p) => p.minute >= minute - 120)
		].slice(-80);
	}
	let night = record.night;
	if (
		minute >= 20 * 60 &&
		!snapshot.data.partial &&
		(snapshot.data.received === undefined || snapshot.data.received === 67) &&
		record.sources.results.acceptedAt === at &&
		!record.sources.turnout.error &&
		record.sources.turnout.acceptedAt !== null &&
		at - record.sources.turnout.acceptedAt < 20 * 60_000 &&
		!record.warnings.some((w) => /totals differ/.test(w))
	) {
		const all = addCounts(snapshot.data.early, snapshot.data.mail, snapshot.data.eday ?? ZERO);
		const points = tallyRaces(record.results)
			.filter(
				(r) =>
					r.total &&
					r.total <= all.total * 1.005 &&
					['GOV', 'USS', 'ATG', 'CFO', 'AGR'].includes(r.race)
			)
			.map((r) => ({
				race: r.race,
				name: r.name,
				minute,
				counted: all.total ? Math.min(100, (r.total / all.total) * 100) : 0,
				margin: raceMargin(r),
				registration: marginOf(countedMix(snapshot.data.counties, r))
			}));
		const bucket = (minute: number) =>
			minute < 1440 ? Math.floor(minute / 15) : 96 + Math.floor(minute / 1440);
		const buckets = new Map(night.map((p) => [`${p.race}|${bucket(p.minute)}`, p]));
		for (const p of points) buckets.set(`${p.race}|${bucket(p.minute)}`, p);
		const ordered = [...buckets.values()].sort((a, b) => a.minute - b.minute);
		night = [
			...ordered.filter((p) => p.minute < 1440),
			...ordered.filter((p) => p.minute >= 1440).slice(-500)
		];
	}
	return { ...record, baseline, history, night };
}

export function reconcileCounties(incoming: FeedData, previous: FeedData | undefined): FeedData {
	return {
		...incoming,
		counties: incoming.counties.map((c): County => {
			const old = previous?.counties.find((p) => p.code === c.code);
			if (c.status && !['live', 'ok'].includes(c.status) && old)
				return { ...old, status: c.status };
			const same =
				old &&
				['rep', 'dem', 'npa', 'oth', 'total'].every(
					(k) => old.eday?.[k as keyof PartyCounts] === c.eday?.[k as keyof PartyCounts]
				);
			return { ...c, edayUpdated: same ? old.edayUpdated : c.eday?.total ? c.updated : undefined };
		})
	};
}

export const ELECTION_ID = ELECTION_DAY;
