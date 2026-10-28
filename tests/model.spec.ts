import { describe, expect, it } from 'vitest';
import { extractFeed } from '../src/lib/server/feed.ts';
import {
	buildCtx,
	buildHistory,
	computeOutcome,
	currentDayBenchmark,
	defaultForecast,
	defaultDays,
	defaultMailFinal,
	defaultMailMargin,
	floridaClock,
	fmtMargin,
	holdTarget,
	mailRemaining,
	reconcileDays,
	reconcileForecast,
	setIpevHoldingTarget,
	swingToTarget,
	upgradeForecast,
	BASELINE,
	MAIL_SWING,
	MODEL_VERSION,
	ED_TURNOUT
} from '../src/lib/model.ts';

const day = (date: string, rep: number, dem: number, other: number) =>
	`{date:"${date}",rep:${rep},dem:${dem},npa:${other},oth:0,total:${rep + dem + other}}`;

const html = `<script>$_TSR.router=($R=>$R[0]={matches:$R[1]=[$R[2]={l:$R[3]={fetchedAt:"2026-10-28T00:00:00Z",fromCache:!1,windowOpen:!0,
counties:$R[4]=[$R[5]={code:"ALA",name:"Alachua",registered:1000,mail:$R[6]={rep:10,dem:20,npa:5,oth:0,total:35},early:$R[7]={rep:30,dem:20,npa:5,oth:0,total:55}}],
mail:$R[8]={rep:300,dem:500,npa:200,oth:0,total:1000},early:$R[9]={rep:1100,dem:700,npa:200,oth:0,total:2000},
outstanding:$R[10]={rep:100,dem:100,npa:0,oth:0,total:200},registered:5000,
earlyDays:$R[11]=[${day('2026-10-26', 600, 300, 100)},${day('2026-10-27', 500, 400, 100)}],
mailDays:$R[12]=[${day('2026-10-26', 150, 250, 100)},${day('2026-10-27', 150, 250, 100)}]}}]})($R["tsr"])</script>`;

const open = (today: string) => ({ today, pollsClosed: false });

const county = (code: string, rep: number, dem: number) => ({
	code,
	rep,
	dem,
	npa: 0,
	oth: 0,
	total: rep + dem
});

const countyFeed = () => {
	const earlyDays = ['19', '20', '21', '22', '23', '24', '25', '26', '27'].map((dd) => {
		const counties =
			dd === '25'
				? [county('DAD', 350, 650), county('LEE', 700, 300)]
				: [county('DAD', 400, 600), county('LEE', 700, 300)];
		return {
			date: `2026-10-${dd}`,
			...counties.reduce(
				(a, c) => ({ ...a, rep: a.rep + c.rep, dem: a.dem + c.dem, total: a.total + c.total }),
				{ rep: 0, dem: 0, npa: 0, oth: 0, total: 0 }
			),
			counties
		};
	});
	return { ...extractFeed(html), earlyDays };
};

describe('current-day benchmark', () => {
	it('drops completed dates and re-solves remaining benchmarks after rollover', () => {
		const feed = extractFeed(html);
		const before = buildCtx(feed, open('2026-10-27'));
		const forecast = defaultForecast(before);
		const after = buildCtx(feed, open('2026-10-28'));
		const reconciled = reconcileForecast(after, forecast);
		const outcome = computeOutcome(after, reconciled);
		expect(outcome.benchmarks.every((d) => d.date > '2026-10-28')).toBe(true);
		expect(outcome.benchmarks.some((d) => d.date === '2026-10-27')).toBe(false);
		expect(reconciled.today).toEqual({
			...forecast.days.find((d) => d.date === '2026-10-28')!,
			volume: after.current!.projectedVolume
		});
		const benchmarked = {
			...reconciled,
			days: outcome.benchmarks,
			today: { ...reconciled.today!, margin: outcome.todayBenchmark! }
		};
		expect(computeOutcome(after, benchmarked).margin).toBeCloseTo(forecast.target, 6);
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

	it('does not rewrite earlier days when later totals change or retained mail is present', () => {
		const feed = extractFeed(html);
		const before = buildHistory(feed)[0];
		feed.mail.rep += 500;
		feed.mail.total += 500;
		feed.early.rep += 50;
		feed.early.total += 50;
		feed.mailDays.push({
			date: '2026-10-28',
			rep: 100,
			dem: 200,
			npa: 0,
			oth: 0,
			total: 300,
			retained: true
		});
		expect(buildHistory(feed)[0]).toEqual(before);
		expect(buildHistory(feed).at(-1)!.total).toBe(feed.mail.total + feed.early.total);
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

	it('projects the final Sunday from the counties open that day', () => {
		const ctx = buildCtx(countyFeed(), open('2026-10-28'));
		const days = defaultDays(ctx);
		expect(days.find((d) => d.date === '2026-11-01')?.margin).toBe(30);
		expect(days.find((d) => d.date === '2026-10-30')?.margin).toBe(-10);
		expect(days.find((d) => d.date === '2026-10-31')?.margin).toBe(-10);
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

	it('resets every forecast from an older version to the default once', () => {
		const defaults = defaultForecast(ctx);
		expect(defaults.edTurnout).toBe(ED_TURNOUT);
		const old = [
			{ ...defaults, modelVersion: undefined, name: 'Mine', target: -6, edMargin: -41.9 },
			{ ...defaults, modelVersion: 5, name: 'Mine', linked: false, edTurnout: 3_000_000 }
		];
		for (const f of old) expect(upgradeForecast(ctx, f)).toEqual({ ...defaults, name: 'Mine' });
		const current = { ...defaults, target: -6 };
		expect(upgradeForecast(ctx, current)).toBe(current);
	});

	it('bases remaining mail on the last seven complete days', () => {
		const mail = (date: string, rep: number, dem: number) => ({
			date,
			rep,
			dem,
			npa: 0,
			oth: 0,
			total: rep + dem
		});
		const feed = {
			...extractFeed(html),
			mailDays: [
				mail('2026-10-20', 0, 1000),
				...['21', '22', '23', '24', '25', '26', '27'].map((dd) => mail(`2026-10-${dd}`, 450, 550)),
				mail('2026-10-28', 1000, 0)
			]
		};
		expect(defaultMailMargin(feed, '2026-10-28')).toBe(10);
	});

	it('reaches the R+8.5 default by swinging all remaining margins from the R+5 baseline', () => {
		const f = defaultForecast(ctx);
		const baseline = holdTarget(ctx, {
			...f,
			target: -5,
			edMargin: -10,
			mailFinal: defaultMailFinal(ctx.feed),
			mailMargin: defaultMailMargin(ctx.feed),
			days: defaultDays(ctx)
		});
		const shift = f.edMargin - baseline.edMargin;
		expect(f.target).toBe(-8.5);
		expect(f).toEqual(swingToTarget(ctx, baseline, -8.5));
		expect(f.mailMargin - baseline.mailMargin).toBeCloseTo(MAIL_SWING * shift, 6);
		expect(
			computeOutcome(ctx, f).scenarioIpevMargin - computeOutcome(ctx, baseline).scenarioIpevMargin
		).toBeCloseTo(shift, 6);
		expect(computeOutcome(ctx, f).margin).toBeCloseTo(-8.5, 6);
	});

	it('swings ED, future IPEV, and remaining mail together, with mail damped, to hit a new target', () => {
		const f = defaultForecast(ctx);
		const before = computeOutcome(ctx, f).scenarioIpevMargin;
		const g = swingToTarget(ctx, f, -10);
		const o = computeOutcome(ctx, g);
		expect(o.margin).toBeCloseTo(-10, 6);
		expect(o.scenarioIpevMargin - before).toBeCloseTo(g.edMargin - f.edMargin, 6);
		expect(g.mailMargin - f.mailMargin).toBeCloseTo(MAIL_SWING * (g.edMargin - f.edMargin), 6);
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

	const rawForecast = (c: ReturnType<typeof buildCtx>) =>
		reconcileForecast(c, {
			...defaultForecast(c),
			edTurnout: 3000,
			mailFinal: c.feed.mail.total,
			days: defaultDays(c),
			today: undefined
		});

	it('weights today with the upcoming days', () => {
		const c = buildCtx(countyFeed(), open('2026-10-28'));
		const raw = rawForecast(c);
		expect(raw.today!.margin).toBe(currentDayBenchmark(c)!.margin);
		const held = holdTarget(c, { ...raw, target: -8 });
		const swing = held.days[0].margin - raw.days[0].margin;
		expect(swing).not.toBeCloseTo(0, 2);
		expect(held.today!.margin - raw.today!.margin).toBeCloseTo(swing, 6);
		expect(computeOutcome(c, held).margin).toBeCloseTo(-8, 6);
		const swung = swingToTarget(c, held, -10);
		expect(swung.today!.margin - held.today!.margin).toBeCloseTo(
			swung.days[0].margin - held.days[0].margin,
			6
		);
		expect(computeOutcome(c, swung).todayBenchmark).toBeCloseTo(swung.today!.margin, 6);
	});

	it('moves the remaining days to hold the target when today beats its benchmark', () => {
		const feed = countyFeed();
		const c0 = buildCtx(feed, open('2026-10-28'));
		const f = holdTarget(c0, { ...rawForecast(c0), target: -8 });
		const needed = f.today!.margin;
		const volume = c0.current!.projectedVolume;
		const dem = Math.round((volume * (1 + (needed + 10) / 100)) / 2);
		feed.earlyDays.push({
			date: '2026-10-28',
			rep: volume - dem,
			dem,
			npa: 0,
			oth: 0,
			total: volume,
			counties: [county('DAD', volume - dem, dem)]
		});
		const closed = buildCtx(feed, { today: '2026-10-28', pollsClosed: true });
		expect(computeOutcome(closed, f).cushion).toBeGreaterThan(0);
		const held = holdTarget(closed, f);
		expect(computeOutcome(closed, held).margin).toBeCloseTo(-8, 6);
		expect(held.days[0].margin).toBeLessThan(f.days[0].margin);
		expect(held.edMargin).toBe(f.edMargin);
		expect(held.today).toEqual(f.today);
	});

	it('freezes today once polls close', () => {
		const feed = countyFeed();
		feed.earlyDays.push({
			date: '2026-10-28',
			rep: 450,
			dem: 450,
			npa: 0,
			oth: 0,
			total: 900,
			counties: [county('DAD', 150, 300), county('LEE', 300, 150)]
		});
		const c = buildCtx(feed, { today: '2026-10-28', pollsClosed: true });
		const held = holdTarget(c, { ...rawForecast(c), target: -8 });
		const swung = swingToTarget(c, held, -10);
		expect(swung.today).toEqual(held.today);
		expect(computeOutcome(c, swung).components.find((x) => x.key === 'today')?.volume).toBe(0);
		expect(computeOutcome(c, swung).margin).toBeCloseTo(-10, 6);
	});

	it('carries a future day into today at midnight', () => {
		const before = buildCtx(countyFeed(), open('2026-10-28'));
		const f = holdTarget(before, { ...rawForecast(before), target: -8 });
		const thursday = f.days.find((d) => d.date === '2026-10-29')!;
		const after = reconcileForecast(buildCtx(countyFeed(), open('2026-10-29')), f);
		expect(after.today?.margin).toBe(thursday.margin);
		expect(after.days.some((d) => d.date === '2026-10-29')).toBe(false);
	});
});
