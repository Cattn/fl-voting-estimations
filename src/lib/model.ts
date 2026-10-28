import type { DayCounts, FeedData, Forecast, ForecastDay, PartyCounts } from './types.ts';

export const EV_END = '2026-11-01';
export const ELECTION_DAY = '2026-11-03';
export const REGISTRATION = {
	rep: 5_678_755,
	dem: 4_133_397,
	total: 13_672_122,
	asOf: '2026-09-30'
};

export const marginOf = (p: { rep: number; dem: number; total: number }) =>
	p.total ? ((p.dem - p.rep) / p.total) * 100 : 0;

export const fmtMargin = (v: number, digits = 1) => {
	const r = Math.abs(v).toFixed(digits);
	if (Number(r) === 0) return 'Even';
	return (v > 0 ? 'D+' : 'R+') + r;
};

export const fmtLead = (gap: number) => {
	const r = Math.round(Math.abs(gap));
	if (r === 0) return 'Even';
	return (gap > 0 ? 'D+' : 'R+') + r.toLocaleString('en-US');
};

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

const toDate = (s: string) => new Date(s + 'T12:00:00Z');
export const addDays = (s: string, n: number) => {
	const d = toDate(s);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};
export const weekday = (s: string) => toDate(s).getUTCDay();
const isWeekend = (s: string) => weekday(s) === 0 || weekday(s) === 6;

export const fmtDay = (s: string, withWeekday = false) =>
	toDate(s).toLocaleDateString('en-US', {
		timeZone: 'UTC',
		month: 'short',
		day: 'numeric',
		...(withWeekday ? { weekday: 'short' } : {})
	});

const sum = (rows: PartyCounts[]): PartyCounts =>
	rows.reduce(
		(a, r) => ({
			rep: a.rep + r.rep,
			dem: a.dem + r.dem,
			npa: a.npa + r.npa,
			oth: a.oth + r.oth,
			total: a.total + r.total
		}),
		{ rep: 0, dem: 0, npa: 0, oth: 0, total: 0 }
	);

export interface HistoryPoint {
	date: string;
	total: number;
	gap: number;
	margin: number;
	ipevTotal: number;
	mailTotal: number;
	dayIpev: DayCounts;
}

export function buildHistory(feed: FeedData, asOfDate?: string): HistoryPoint[] {
	return feed.earlyDays
		.filter(
			(d) =>
				!asOfDate ||
				d.date < asOfDate ||
				(d.date === asOfDate &&
					(d.total > 0 || feed.mailDays.some((m) => m.date === d.date && m.total > 0)))
		)
		.map((d) => {
			const laterEarly = sum(feed.earlyDays.filter((x) => x.date > d.date));
			const laterMail = sum(feed.mailDays.filter((x) => x.date > d.date));
			const early = {
				...feed.early,
				rep: feed.early.rep - laterEarly.rep,
				dem: feed.early.dem - laterEarly.dem,
				total: feed.early.total - laterEarly.total
			};
			const mail = {
				...feed.mail,
				rep: feed.mail.rep - laterMail.rep,
				dem: feed.mail.dem - laterMail.dem,
				total: feed.mail.total - laterMail.total
			};
			const total = early.total + mail.total;
			const gap = early.dem + mail.dem - early.rep - mail.rep;
			return {
				date: d.date,
				total,
				gap,
				margin: total ? (gap / total) * 100 : 0,
				ipevTotal: early.total,
				mailTotal: mail.total,
				dayIpev: d
			};
		});
}

export const POLLS_CLOSED_HOUR_ET = 21;

export interface FloridaClock {
	today: string;
	pollsClosed: boolean;
}

export function floridaClock(now = new Date()): FloridaClock {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'America/New_York',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			hourCycle: 'h23'
		})
			.formatToParts(now)
			.map((p) => [p.type, p.value])
	);
	return {
		today: `${parts.year}-${parts.month}-${parts.day}`,
		pollsClosed: Number(parts.hour) >= POLLS_CLOSED_HOUR_ET
	};
}

export interface CurrentDay {
	date: string;
	pollsClosed: boolean;
	soFar: DayCounts | null;
	projectedVolume: number;
	projectedMargin: number;
	restVolume: number;
	restGap: number;
}

export interface Ctx {
	feed: FeedData;
	complete: DayCounts[];
	current: CurrentDay | null;
	futureDates: string[];
}

const weighted = (rows: DayCounts[]) => marginOf(sum(rows));

function projectDays(days: DayCounts[], dates: string[]): ForecastDay[] {
	if (!days.length) return dates.map((date) => ({ date, volume: 0, margin: 0 }));
	const find = (date: string) => days.find((d) => d.date === date);

	const pairs = days
		.slice(-3)
		.map((d) => [d, find(addDays(d.date, -7))] as const)
		.filter((p): p is readonly [DayCounts, DayCounts] => !!p[1]);
	const growth = pairs.length
		? sum(pairs.map((p) => p[0])).total / Math.max(1, sum(pairs.map((p) => p[1])).total)
		: 1;
	const avgRecentVolume = sum(days.slice(-3)).total / Math.min(3, days.length);

	const weekdays = days.filter((d) => !isWeekend(d.date));
	const baseline = weighted(weekdays.slice(-3).length ? weekdays.slice(-3) : days.slice(-3));

	return dates.map((date) => {
		const prev = find(addDays(date, -7));
		const volume = Math.round((prev ? prev.total * growth : avgRecentVolume) / 1000) * 1000;
		let margin = baseline;
		if (isWeekend(date) && prev) {
			const priorWeekdays = days.filter(
				(d) => !isWeekend(d.date) && d.date < prev.date && d.date >= addDays(prev.date, -6)
			);
			if (priorWeekdays.length) margin = baseline + (marginOf(prev) - weighted(priorWeekdays));
		}
		return { date, volume, margin: Math.round(margin * 10) / 10 };
	});
}

export function buildCtx(feed: FeedData, clock: FloridaClock): Ctx {
	const { today } = clock;
	const evStart = feed.earlyDays[0]?.date ?? today;
	const currentDate = today >= evStart && today <= EV_END ? today : null;

	const complete = feed.earlyDays.filter((d) => !currentDate || d.date < currentDate);
	const lastComplete = complete.at(-1)?.date ?? addDays(evStart, -1);
	const startAfter = currentDate ?? (today > lastComplete ? today : lastComplete);

	const futureDates: string[] = [];
	for (let d = addDays(startAfter, 1); d <= EV_END; d = addDays(d, 1)) futureDates.push(d);

	let current: CurrentDay | null = null;
	if (currentDate) {
		const [proj] = projectDays(complete, [currentDate]);
		const soFar = feed.earlyDays.find((d) => d.date === currentDate) ?? null;
		const soFarVolume = soFar?.total ?? 0;
		const soFarGap = soFar ? soFar.dem - soFar.rep : 0;
		const closedWithVotes = clock.pollsClosed && soFarVolume > 0;
		const projectedVolume = closedWithVotes ? soFarVolume : Math.max(proj.volume, soFarVolume);
		const restVolume = projectedVolume - soFarVolume;
		const wanted = (projectedVolume * proj.margin) / 100 - soFarGap;
		const restGap = Math.max(-restVolume, Math.min(restVolume, wanted)) || 0;
		current = {
			date: currentDate,
			pollsClosed: closedWithVotes,
			soFar,
			projectedVolume,
			projectedMargin: projectedVolume
				? ((soFarGap + restGap) / projectedVolume) * 100
				: proj.margin,
			restVolume,
			restGap
		};
	}

	return { feed, complete, current, futureDates };
}

export function defaultDays(ctx: Ctx): ForecastDay[] {
	return projectDays(ctx.complete, ctx.futureDates);
}

export function currentDayBenchmark(ctx: Ctx): ForecastDay | null {
	if (!ctx.current) return null;
	return projectDays(ctx.complete, [ctx.current.date])[0] ?? null;
}

export function defaultMailMargin(feed: FeedData): number {
	return Math.round(weighted(feed.mailDays.slice(-5)) * 10) / 10;
}

export function defaultMailFinal(feed: FeedData): number {
	return feed.mail.total + Math.round((feed.outstanding.total * 0.2) / 1000) * 1000;
}

export function mailRemaining(ctx: Ctx, f: Forecast): number {
	return Math.max(0, f.mailFinal - ctx.feed.mail.total);
}

export const BASELINE = { target: -5, edMargin: -10 };
export const DEFAULT_TARGET = -8.5;

export function defaultForecast(ctx: Ctx): Forecast {
	const baseline = holdTarget(ctx, {
		modelVersion: 2,
		name: 'Default scenario',
		target: BASELINE.target,
		edMargin: BASELINE.edMargin,
		edTurnout: 2_000_000,
		mailFinal: defaultMailFinal(ctx.feed),
		mailMargin: defaultMailMargin(ctx.feed),
		days: defaultDays(ctx),
		linked: true
	});
	return swingToTarget(ctx, baseline, DEFAULT_TARGET);
}

export function reconcileDays(ctx: Ctx, days: ForecastDay[]): ForecastDay[] {
	return defaultDays(ctx).map((d) => days.find((x) => x.date === d.date) ?? d);
}

export function upgradeForecast(ctx: Ctx, f: Forecast): Forecast {
	if (!f.linked || f.modelVersion === 2) return f;
	const defaults = defaultForecast(ctx);
	const baseline = holdTarget(ctx, {
		...defaults,
		name: f.name,
		edTurnout: f.edTurnout,
		mailFinal:
			f.mailFinal ??
			(f.mailRemaining !== undefined ? ctx.feed.mail.total + f.mailRemaining : defaults.mailFinal),
		days: defaults.days.map((d) => ({
			...d,
			volume: f.days.find((saved) => saved.date === d.date)?.volume ?? d.volume
		}))
	});
	return swingToTarget(ctx, baseline, f.target);
}

export interface Component {
	key: string;
	label: string;
	volume: number;
	gap: number;
	projected: boolean;
}

export interface Outcome {
	components: Component[];
	total: number;
	gap: number;
	margin: number;
	ipevRemainingVolume: number;
	requiredIpevGap: number;
	requiredIpevMargin: number;
	shift: number;
	benchmarks: (ForecastDay & { gap: number })[];
	scenarioIpevMargin: number;
	cushion: number;
}

export function computeOutcome(ctx: Ctx, f: Forecast): Outcome {
	const { feed, current } = ctx;
	const ipevVol = f.days.reduce((a, d) => a + d.volume, 0);
	const ipevGap = f.days.reduce((a, d) => a + (d.volume * d.margin) / 100, 0);
	const mailRem = mailRemaining(ctx, f);

	const components: Component[] = [
		{
			key: 'mail',
			label: 'Mail returned',
			volume: feed.mail.total,
			gap: feed.mail.dem - feed.mail.rep,
			projected: false
		},
		{
			key: 'ipev',
			label: 'IPEV cast',
			volume: feed.early.total,
			gap: feed.early.dem - feed.early.rep,
			projected: false
		}
	];
	if (current) {
		components.push({
			key: 'today',
			label: `Rest of today (${fmtDay(current.date)})`,
			volume: current.restVolume,
			gap: current.restGap,
			projected: true
		});
	}
	components.push(
		{
			key: 'mailRem',
			label: 'Remaining mail',
			volume: mailRem,
			gap: (mailRem * f.mailMargin) / 100,
			projected: true
		},
		{ key: 'ipevRem', label: 'Remaining IPEV', volume: ipevVol, gap: ipevGap, projected: true },
		{
			key: 'ed',
			label: 'Election Day',
			volume: f.edTurnout,
			gap: (f.edTurnout * f.edMargin) / 100,
			projected: true
		}
	);

	const total = components.reduce((a, c) => a + c.volume, 0);
	const gap = components.reduce((a, c) => a + c.gap, 0);
	const fixedGap = gap - ipevGap;
	const requiredIpevGap = (f.target / 100) * total - fixedGap;
	const shift = ipevVol ? ((requiredIpevGap - ipevGap) / ipevVol) * 100 : 0;

	return {
		components,
		total,
		gap,
		margin: total ? (gap / total) * 100 : 0,
		ipevRemainingVolume: ipevVol,
		requiredIpevGap,
		requiredIpevMargin: ipevVol ? (requiredIpevGap / ipevVol) * 100 : 0,
		shift,
		benchmarks: f.days.map((d) => {
			const margin = d.margin + shift;
			return { ...d, margin, gap: (d.volume * margin) / 100 };
		}),
		scenarioIpevMargin: ipevVol ? (ipevGap / ipevVol) * 100 : 0,
		cushion: gap - (f.target / 100) * total
	};
}

export function shiftDays(f: Forecast, delta: number): Forecast {
	return { ...f, days: f.days.map((d) => ({ ...d, margin: d.margin + delta })) };
}

export function holdTarget(ctx: Ctx, f: Forecast): Forecast {
	const o = computeOutcome(ctx, f);
	if (o.ipevRemainingVolume > 0) return shiftDays(f, o.shift);
	if (f.edTurnout > 0) return { ...f, edMargin: f.edMargin - (o.cushion / f.edTurnout) * 100 };
	return f;
}

export function swingToTarget(ctx: Ctx, f: Forecast, target: number): Forecast {
	const base = holdTarget(ctx, f);
	const o = computeOutcome(ctx, base);
	const swingable = o.ipevRemainingVolume + base.edTurnout + mailRemaining(ctx, base);
	if (!swingable) return { ...base, target };
	const delta = ((target - base.target) * o.total) / swingable;
	return shiftDays(
		{ ...base, target, edMargin: base.edMargin + delta, mailMargin: base.mailMargin + delta },
		delta
	);
}

export function setIpevHoldingTarget(ctx: Ctx, f: Forecast, ipevMargin: number): Forecast {
	const o = computeOutcome(ctx, f);
	const moved = shiftDays(f, ipevMargin - o.scenarioIpevMargin);
	if (!f.edTurnout) return moved;
	const cushion = computeOutcome(ctx, moved).cushion;
	return { ...moved, edMargin: moved.edMargin - (cushion / f.edTurnout) * 100 };
}

export interface ProjectedPoint {
	date: string;
	total: number;
	gap: number;
	margin: number;
}

export function projectPath(
	ctx: Ctx,
	f: Forecast,
	days: { date: string; volume: number; margin: number }[]
): ProjectedPoint[] {
	const { feed, current } = ctx;
	let total = feed.mail.total + feed.early.total;
	let gap = feed.mail.dem + feed.early.dem - feed.mail.rep - feed.early.rep;
	const steps = days.map((d) => ({
		date: d.date,
		volume: d.volume,
		gap: (d.volume * d.margin) / 100
	}));
	if (current)
		steps.unshift({ date: current.date, volume: current.restVolume, gap: current.restGap });

	const n = steps.length || 1;
	const mailRem = mailRemaining(ctx, f);
	const mailPerDay = mailRem / n;
	const mailGapPerDay = (mailRem * f.mailMargin) / 100 / n;
	return steps.map((d) => {
		total += d.volume + mailPerDay;
		gap += d.gap + mailGapPerDay;
		return { date: d.date, total, gap, margin: (gap / total) * 100 };
	});
}
