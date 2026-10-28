import { describe, expect, it } from 'vitest';
import { extractFeed } from './server/feed.ts';
import {
	buildCtx,
	buildHistory,
	computeOutcome,
	currentDayBenchmark,
	defaultForecast,
	floridaClock,
	fmtMargin,
	holdTarget,
	mailRemaining,
	reconcileDays,
	setIpevHoldingTarget,
	swingToTarget,
	upgradeForecast
} from './model.ts';

const day = (date: string, rep: number, dem: number, other: number) =>
	`{date:"${date}",rep:${rep},dem:${dem},npa:${other},oth:0,total:${rep + dem + other}}`;

const html = `<script>$_TSR.router=($R=>$R[0]={matches:$R[1]=[$R[2]={l:$R[3]={fetchedAt:"2026-10-28T00:00:00Z",fromCache:!1,windowOpen:!0,
counties:$R[4]=[$R[5]={code:"ALA",name:"Alachua",registered:1000,mail:$R[6]={rep:10,dem:20,npa:5,oth:0,total:35},early:$R[7]={rep:30,dem:20,npa:5,oth:0,total:55}}],
mail:$R[8]={rep:300,dem:500,npa:200,oth:0,total:1000},early:$R[9]={rep:1100,dem:700,npa:200,oth:0,total:2000},
outstanding:$R[10]={rep:100,dem:100,npa:0,oth:0,total:200},registered:5000,
earlyDays:$R[11]=[${day('2026-10-26', 600, 300, 100)},${day('2026-10-27', 500, 400, 100)}],
mailDays:$R[12]=[${day('2026-10-26', 150, 250, 100)},${day('2026-10-27', 150, 250, 100)}]}}]})($R["tsr"])</script>`;

const open = (today: string) => ({ today, pollsClosed: false });

describe('current-day benchmark', () => {
	it('drops completed dates and re-solves remaining benchmarks after rollover', () => {
		const feed = extractFeed(html);
		const before = buildCtx(feed, open('2026-10-27'));
		const forecast = defaultForecast(before);
		const after = buildCtx(feed, open('2026-10-28'));
		const reconciled = { ...forecast, days: reconcileDays(after, forecast.days) };
		const outcome = computeOutcome(after, reconciled);
		expect(outcome.benchmarks.every((d) => d.date > '2026-10-28')).toBe(true);
		expect(outcome.benchmarks.some((d) => d.date === '2026-10-27')).toBe(false);
		expect(computeOutcome(after, { ...reconciled, days: outcome.benchmarks }).margin).toBeCloseTo(
			forecast.target,
			6
		);
		expect(currentDayBenchmark(after)?.date).toBe('2026-10-28');
	});
	it('keeps the daily expectation independent of actual counts', () => {
		const feed = extractFeed(html);
		const ctx = buildCtx(feed, open('2026-10-27'));
		const initial = currentDayBenchmark(ctx);
		const changed = structuredClone(feed);
		changed.early.dem += 100;
		changed.early.rep -= 100;
		changed.earlyDays[1].dem += 100;
		changed.earlyDays[1].rep -= 100;
		expect(currentDayBenchmark(buildCtx(changed, open('2026-10-27')))).toEqual(initial);
		expect(initial?.date).toBe('2026-10-27');
		expect(
			currentDayBenchmark(buildCtx(changed, { today: '2026-10-27', pollsClosed: true }))
		).toEqual(initial);
	});

	it('uses the same forecast as the projected table row before counting starts', () => {
		const ctx = buildCtx(extractFeed(html), open('2026-10-28'));
		const expected = currentDayBenchmark(ctx)!;
		expect(expected.margin).toBe(ctx.current!.projectedMargin);
		expect(expected.volume).toBe(ctx.current!.projectedVolume);
	});

	it('has no current-day benchmark after early voting ends', () => {
		const ctx = buildCtx(extractFeed(html), open('2026-11-02'));
		expect(currentDayBenchmark(ctx)).toBeNull();
	});
});

describe('feed extraction', () => {
	it('excludes an empty new day from reported history until votes arrive', () => {
		const feed = extractFeed(html);
		feed.earlyDays.push({ date: '2026-10-28', rep: 0, dem: 0, npa: 0, oth: 0, total: 0 });
		feed.mailDays.push({ date: '2026-10-28', rep: 0, dem: 0, npa: 0, oth: 0, total: 0 });
		expect(buildHistory(feed, '2026-10-28').at(-1)?.date).toBe('2026-10-27');
		feed.earlyDays.at(-1)!.total = 1;
		feed.earlyDays.at(-1)!.rep = 1;
		feed.early.total += 1;
		feed.early.rep += 1;
		expect(buildHistory(feed, '2026-10-28').at(-1)?.date).toBe('2026-10-28');
	});
	it('parses the serialized payload without executing it', () => {
		const feed = extractFeed(html);
		expect(feed.windowOpen).toBe(true);
		expect(feed.early.total).toBe(2000);
		expect(feed.counties[0].mail.dem).toBe(20);
		expect(feed.earlyDays.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27']);
	});

	it('rebuilds the cumulative IPEV + mail margin per day', () => {
		const h = buildHistory(extractFeed(html));
		expect(h[0].total).toBe(1500);
		expect(h[0].gap).toBe(-200);
		expect(h[1].total).toBe(3000);
		expect(h[1].margin).toBeCloseTo((-200 / 3000) * 100);
	});

	it('ends exactly on the official totals even when daily rows disagree', () => {
		const feed = extractFeed(html);
		feed.earlyDays[0] = {
			...feed.earlyDays[0],
			rep: feed.earlyDays[0].rep + 50,
			total: feed.earlyDays[0].total + 50
		};
		const last = buildHistory(feed).at(-1)!;
		expect(last.total).toBe(feed.mail.total + feed.early.total);
		expect(last.gap).toBe(feed.mail.dem + feed.early.dem - feed.mail.rep - feed.early.rep);
	});
});

describe('Florida clock', () => {
	it('uses Eastern time for the current day', () => {
		expect(floridaClock(new Date('2026-10-28T03:30:00Z'))).toEqual({
			today: '2026-10-27',
			pollsClosed: true
		});
		expect(floridaClock(new Date('2026-10-28T04:30:00Z'))).toEqual({
			today: '2026-10-28',
			pollsClosed: false
		});
	});
});

describe('day status', () => {
	const feed = extractFeed(html);

	it('treats a day with no rows yet as in progress and locked', () => {
		const ctx = buildCtx(feed, open('2026-10-28'));
		expect(ctx.complete.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27']);
		expect(ctx.current?.date).toBe('2026-10-28');
		expect(ctx.current?.soFar).toBeNull();
		expect(ctx.current?.restVolume).toBe(ctx.current?.projectedVolume);
		expect(ctx.futureDates).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
	});

	it('only projects the part of today not yet counted', () => {
		const ctx = buildCtx(feed, open('2026-10-27'));
		expect(ctx.complete.map((d) => d.date)).toEqual(['2026-10-26']);
		expect(ctx.current?.soFar?.total).toBe(1000);
		expect(ctx.current!.projectedVolume).toBeGreaterThanOrEqual(1000);
		expect(ctx.current!.restVolume).toBe(ctx.current!.projectedVolume - 1000);
		expect(Math.abs(ctx.current!.restGap)).toBeLessThanOrEqual(ctx.current!.restVolume);
		expect(ctx.futureDates[0]).toBe('2026-10-28');
	});

	it('stops expecting more of today once polls have closed', () => {
		const ctx = buildCtx(feed, { today: '2026-10-27', pollsClosed: true });
		expect(ctx.current?.projectedVolume).toBe(1000);
		expect(ctx.current?.restVolume).toBe(0);
		expect(ctx.current?.restGap).toBe(0);
		expect(ctx.futureDates[0]).toBe('2026-10-28');
	});

	it('drops days that roll into today or the past and keeps later edits', () => {
		const before = buildCtx(feed, open('2026-10-27'));
		const days = defaultForecast(before).days.map((d) => ({ ...d, margin: 3 }));
		const after = buildCtx(feed, open('2026-10-28'));
		const kept = reconcileDays(after, days);
		expect(kept.map((d) => d.date)).toEqual(after.futureDates);
		expect(kept.every((d) => d.margin === 3)).toBe(true);
	});

	it('scales upcoming days by growth versus the same weekday last week', () => {
		const rows = [
			day('2026-10-19', 100000, 100000, 0),
			day('2026-10-20', 100000, 100000, 0),
			day('2026-10-21', 100000, 100000, 0),
			day('2026-10-25', 100000, 100000, 0),
			day('2026-10-26', 150000, 150000, 0)
		].join(',');
		const page = html.replace(/earlyDays:\$R\[11\]=\[[^\]]*\]/, `earlyDays:$R[11]=[${rows}]`);
		const ctx = buildCtx(extractFeed(page), open('2026-10-27'));
		const wed = defaultForecast(ctx).days.find((d) => d.date === '2026-10-28')!;
		expect(wed.volume).toBe(300000);
	});

	it('has nothing left to edit once early voting is over', () => {
		const ctx = buildCtx(feed, open('2026-11-05'));
		expect(ctx.current).toBeNull();
		expect(ctx.futureDates).toEqual([]);
	});

	it('shrinks remaining mail as ballots come in', () => {
		const ctx = buildCtx(feed, open('2026-10-28'));
		const f = { ...defaultForecast(ctx), mailFinal: 1200 };
		expect(mailRemaining(ctx, f)).toBe(200);
		const later = buildCtx({ ...feed, mail: { ...feed.mail, total: 1150 } }, open('2026-10-28'));
		expect(mailRemaining(later, f)).toBe(50);
	});
});

describe('forecast', () => {
	const ctx = buildCtx(extractFeed(html), open('2026-10-28'));

	it('benchmarks land exactly on the target', () => {
		const f = { ...defaultForecast(ctx), target: -5, edMargin: -15, edTurnout: 4000 };
		const o = computeOutcome(ctx, f);
		const withBench = computeOutcome(ctx, { ...f, days: o.benchmarks });
		expect(withBench.margin).toBeCloseTo(-5, 6);
		expect(o.benchmarks.reduce((a, b) => a + b.gap, 0)).toBeCloseTo(o.requiredIpevGap, 6);
	});

	it('formats margins with D positive and R negative', () => {
		expect(fmtMargin(-4.83)).toBe('R+4.8');
		expect(fmtMargin(2)).toBe('D+2.0');
		expect(fmtMargin(0.01)).toBe('Even');
	});
});

describe('locked sliders', () => {
	const ctx = buildCtx(extractFeed(html), open('2026-10-28'));

	it('rebases old linked forecasts from defaults before applying their saved target', () => {
		const baseline = defaultForecast(ctx);
		const old = {
			...baseline,
			modelVersion: undefined,
			target: -8,
			edMargin: -25,
			mailMargin: 20,
			days: baseline.days.map((d) => ({ ...d, margin: -30 }))
		};
		const upgraded = upgradeForecast(ctx, old);
		expect(upgraded).toEqual(swingToTarget(ctx, baseline, -8));
		expect(computeOutcome(ctx, upgraded).margin).toBeCloseTo(-8, 6);
		expect(upgradeForecast(ctx, upgraded)).toBe(upgraded);
	});

	it('preserves unlocked scenarios and turnout assumptions during migration', () => {
		const defaults = defaultForecast(ctx);
		const unlocked = { ...defaults, modelVersion: undefined, linked: false };
		expect(upgradeForecast(ctx, unlocked)).toBe(unlocked);
		const old = {
			...defaults,
			modelVersion: undefined,
			edTurnout: 3000000,
			mailFinal: 5000,
			days: defaults.days.map((d) => ({ ...d, volume: 50000 }))
		};
		const upgraded = upgradeForecast(ctx, old);
		expect(upgraded.edTurnout).toBe(old.edTurnout);
		expect(upgraded.mailFinal).toBe(old.mailFinal);
		expect(upgraded.days.map((d) => d.volume)).toEqual(old.days.map((d) => d.volume));
		expect(computeOutcome(ctx, upgraded).margin).toBeCloseTo(old.target, 6);
	});

	it('starts from the R+8.5 / R+10 baseline exactly on target', () => {
		const f = defaultForecast(ctx);
		expect(f.target).toBe(-8.5);
		expect(f.edMargin).toBe(-10);
		expect(computeOutcome(ctx, f).margin).toBeCloseTo(-8.5, 6);
	});

	it('swings ED, future IPEV, and remaining mail by the same amount to hit a new target', () => {
		const f = defaultForecast(ctx);
		const before = computeOutcome(ctx, f).scenarioIpevMargin;
		const g = swingToTarget(ctx, f, -10);
		const o = computeOutcome(ctx, g);
		expect(o.margin).toBeCloseTo(-10, 6);
		expect(o.scenarioIpevMargin - before).toBeCloseTo(g.edMargin - f.edMargin, 6);
		expect(g.mailMargin - f.mailMargin).toBeCloseTo(g.edMargin - f.edMargin, 6);
		expect(g.mailFinal).toBe(f.mailFinal);
		expect(g.edMargin).toBeLessThan(-10);
	});

	it('can swing a forecast with only remaining mail', () => {
		const mailCtx = { ...ctx, current: null, futureDates: [] };
		const f = {
			...defaultForecast(mailCtx),
			days: [],
			edTurnout: 0,
			mailFinal: mailCtx.feed.mail.total + 1000
		};
		const target = computeOutcome(mailCtx, f).margin - 1;
		const g = swingToTarget(mailCtx, { ...f, target: computeOutcome(mailCtx, f).margin }, target);
		expect(computeOutcome(mailCtx, g).margin).toBeCloseTo(target, 6);
		expect(g.mailMargin).toBeLessThan(f.mailMargin);
	});

	it('solves ED when IPEV is moved and IPEV when ED is moved', () => {
		const f = defaultForecast(ctx);
		const a = setIpevHoldingTarget(ctx, f, -2);
		expect(computeOutcome(ctx, a).scenarioIpevMargin).toBeCloseTo(-2, 6);
		expect(computeOutcome(ctx, a).margin).toBeCloseTo(f.target, 6);
		const b = holdTarget(ctx, { ...f, edMargin: -20 });
		expect(b.edMargin).toBe(-20);
		expect(computeOutcome(ctx, b).margin).toBeCloseTo(f.target, 6);
	});

	it('never moves the locked current day', () => {
		const f = defaultForecast(ctx);
		const before = computeOutcome(ctx, f).components.find((c) => c.key === 'today');
		const after = computeOutcome(ctx, swingToTarget(ctx, f, -9)).components.find(
			(c) => c.key === 'today'
		);
		expect(after).toEqual(before);
	});
});
