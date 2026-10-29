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
			const latest = d.date === feed.earlyDays.at(-1)?.date;
			const early = latest ? feed.early : sum(feed.earlyDays.filter((x) => x.date <= d.date));
			const mail = latest
				? feed.mail
				: sum(feed.mailDays.filter((x) => x.date <= d.date && !x.retained));
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

export const VOTING_HOURS_ET = { open: 7 * 60, close: 19 * 60 };
export const MIN_VOTING_SHARE = 0.5;

export interface FloridaClock {
	today: string;
	pollsClosed: boolean;
	minute?: number;
}

export function floridaClock(now = new Date()): FloridaClock {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'America/New_York',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		})
			.formatToParts(now)
			.map((p) => [p.type, p.value])
	);
	return {
		today: `${parts.year}-${parts.month}-${parts.day}`,
		pollsClosed: Number(parts.hour) >= POLLS_CLOSED_HOUR_ET,
		minute: Number(parts.hour) * 60 + Number(parts.minute)
	};
}

export const LATE_REPORTING_SHARE = 0.03;

function votingShare(minute?: number): number {
	if (minute === undefined) return 1;
	const { open, close } = VOTING_HOURS_ET;
	const cutoff = POLLS_CLOSED_HOUR_ET * 60;
	const share =
		minute <= close
			? ((1 - LATE_REPORTING_SHARE) * (minute - open)) / (close - open)
			: 1 - LATE_REPORTING_SHARE + (LATE_REPORTING_SHARE * (minute - close)) / (cutoff - close);
	return Math.min(1, Math.max(MIN_VOTING_SHARE, share));
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

export const FINAL_DAY_COUNTIES = new Set([
	'DAD',
	'BRO',
	'PAL',
	'ORA',
	'HIL',
	'DUV',
	'PIN',
	'POL',
	'SEM',
	'OSC',
	'SAR',
	'MAN',
	'LEO',
	'STL',
	'ALA',
	'CHA',
	'GAD',
	'LEV',
	'BRA',
	'TAY'
]);

export const FINAL_DAY_TURNOUT = 0.85;
export const WEEKEND_CARRY = 0.75;

function finalDayCounties(days: DayCounts[]): DayCounts[] | null {
	if (!days.every((d) => d.counties?.length)) return null;
	return days.map((d) => {
		const counties = (d.counties ?? []).filter((c) => FINAL_DAY_COUNTIES.has(c.code));
		return { date: d.date, ...sum(counties), counties };
	});
}

const openOn = (day: DayCounts, ref: DayCounts): PartyCounts => {
	if (!day.counties?.length || !ref.counties?.length) return day;
	const open = new Set(ref.counties.filter((c) => c.total > 0).map((c) => c.code));
	return sum(day.counties.filter((c) => open.has(c.code)));
};

function dayMargin(days: DayCounts[], date: string): number {
	const weekdays = days.filter((d) => !isWeekend(d.date));
	const baseline = weighted(weekdays.slice(-3).length ? weekdays.slice(-3) : days.slice(-3));
	const prev = days.find((d) => d.date === addDays(date, -7));
	if (!isWeekend(date) || !prev) return baseline;
	const priorWeekdays = days.filter(
		(d) => !isWeekend(d.date) && d.date < prev.date && d.date >= addDays(prev.date, -6)
	);
	return priorWeekdays.length
		? baseline + WEEKEND_CARRY * (marginOf(prev) - weighted(priorWeekdays))
		: baseline;
}

function dayVolume(days: DayCounts[], date: string): number {
	const find = (d: string) => days.find((x) => x.date === d);
	const recent = days.slice(-3);
	const prev = find(addDays(date, -7));
	if (!prev) return sum(recent).total / recent.length;
	const pairs = recent
		.map((d) => [d, find(addDays(d.date, -7))] as const)
		.filter((p): p is readonly [DayCounts, DayCounts] => !!p[1]);
	const growth = pairs.length
		? sum(pairs.map(([d, ref]) => openOn(d, ref))).total /
			Math.max(1, sum(pairs.map((p) => p[1])).total)
		: 1;
	const closed = new Set(prev.counties?.filter((c) => c.total === 0).map((c) => c.code));
	const missing = recent.reduce(
		(a, d) => a + sum(d.counties?.filter((c) => closed.has(c.code)) ?? []).total,
		0
	);
	return prev.total * growth + missing / recent.length;
}

function projectDays(days: DayCounts[], dates: string[], finalDayOnly = true): ForecastDay[] {
	if (!days.length) return dates.map((date) => ({ date, volume: 0, margin: 0 }));
	const finalDays = finalDayOnly ? finalDayCounties(days) : null;

	return dates.map((date) => {
		const source = date === EV_END && finalDays ? finalDays : days;
		const scale = source === days ? 1 : FINAL_DAY_TURNOUT;
		const volume = Math.round((dayVolume(source, date) * scale) / 1000) * 1000;
		const margin = dayMargin(source, date);
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
		const projectedVolume = closedWithVotes
			? soFarVolume
			: Math.max(
					proj.volume,
					soFarVolume,
					Math.round(soFarVolume / votingShare(clock.minute) / 1000) * 1000
				);
		const restVolume = projectedVolume - soFarVolume;
		const counted = projectedVolume ? soFarVolume / projectedVolume : 0;
		const restMargin = soFarVolume
			? proj.margin + ((soFarGap / soFarVolume) * 100 - proj.margin) * counted
			: proj.margin;
		const restGap =
			Math.max(-restVolume, Math.min(restVolume, (restVolume * restMargin) / 100)) || 0;
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
	const days =
		ctx.current?.pollsClosed && ctx.current.soFar
			? [...ctx.complete, ctx.current.soFar]
			: ctx.complete;
	return projectDays(days, ctx.futureDates);
}

export function currentDayBenchmark(ctx: Ctx): ForecastDay | null {
	if (!ctx.current) return null;
	return projectDays(ctx.complete, [ctx.current.date])[0] ?? null;
}

export const MAIL_SWING = 0.25;

export function defaultMailMargin(feed: FeedData, before?: string): number {
	const days = feed.mailDays.filter((d) => !before || d.date < before).slice(-7);
	const returned = sum(days);
	const since = sum(feed.mailDays.filter((d) => days.length && d.date > days.at(-1)!.date));
	const expected = (['rep', 'dem', 'npa', 'oth'] as const).reduce(
		(a, p) => {
			const pool = feed.outstanding[p] + returned[p] + since[p];
			return { ...a, [p]: pool ? (feed.outstanding[p] * returned[p]) / pool : 0 };
		},
		{ rep: 0, dem: 0, npa: 0, oth: 0 }
	);
	const total = expected.rep + expected.dem + expected.npa + expected.oth;
	const margin = total ? marginOf({ ...expected, total }) : weighted(days);
	return Math.round(margin * 10) / 10;
}

export function defaultMailFinal(feed: FeedData): number {
	return feed.mail.total + Math.round((feed.outstanding.total * 0.2) / 1000) * 1000;
}

export function mailRemaining(ctx: Ctx, f: Forecast): number {
	return Math.max(0, f.mailFinal - ctx.feed.mail.total);
}

export const BASELINE = { target: -5, edMargin: -10 };
export const DEFAULT_TARGET = -8.5;

export const ED_TURNOUT = 2_600_000;

export const MODEL_VERSION = 10;
export const AUTO_IPEV_SWING = 0.25;
export const AUTO_IPEV_LIMIT = 3;

export function defaultForecast(ctx: Ctx): Forecast {
	return rebalanceForecast(
		ctx,
		reconcileForecast(ctx, {
			modelVersion: MODEL_VERSION,
			name: 'Default scenario',
			target: DEFAULT_TARGET,
			edMargin: BASELINE.edMargin,
			edTurnout: ED_TURNOUT,
			mailFinal: defaultMailFinal(ctx.feed),
			mailMargin: defaultMailMargin(
				ctx.feed,
				ctx.current?.pollsClosed ? undefined : ctx.current?.date
			),
			days: defaultDays(ctx),
			linked: true,
			balance: 'adaptive'
		})
	);
}

export function reconcileDays(ctx: Ctx, days: ForecastDay[]): ForecastDay[] {
	return defaultDays(ctx).map((d) => days.find((x) => x.date === d.date) ?? d);
}

const ipevGap = (days: ForecastDay[]) => days.reduce((a, d) => a + (d.volume * d.margin) / 100, 0);

function todayFromShape(ctx: Ctx, days: ForecastDay[]): number {
	const base = ctx.current?.projectedMargin ?? 0;
	const shape = defaultDays(ctx);
	const volume = days.reduce((a, d) => a + d.volume, 0);
	if (!volume) return base;
	const swing = days.reduce(
		(a, d) =>
			a + d.volume * (d.margin - (shape.find((s) => s.date === d.date)?.margin ?? d.margin)),
		0
	);
	return base + swing / volume;
}

export function reconcileForecast(ctx: Ctx, f: Forecast): Forecast {
	const days = reconcileDays(ctx, f.days);
	const { current } = ctx;
	if (!current) return { ...f, days, today: undefined };
	if (f.today?.date === current.date) return { ...f, days };
	const margin = f.days.find((d) => d.date === current.date)?.margin ?? todayFromShape(ctx, days);
	return { ...f, days, today: { date: current.date, volume: current.projectedVolume, margin } };
}

export interface TodayPlan {
	margin: number;
	volume: number;
	restVolume: number;
	restGap: number;
	projectedMargin: number;
	swingable: boolean;
}

export function todayPlan(ctx: Ctx, f: Forecast, margin?: number): TodayPlan | null {
	const { current } = ctx;
	if (!current) return null;
	const volume = current.projectedVolume;
	const planned =
		margin ?? (f.today?.date === current.date ? f.today.margin : current.projectedMargin);
	if (current.pollsClosed) {
		return {
			margin: planned,
			volume,
			restVolume: 0,
			restGap: 0,
			projectedMargin: current.projectedMargin,
			swingable: false
		};
	}
	const soFarGap = current.soFar ? current.soFar.dem - current.soFar.rep : 0;
	const wanted = (volume * planned) / 100 - soFarGap;
	const restGap = Math.max(-current.restVolume, Math.min(current.restVolume, wanted)) || 0;
	return {
		margin: planned,
		volume,
		restVolume: current.restVolume,
		restGap,
		projectedMargin: volume ? ((soFarGap + restGap) / volume) * 100 : planned,
		swingable: volume > 0 && Math.abs(wanted) < current.restVolume
	};
}

export function upgradeForecast(ctx: Ctx, f: Forecast): Forecast {
	if (f.modelVersion === MODEL_VERSION) return f;
	return { ...defaultForecast(ctx), name: f.name };
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
	swingVolume: number;
	requiredIpevGap: number;
	requiredIpevMargin: number;
	shift: number;
	benchmarks: (ForecastDay & { gap: number })[];
	todayBenchmark: number | null;
	scenarioIpevMargin: number;
	cushion: number;
}

export function computeOutcome(ctx: Ctx, f: Forecast): Outcome {
	const { feed, current } = ctx;
	const ipevVol = f.days.reduce((a, d) => a + d.volume, 0);
	const ipevGap = f.days.reduce((a, d) => a + (d.volume * d.margin) / 100, 0);
	const mailRem = mailRemaining(ctx, f);
	const plan = todayPlan(ctx, f);

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
			volume: plan!.restVolume,
			gap: plan!.restGap,
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
	const todayVol = plan?.swingable ? plan.restVolume : 0;
	const blockVol = ipevVol + todayVol;
	const blockGap = ipevGap + (plan?.swingable ? plan.restGap : 0);
	const requiredBlockGap = (f.target / 100) * total - (gap - blockGap);
	const shift = blockVol ? ((requiredBlockGap - blockGap) / blockVol) * 100 : 0;
	const requiredIpevGap = ipevGap + (ipevVol * shift) / 100;

	return {
		components,
		total,
		gap,
		margin: total ? (gap / total) * 100 : 0,
		ipevRemainingVolume: ipevVol,
		swingVolume: blockVol,
		requiredIpevGap,
		requiredIpevMargin: ipevVol ? (requiredIpevGap / ipevVol) * 100 : 0,
		shift,
		benchmarks: f.days.map((d) => {
			const margin = d.margin + shift;
			return { ...d, margin, gap: (d.volume * margin) / 100 };
		}),
		todayBenchmark:
			plan && !current?.pollsClosed
				? plan.swingable
					? plan.margin + (shift * plan.restVolume) / plan.volume
					: plan.projectedMargin
				: null,
		scenarioIpevMargin: ipevVol ? (ipevGap / ipevVol) * 100 : 0,
		cushion: gap - (f.target / 100) * total
	};
}

export function shiftDays(ctx: Ctx, f: Forecast, delta: number): Forecast {
	const plan = f.today ? todayPlan(ctx, f) : null;
	return {
		...f,
		today: plan?.swingable
			? { ...f.today!, margin: f.today!.margin + (delta * plan.restVolume) / plan.volume }
			: f.today,
		days: f.days.map((d) => ({ ...d, margin: d.margin + delta }))
	};
}

export function holdTarget(ctx: Ctx, f: Forecast): Forecast {
	let next = f;
	for (let i = 0; i < 3; i++) {
		const o = computeOutcome(ctx, next);
		if (Math.abs(o.cushion) < 1e-7) break;
		if (o.swingVolume > 0) next = shiftDays(ctx, next, o.shift);
		else if (next.edTurnout > 0)
			next = { ...next, edMargin: next.edMargin - (o.cushion * 100) / next.edTurnout };
		else break;
	}
	return next;
}

export function rebalanceForecast(ctx: Ctx, f: Forecast): Forecast {
	if (f.balance === 'ed') return setEdHoldingTarget(ctx, f, f.edMargin);
	const solveEd = (next: Forecast): Forecast => ({
		...next,
		edMargin:
			next.edTurnout > 0
				? clamp(
						next.edMargin - (computeOutcome(ctx, next).cushion * 100) / next.edTurnout,
						ED_RANGE
					)
				: next.edMargin
	});
	if (f.balance === 'ipev') return solveEd(f);
	const shape = defaultDays(ctx);
	const boundDay = (day: ForecastDay, base: number): ForecastDay => ({
		...day,
		margin: Math.max(base - AUTO_IPEV_LIMIT, Math.min(base + AUTO_IPEV_LIMIT, day.margin))
	});
	const bound = (next: Forecast): Forecast => ({
		...next,
		days: next.days.map((d) =>
			boundDay(d, shape.find((b) => b.date === d.date)?.margin ?? d.margin)
		),
		today:
			next.today && ctx.current && !ctx.current.pollsClosed
				? boundDay(next.today, ctx.current.projectedMargin)
				: next.today
	});
	const bounded = bound(f);
	const outcome = computeOutcome(ctx, bounded);
	if (Math.abs(outcome.cushion) < 0.5) return bounded;
	const volume = bounded.edTurnout + AUTO_IPEV_SWING * outcome.swingVolume;
	if (!volume) {
		const remaining = mailRemaining(ctx, bounded);
		return remaining > 0
			? {
					...bounded,
					mailMargin: clamp(bounded.mailMargin - (outcome.cushion * 100) / remaining, {
						min: -100,
						max: 100
					})
				}
			: bounded;
	}
	const delta = (-outcome.cushion * 100) / volume;
	return solveEd(
		bound(
			shiftDays(
				ctx,
				{ ...bounded, edMargin: clamp(bounded.edMargin + delta, ED_RANGE) },
				AUTO_IPEV_SWING * delta
			)
		)
	);
}

export function swingToTarget(ctx: Ctx, f: Forecast, target: number): Forecast {
	if (!f.balance || f.balance === 'adaptive') return rebalanceForecast(ctx, { ...f, target });
	const base = holdTarget(ctx, f);
	const o = computeOutcome(ctx, base);
	const swingable = o.swingVolume + base.edTurnout + MAIL_SWING * mailRemaining(ctx, base);
	if (!swingable) return { ...base, target };
	const delta = ((target - base.target) * o.total) / swingable;
	return shiftDays(
		ctx,
		{
			...base,
			target,
			edMargin: base.edMargin + delta,
			mailMargin: base.mailMargin + MAIL_SWING * delta
		},
		delta
	);
}

export const ED_RANGE = { min: -40, max: 10 };
export const IPEV_RANGE = { min: -30, max: 20 };

const clamp = (v: number, range: { min: number; max: number }) =>
	Math.min(range.max, Math.max(range.min, v));

export function setIpevHoldingTarget(ctx: Ctx, f: Forecast, ipevMargin: number): Forecast {
	f = { ...f, balance: 'ipev' };
	const o = computeOutcome(ctx, f);
	const moved = shiftDays(ctx, f, clamp(ipevMargin, IPEV_RANGE) - o.scenarioIpevMargin);
	if (!f.edTurnout) return moved;
	const cushion = computeOutcome(ctx, moved).cushion;
	const edMargin = moved.edMargin - (cushion / f.edTurnout) * 100;
	const bounded = clamp(edMargin, ED_RANGE);
	if (bounded === edMargin) return { ...moved, edMargin };
	return holdTarget(ctx, { ...moved, edMargin: bounded });
}

export function setEdHoldingTarget(ctx: Ctx, f: Forecast, edMargin: number): Forecast {
	f = { ...f, balance: 'ed' };
	const held = holdTarget(ctx, { ...f, edMargin: clamp(edMargin, ED_RANGE) });
	const o = computeOutcome(ctx, held);
	if (!o.ipevRemainingVolume) return held;
	const ipev = clamp(o.scenarioIpevMargin, IPEV_RANGE);
	return ipev === o.scenarioIpevMargin ? held : setIpevHoldingTarget(ctx, held, ipev);
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
	days: { date: string; volume: number; margin: number }[],
	todayMargin?: number
): ProjectedPoint[] {
	const { feed, current } = ctx;
	const plan = todayPlan(ctx, f, todayMargin);
	let total = feed.mail.total + feed.early.total;
	let gap = feed.mail.dem + feed.early.dem - feed.mail.rep - feed.early.rep;
	const steps = days.map((d) => ({
		date: d.date,
		volume: d.volume,
		gap: (d.volume * d.margin) / 100
	}));
	if (current && plan)
		steps.unshift({ date: current.date, volume: plan.restVolume, gap: plan.restGap });

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
