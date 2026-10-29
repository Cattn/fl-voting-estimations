import { ELECTION_DAY, marginOf, REGISTRATION } from './model.ts';
import type { County, PartyCounts } from './types.ts';

export type Phase = 'pre' | 'open' | 'closed';

export const POLLS_OPEN = 7 * 60;
export const POLLS_CLOSE = 19 * 60;
export const RESULTS_START = 20 * 60;
export const LATE_MAIL = { total: 200_000, margin: 10 };

export const CENTRAL_COUNTIES = new Set([
	'BAY',
	'CAL',
	'ESC',
	'HOL',
	'JAC',
	'OKA',
	'SAN',
	'WAL',
	'WAS'
]);

export const ZERO: PartyCounts = { rep: 0, dem: 0, npa: 0, oth: 0, total: 0 };

export const addCounts = (...rows: PartyCounts[]): PartyCounts =>
	rows.reduce(
		(a, r) => ({
			rep: a.rep + r.rep,
			dem: a.dem + r.dem,
			npa: a.npa + r.npa,
			oth: a.oth + r.oth,
			total: a.total + r.total
		}),
		ZERO
	);

export const scaleCounts = (r: PartyCounts, k: number): PartyCounts => ({
	rep: r.rep * k,
	dem: r.dem * k,
	npa: r.npa * k,
	oth: r.oth * k,
	total: r.total * k
});

export const gapOf = (r: PartyCounts) => r.dem - r.rep;

const DAY_CURVE = [
	0, 0.045, 0.09, 0.13, 0.17, 0.21, 0.25, 0.29, 0.33, 0.37, 0.41, 0.45, 0.49, 0.52, 0.55, 0.57, 0.6,
	0.63, 0.67, 0.72, 0.77, 0.82, 0.87, 0.92, 0.97, 1
];

export function dayShare(localMinute: number): number {
	const steps = ((localMinute - POLLS_OPEN) / (POLLS_CLOSE - POLLS_OPEN)) * (DAY_CURVE.length - 1);
	if (steps <= 0) return 0;
	if (steps >= DAY_CURVE.length - 1) return 1;
	const i = Math.floor(steps);
	return DAY_CURVE[i] + (DAY_CURVE[i + 1] - DAY_CURVE[i]) * (steps - i);
}

export const localMinute = (code: string, etMinute: number) =>
	CENTRAL_COUNTIES.has(code) ? etMinute - 60 : etMinute;

export function phaseAt(etMinute: number): Phase {
	if (etMinute < POLLS_OPEN) return 'pre';
	return etMinute < POLLS_CLOSE + 60 ? 'open' : 'closed';
}

export const fmtClock = (etMinute: number) => {
	const m = ((Math.round(etMinute) % 1440) + 1440) % 1440;
	const h = Math.floor(m / 60);
	const mm = String(m % 60).padStart(2, '0');
	return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
};

export interface Preset {
	id: string;
	label: string;
	rep: number;
	dem: number;
	oth: number;
}

export const PRESETS: Preset[] = [
	{ id: 'strong-r', label: 'Strong R', rep: 0.47, dem: 0.265, oth: 0.26 },
	{ id: 'lean-r', label: 'Lean R', rep: 0.44, dem: 0.28, oth: 0.265 },
	{ id: 'middle', label: 'Middle', rep: 0.41, dem: 0.295, oth: 0.27 },
	{ id: 'lean-d', label: 'Lean D', rep: 0.38, dem: 0.31, oth: 0.275 },
	{ id: 'strong-d', label: 'Strong D', rep: 0.34, dem: 0.32, oth: 0.28 }
];

export const DEFAULT_PRESET = 'middle';

export interface EdSnapshot {
	minute: number;
	eday: PartyCounts;
	mail: PartyCounts;
	counties?: Pick<County, 'code' | 'eday' | 'updated' | 'edayUpdated'>[];
}

export interface EdState {
	minute: number;
	phase: Phase;
	counties: County[];
	early: PartyCounts;
	mail: PartyCounts;
	evMail: PartyCounts;
	eday: PartyCounts;
	history: EdSnapshot[];
	turnoutFinal?: boolean;
	completedCounties?: string[];
	registration?: { rep: number; dem: number; total: number };
	lateMailEstimate?: boolean;
}

export function notYetVoted(s: EdState): { rep: number; dem: number; oth: number } {
	const voted = addCounts(s.early, s.mail);
	const registered = s.registration ?? REGISTRATION;
	const rep = Math.max(0, registered.rep - voted.rep);
	const dem = Math.max(0, registered.dem - voted.dem);
	const oth = Math.max(
		0,
		registered.total - registered.rep - registered.dem - voted.npa - voted.oth
	);
	return { rep, dem, oth };
}

const fromShares = (pool: { rep: number; dem: number; oth: number }, p: Preset): PartyCounts => {
	const rep = pool.rep * p.rep;
	const dem = pool.dem * p.dem;
	const npa = pool.oth * p.oth;
	return { rep, dem, npa, oth: 0, total: rep + dem + npa };
};

export function presetTurnout(s: EdState, id: string): PartyCounts {
	const estimates = turnoutEstimates(s);
	return (
		estimates.presets.find((p) => p.id === id) ??
		estimates.presets.find((p) => p.id === DEFAULT_PRESET)!
	).turnout;
}

export interface LiveEstimate {
	turnout: PartyCounts;
	weight: number;
}

export function liveTurnout(s: EdState): LiveEstimate {
	return turnoutEstimates(s).live;
}

export interface TurnoutEstimates {
	live: LiveEstimate;
	presets: { id: string; turnout: PartyCounts }[];
	coverage: number;
	instability: number;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const turnoutKeys = ['rep', 'dem', 'npa'] as const;
const otherCombined = (p: PartyCounts): PartyCounts => ({ ...p, npa: p.npa + p.oth, oth: 0 });

const turnoutClock = new Intl.DateTimeFormat('en-US', {
	timeZone: 'America/New_York',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

const clockParts = (iso: string) =>
	Object.fromEntries(turnoutClock.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));

const reportMinute = (updated: string | undefined, minute: number) => {
	if (!updated || !Number.isFinite(Date.parse(updated))) return minute;
	const parts = clockParts(updated);
	const date = `${parts.year}-${parts.month}-${parts.day}`;
	if (date !== ELECTION_DAY) return date < ELECTION_DAY ? POLLS_OPEN : minute;
	return Math.min(minute, Number(parts.hour) * 60 + Number(parts.minute));
};

export function turnoutEstimates(s: EdState): TurnoutEstimates {
	const pool = notYetVoted(s);
	const observed = otherCombined(s.eday);
	const capacity = { rep: pool.rep, dem: pool.dem, npa: pool.oth };
	const bound = (counts: PartyCounts) => {
		const result = otherCombined(counts);
		for (const k of turnoutKeys)
			result[k] = Math.max(observed[k], Math.min(Math.max(observed[k], capacity[k]), result[k]));
		result.total = result.rep + result.dem + result.npa;
		return result;
	};
	const priors = PRESETS.map((p) => ({ id: p.id, turnout: fromShares(pool, p) }));
	const middle = priors.find((p) => p.id === DEFAULT_PRESET)!.turnout;
	if (s.phase === 'closed' && s.turnoutFinal !== false)
		return {
			live: { turnout: s.eday, weight: 1 },
			presets: priors.map((p) => ({ ...p, turnout: s.eday })),
			coverage: 1,
			instability: 0
		};
	if (s.phase === 'pre' || !s.eday.total)
		return {
			live: { turnout: middle, weight: 0 },
			presets: priors,
			coverage: 0,
			instability: 0
		};

	const counties = s.counties;
	if (!counties.length) {
		const presets = priors.map((p) => ({ ...p, turnout: bound(p.turnout) }));
		return { live: { turnout: bound(middle), weight: 0 }, presets, coverage: 0, instability: 0 };
	}
	const early = otherCombined(addCounts(...counties.map((c) => addCounts(c.early, c.mail))));
	const registered = counties.reduce((sum, c) => sum + c.registered, 0);
	const weights = counties.map((c) => {
		const voted = otherCombined(addCounts(c.early, c.mail));
		const fallback = registered ? c.registered / registered : 1 / Math.max(1, counties.length);
		return Object.fromEntries(
			turnoutKeys.map((k) => [k, early[k] ? voted[k] / early[k] : fallback])
		) as Record<(typeof turnoutKeys)[number], number>;
	});
	const countyPriors = weights.map((w) => ({
		...ZERO,
		rep: middle.rep * w.rep,
		dem: middle.dem * w.dem,
		npa: middle.npa * w.npa,
		total: middle.rep * w.rep + middle.dem * w.dem + middle.npa * w.npa
	}));
	const recent = [
		...s.history.filter((h) => h.minute < s.minute),
		{ minute: s.minute, eday: s.eday, mail: s.mail, counties: s.counties }
	]
		.filter((h) => h.minute <= s.minute && h.minute >= s.minute - 120 && h.eday.total > 0)
		.sort((a, b) => a.minute - b.minute)
		.filter(
			(h, i, rows) =>
				!i ||
				turnoutKeys.some((k) => otherCombined(h.eday)[k] !== otherCombined(rows[i - 1].eday)[k])
		);
	const projected = recent.flatMap((h) => {
		let total = ZERO;
		const reporting: string[] = [];
		if (h.counties) {
			for (const c of h.counties) {
				const share = dayShare(
					localMinute(c.code, reportMinute(c.edayUpdated ?? c.updated, h.minute))
				);
				if (share >= 0.1 && (c.eday?.total ?? 0) > 0) {
					total = addCounts(total, scaleCounts(otherCombined(c.eday ?? ZERO), 1 / share));
					reporting.push(c.code);
				}
			}
		} else {
			const share =
				counties.reduce(
					(sum, c, i) => sum + dayShare(localMinute(c.code, h.minute)) * countyPriors[i].total,
					0
				) / Math.max(1, middle.total);
			if (share >= 0.1) {
				total = scaleCounts(otherCombined(h.eday), 1 / share);
				reporting.push('ALL');
			}
		}
		return total.total ? [{ minute: h.minute, total, reporting: reporting.sort().join('|') }] : [];
	});
	let instability = 0;
	for (let i = 1; i < projected.length; i++) {
		const current = projected[i];
		const previous = projected[i - 1];
		if (current.reporting !== previous.reporting) continue;
		const change =
			turnoutKeys.reduce((sum, k) => sum + Math.abs(current.total[k] - previous.total[k]), 0) /
			Math.max(1, previous.total.total, middle.total * 0.25);
		const interval = Math.max(0.5, (current.minute - previous.minute) / 30);
		instability = Math.max(
			instability,
			clamp((change / interval - 0.01) / 0.08) * Math.exp(-(s.minute - current.minute) / 60)
		);
	}
	const support = 0.5 + 0.5 * clamp((projected.length - 1) / 3);
	let influence = 0;
	let coverage = 0;
	const residuals = counties.map((c, i) => {
		const votes = otherCombined(c.eday ?? ZERO);
		const updated = c.edayUpdated ?? c.updated;
		const at = reportMinute(updated, s.minute);
		const share = dayShare(localMinute(c.code, at));
		const validTime = !!updated && Number.isFinite(Date.parse(updated));
		const freshness = (validTime ? 1 : 0.5) * Math.exp(-Math.max(0, s.minute - at - 30) / 90);
		const countyReports = recent.flatMap(
			(h) => h.counties?.filter((r) => r.code === c.code && (r.eday?.total ?? 0) > 0) ?? []
		);
		const distinctReports = countyReports.filter(
			(r, j) =>
				!j ||
				turnoutKeys.some(
					(k) =>
						otherCombined(r.eday ?? ZERO)[k] !== otherCombined(countyReports[j - 1].eday ?? ZERO)[k]
				)
		).length;
		const countySupport = countyReports.length
			? 0.5 + 0.5 * clamp((distinctReports - 1) / 3)
			: support;
		const weight =
			votes.total && share > 0 ? (1 - (1 - share) ** 2) * freshness * countySupport : 0;
		influence += countyPriors[i].total * weight;
		coverage += votes.total && share > 0 ? countyPriors[i].total * freshness : 0;
		const remaining = { ...ZERO };
		const liveRemaining = { ...ZERO };
		const complete = s.completedCounties?.includes(c.code) ?? false;
		const pending = s.phase === 'closed' && s.turnoutFinal === false && !complete;
		for (const k of turnoutKeys) {
			const priorLeft = Math.max(0, countyPriors[i][k] - votes[k]);
			const paceLeft =
				share > 0 && !(pending && share >= 1) ? (votes[k] * (1 - share)) / share : priorLeft;
			remaining[k] =
				complete || (share >= 1 && validTime && !pending)
					? 0
					: weight * paceLeft + (1 - weight) * priorLeft;
			liveRemaining[k] = complete
				? 0
				: votes.total && share >= 0.05 && validTime
					? paceLeft
					: priorLeft;
		}
		return { remaining, liveRemaining, uncertainty: 1 - 0.75 * weight + 4 * instability * weight };
	});
	const presets = priors.map((p) => {
		const turnout = { ...observed };
		for (const k of turnoutKeys) {
			const deviation = middle[k] ? p.turnout[k] / middle[k] - 1 : 0;
			turnout[k] += residuals.reduce(
				(sum, r) => sum + r.remaining[k] * Math.max(0, 1 + deviation * r.uncertainty),
				0
			);
		}
		return { id: p.id, turnout: bound(turnout) };
	});
	const live = { ...observed };
	for (const k of turnoutKeys) live[k] += residuals.reduce((sum, r) => sum + r.liveRemaining[k], 0);
	return {
		live: { turnout: bound(live), weight: clamp(influence / Math.max(1, middle.total)) },
		presets,
		coverage: clamp(coverage / Math.max(1, middle.total)),
		instability
	};
}

export function minuteOfDay(iso: string): number {
	const parts = clockParts(iso);
	return Number(parts.hour) * 60 + Number(parts.minute);
}

export function lateMailRemaining(s: EdState): PartyCounts {
	if (s.lateMailEstimate === false) return ZERO;
	const arrived = Math.max(0, s.mail.total - s.evMail.total);
	const left = s.minute >= POLLS_CLOSE + 60 ? 0 : Math.max(0, LATE_MAIL.total - arrived);
	const dem = (left * (0.42 + LATE_MAIL.margin / 200)) | 0;
	const rep = (left * (0.42 - LATE_MAIL.margin / 200)) | 0;
	return { rep, dem, npa: left - rep - dem, oth: 0, total: left };
}

export interface EdOutcome {
	turnout: PartyCounts;
	rest: PartyCounts;
	mailLeft: PartyCounts;
	final: { total: number; gap: number; margin: number };
	needed: number | null;
	restMargin: number;
	sofarMargin: number;
	share: number;
}

export function edOutcome(s: EdState, turnout: PartyCounts, target: number): EdOutcome {
	const mailLeft = lateMailRemaining(s);
	const rest = {
		rep: Math.max(0, turnout.rep - s.eday.rep),
		dem: Math.max(0, turnout.dem - s.eday.dem),
		npa: Math.max(0, turnout.npa + turnout.oth - s.eday.npa - s.eday.oth),
		oth: 0,
		total: 0
	};
	if (s.phase === 'closed' && s.turnoutFinal !== false)
		Object.assign(rest, { rep: 0, dem: 0, npa: 0 });
	rest.total = rest.rep + rest.dem + rest.npa;
	const known = addCounts(s.early, s.mail, mailLeft, s.eday);
	const total = known.total + rest.total;
	const gap = gapOf(known) + gapOf(rest);
	const needed = rest.total ? (((target / 100) * total - gapOf(known)) / rest.total) * 100 : null;
	return {
		turnout: addCounts(s.eday, rest),
		rest,
		mailLeft,
		final: { total, gap, margin: total ? (gap / total) * 100 : 0 },
		needed,
		restMargin: marginOf(rest),
		sofarMargin: marginOf(s.eday),
		share: s.eday.total / Math.max(1, s.eday.total + rest.total)
	};
}

export interface DayPoint {
	minute: number;
	margin: number;
}

export function dayPaths(
	s: EdState,
	o: EdOutcome
): { reported: DayPoint[]; path: DayPoint[]; live: DayPoint[] } {
	const total = (eday: PartyCounts, mail: PartyCounts) => marginOf(addCounts(s.early, mail, eday));
	const reported = s.history.map((h) => ({ minute: h.minute, margin: total(h.eday, h.mail) }));
	if (s.phase !== 'open') return { reported, path: [], live: [] };
	const countyWeights = s.counties.map((c) => c.early.total + c.mail.total || c.registered);
	const countyTotal = countyWeights.reduce((sum, n) => sum + n, 0);
	const shareAt = (minute: number) =>
		countyTotal
			? s.counties.reduce(
					(sum, c, i) => sum + countyWeights[i] * dayShare(localMinute(c.code, minute)),
					0
				) / countyTotal
			: dayShare(minute);
	const startShare = shareAt(s.minute);
	const project = (margin: number) => {
		const out: DayPoint[] = [{ minute: s.minute, margin: total(s.eday, s.mail) }];
		for (let m = Math.ceil((s.minute + 1) / 30) * 30; m <= POLLS_CLOSE + 60; m += 30) {
			const f = startShare >= 1 ? 1 : Math.min(1, (shareAt(m) - startShare) / (1 - startShare));
			const ed = o.rest.total * (m >= POLLS_CLOSE + 60 ? 1 : f);
			const mailK =
				m >= RESULTS_START ? 1 : Math.min(1, (m - s.minute) / (RESULTS_START - s.minute));
			const add = {
				rep: (ed * (100 - margin)) / 200,
				dem: (ed * (100 + margin)) / 200,
				npa: 0,
				oth: 0,
				total: ed
			};
			const mail = addCounts(s.mail, scaleCounts(o.mailLeft, mailK));
			const all = addCounts(s.early, mail, s.eday, add);
			out.push({ minute: m, margin: marginOf(all) });
		}
		return out;
	};
	return {
		reported,
		path: o.needed === null || Math.abs(o.needed) > 100 ? [] : project(o.needed),
		live: project(o.restMargin)
	};
}

export interface HalfHourRow {
	minute: number;
	added: PartyCounts;
	sofar: PartyCounts;
	totalMargin: number;
	needed: number | null;
}

export function halfHourRows(s: EdState, turnout: PartyCounts, target: number): HalfHourRow[] {
	const rows: HalfHourRow[] = [];
	const buckets = new Map<number, EdSnapshot>();
	for (const h of s.history)
		if (!buckets.has(Math.floor(h.minute / 30))) buckets.set(Math.floor(h.minute / 30), h);
	const history = [...buckets.values()];
	for (let i = 1; i < history.length; i++) {
		const h = history[i];
		const prev = history[i - 1];
		const added = addCounts(h.eday, scaleCounts(prev.eday, -1));
		const at: EdState = {
			...s,
			minute: h.minute,
			phase: phaseAt(h.minute),
			eday: h.eday,
			mail: h.mail
		};
		const o = edOutcome(at, turnout, target);
		rows.push({
			minute: h.minute,
			added,
			sofar: h.eday,
			totalMargin: marginOf(addCounts(s.early, h.mail, h.eday)),
			needed: o.rest.total > 0.03 * o.turnout.total ? o.needed : null
		});
	}
	return rows.reverse();
}
