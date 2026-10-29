<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { updated } from '$app/state';
	import logo from '#lib/assets/favicon.svg';
	import EChart from '#lib/components/EChart.svelte';
	import CountyMap from '#lib/components/CountyMap.svelte';
	import MarginInput from '#lib/components/MarginInput.svelte';
	import MarginSlider from '#lib/components/MarginSlider.svelte';
	import LegendToggle from '#lib/components/LegendToggle.svelte';
	import Info from '#lib/components/Info.svelte';
	import TodayStats from '#lib/components/TodayStats.svelte';
	import { dailyChartOption, marginChartOption, type DailyRow } from '#lib/charts.ts';
	import {
		buildCtx,
		buildHistory,
		computeOutcome,
		defaultForecast,
		ED_RANGE,
		fmtDay,
		fmtInt,
		fmtLead,
		fmtMargin,
		IPEV_RANGE,
		mailRemaining,
		marginOf,
		projectPath,
		rebalanceForecast,
		reconcileForecast,
		REGISTRATION,
		setEdHoldingTarget,
		setIpevHoldingTarget,
		shiftDays,
		swingToTarget,
		todayPlan,
		upgradeForecast
	} from '#lib/model.ts';
	import { decodeForecast, encodeForecast, loadSaved, storeSaved } from '#lib/saved.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { Forecast } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const feed = $derived(data.feed);
	const ctx = $derived(buildCtx(data.feed, data.clock));

	let forecast = $state<Forecast>(untrack(() => defaultForecast(buildCtx(data.feed, data.clock))));
	let saved = $state<Forecast[]>([]);
	let refreshing = $state(false);
	let copied = $state(false);
	let mounted = $state(false);
	let mobile = $state(false);
	let editing = $state(false);
	const locked = $derived(mobile && !editing);

	let mode = $state<'projection' | 'forecast'>('projection');
	const custom = $derived(mode === 'forecast');
	const projection = $derived(defaultForecast(ctx));
	const active = $derived(custom ? forecast : projection);
	const showBenchmark = $derived(custom && !forecast.linked);

	const today = $derived(ctx.current);
	const reportedMail = $derived(
		feed.mailDays.find((d) => d.date === data.clock.today && d.total > 0) ??
			(feed.lastReportedMail?.date === data.clock.today ? feed.lastReportedMail : undefined)
	);
	const history = $derived(buildHistory(feed, data.clock.today));
	const outcome = $derived(computeOutcome(ctx, active));
	const plan = $derived(todayPlan(ctx, active));
	const todayBenchmark = $derived(
		today && outcome.todayBenchmark !== null
			? { date: today.date, volume: today.projectedVolume, margin: outcome.todayBenchmark }
			: null
	);
	const scenarioPath = $derived(projectPath(ctx, active, active.days));
	const benchmarkPath = $derived(
		projectPath(ctx, active, outcome.benchmarks, outcome.todayBenchmark ?? undefined)
	);
	const mailRem = $derived(mailRemaining(ctx, active));
	const live = $derived.by(() => {
		const total = feed.mail.total + feed.early.total;
		const gap = feed.mail.dem + feed.early.dem - feed.mail.rep - feed.early.rep;
		return { total, gap, margin: total ? (gap / total) * 100 : 0 };
	});
	const scenarioEnd = $derived(scenarioPath.at(-1)?.margin ?? live.margin);
	const benchEnd = $derived(benchmarkPath.at(-1)?.margin ?? live.margin);
	const lastComplete = $derived(ctx.complete.at(-1)?.date);
	const regMargin = -((REGISTRATION.rep - REGISTRATION.dem) / REGISTRATION.total) * 100;

	let marginHidden = $state<Record<string, boolean>>({});
	let dailyHidden = $state<Record<string, boolean>>({});
	const visible = (hidden: Record<string, boolean>) =>
		Object.fromEntries(Object.entries(hidden).map(([k, v]) => [k, !v]));

	const marginOption = $derived(
		marginChartOption(
			theme.palette,
			history,
			scenarioPath,
			benchmarkPath,
			{
				scenario: outcome.margin,
				target: active.target,
				showBenchmark,
				inProgressDate: today && !today.pollsClosed ? today.date : undefined,
				projection: !custom
			},
			visible(marginHidden)
		)
	);

	const dailyRows = $derived<DailyRow[]>([
		...ctx.complete.map((d) => ({
			date: d.date,
			reported: { margin: marginOf(d), volume: d.total, gap: d.dem - d.rep }
		})),
		...(today
			? [
					{
						date: today.date,
						inProgress: !today.pollsClosed,
						reference: todayBenchmark?.margin,
						scenario:
							today.pollsClosed || !plan
								? undefined
								: {
										margin: plan.projectedMargin,
										volume: plan.volume,
										gap: (plan.volume * plan.projectedMargin) / 100
									},
						reported: today.soFar?.total
							? {
									margin: marginOf(today.soFar),
									volume: today.soFar.total,
									gap: today.soFar.dem - today.soFar.rep
								}
							: undefined
					}
				]
			: []),
		...active.days.map((d, i) => ({
			date: d.date,
			scenario: { margin: d.margin, volume: d.volume, gap: (d.volume * d.margin) / 100 },
			benchmark: !showBenchmark
				? undefined
				: {
						margin: outcome.benchmarks[i].margin,
						volume: d.volume,
						gap: outcome.benchmarks[i].gap
					}
		}))
	]);
	const dailyOption = $derived(
		dailyChartOption(theme.palette, dailyRows, visible(dailyHidden), !custom)
	);

	const sensitivity = $derived(
		[
			...[-5, -10, -15, -20, -25, -30].filter((ed) => Math.abs(ed - active.edMargin) >= 0.05),
			active.edMargin
		]
			.sort((a, b) => b - a)
			.map((ed) => {
				const o = computeOutcome(ctx, { ...active, edMargin: ed });
				return {
					ed,
					current: ed === active.edMargin,
					required: o.requiredIpevMargin,
					requiredGap: o.requiredIpevGap,
					final: o.margin,
					finalGap: o.gap
				};
			})
	);

	const pathOffset = $derived(today ? 1 : 0);

	onMount(() => {
		const media = matchMedia('(max-width: 767px)');
		const updateMobile = () => (mobile = media.matches);
		updateMobile();
		media.addEventListener('change', updateMobile);
		return () => media.removeEventListener('change', updateMobile);
	});

	onMount(() => {
		theme.init();
		saved = loadSaved().map((f) => upgradeForecast(ctx, f));
		storeSaved(saved);
		const fromHash = new URLSearchParams(location.hash.slice(1)).get('f');
		const shared = fromHash ? decodeForecast(fromHash) : null;
		const stored = (() => {
			try {
				return JSON.parse(localStorage.getItem('fl-ev-current') ?? 'null') as Forecast | null;
			} catch {
				return null;
			}
		})();
		const initial = shared ?? (stored?.linked === undefined ? null : stored);
		if (initial) applyForecast(initial);
		mode = shared || localStorage.getItem('fl-ev-mode') === 'forecast' ? 'forecast' : 'projection';
		mounted = true;
	});

	$effect(() => {
		const snapshot = JSON.stringify(forecast);
		if (mounted) localStorage.setItem('fl-ev-current', snapshot);
	});

	$effect(() => {
		const current = mode;
		if (mounted) localStorage.setItem('fl-ev-mode', current);
	});

	$effect(() => {
		const dates = [ctx.current?.date, ...ctx.futureDates].join();
		const current = untrack(() =>
			[forecast.today?.date, ...forecast.days.map((d) => d.date)].join()
		);
		if (dates !== current) {
			untrack(() => (forecast = reconcileForecast(ctx, $state.snapshot(forecast))));
		}
	});

	$effect(() => {
		const context = ctx;
		if (
			forecast.linked &&
			(forecast.balance === 'adaptive' || Math.abs(computeOutcome(ctx, forecast).cushion) > 0.5)
		) {
			untrack(() => {
				const current = $state.snapshot(forecast);
				const next = rebalanceForecast(context, current);
				if (JSON.stringify(next) !== JSON.stringify(current)) forecast = next;
			});
		}
	});

	function applyForecast(f: Forecast) {
		f = upgradeForecast(ctx, f);
		const base = defaultForecast(ctx);
		const mailFinal =
			f.mailFinal ??
			(f.mailRemaining !== undefined ? feed.mail.total + f.mailRemaining : base.mailFinal);
		forecast = reconcileForecast(ctx, {
			...base,
			...f,
			mailFinal,
			mailRemaining: undefined,
			linked: f.linked ?? false,
			days: f.days ?? [],
			today: f.today
		});
	}

	function setTarget(v: number) {
		if (forecast.linked) forecast = swingToTarget(ctx, $state.snapshot(forecast), v);
		else forecast.target = v;
	}

	function setEdMargin(v: number) {
		if (forecast.linked) forecast = setEdHoldingTarget(ctx, $state.snapshot(forecast), v);
		else forecast.edMargin = v;
	}

	function setIpevMargin(v: number) {
		const f = $state.snapshot(forecast);
		forecast = forecast.linked
			? setIpevHoldingTarget(ctx, f, v)
			: shiftDays(ctx, f, v - outcome.scenarioIpevMargin);
	}

	function resetDays() {
		const defaults = defaultForecast(ctx);
		forecast.days = defaults.days;
		forecast.today = defaults.today;
		forecast.balance = 'adaptive';
	}

	function resetAll() {
		forecast = { ...defaultForecast(ctx), name: forecast.name };
	}

	function save() {
		const name = forecast.name.trim() || 'Untitled forecast';
		const copy: Forecast = JSON.parse(JSON.stringify({ ...forecast, name }));
		saved = [...saved.filter((s) => s.name !== name), copy];
		storeSaved(saved);
		forecast.name = name;
	}

	function remove(name: string) {
		saved = saved.filter((s) => s.name !== name);
		storeSaved(saved);
	}

	async function share() {
		const url = `${location.origin}${location.pathname}#f=${encodeForecast($state.snapshot(forecast))}`;
		window.history.replaceState(window.history.state, '', url);
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			if (await updated.check().catch(() => false)) {
				localStorage.setItem('fl-ev-current', JSON.stringify(forecast));
				location.reload();
				return;
			}
			await invalidate('app:feed');
		} finally {
			refreshing = false;
		}
	}

	const marginClass = (v: number) => (v < 0 ? 'text-rep' : 'text-dem');
	const fetched = $derived(
		new Date(feed.fetchedAt).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		})
	);
</script>

<svelte:head>
	<title>Florida Vote Forecaster (2026)</title>
	<meta
		name="description"
		content="Florida 2026 early vote (IPEV + mail) tracker with forecast and daily benchmark builder."
	/>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 py-4 sm:px-6">
	<header class="page-header mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
		<h1 class="flex items-center gap-2.5 text-lg font-semibold tracking-tight sm:text-xl">
			<img src={logo} alt="" class="logo" width="28" height="28" />
			<span>Florida Vote Forecaster</span>
		</h1>
		<div class="mode-toggle" role="group" aria-label="View">
			<button type="button" aria-pressed={!custom} onclick={() => (mode = 'projection')}
				>Live projection</button
			>
			<button type="button" aria-pressed={custom} onclick={() => (mode = 'forecast')}
				>Custom forecast</button
			>
		</div>
		<div class="header-tools flex flex-wrap items-center gap-2 text-sm">
			<span class="text-muted inline-flex items-center text-xs">
				{#if today}
					<span class="font-medium" style:color="var(--ink-2)">
						{fmtDay(today.date)} · {today.pollsClosed ? 'polls closed' : 'live'}
					</span>
					<span class="mx-1.5">·</span>
				{:else if lastComplete}
					Final through {fmtDay(lastComplete)}<span class="mx-1.5">·</span>
				{/if}
				Updated {fetched}
			</span>
			<button
				class="btn header-btn"
				onclick={refresh}
				disabled={refreshing}
				aria-label="Refresh data"
			>
				<span class="label">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
				<span class="icon" aria-hidden="true">↻</span>
			</button>
			<button class="btn header-btn" onclick={() => theme.toggle()} aria-label="Toggle color theme">
				<span class="label">{theme.mode === 'dark' ? 'Light' : 'Dark'}</span>
				<span class="icon" aria-hidden="true">{theme.mode === 'dark' ? '☀' : '☾'}</span>
			</button>
		</div>
		{#if feed.stale}
			<p class="w-full rounded-lg px-3 py-2 text-sm" style:background="var(--wash)" role="status">
				⚠ Source unavailable - showing data from {fetched}.
			</p>
		{:else if feed.partial}
			<p class="w-full rounded-lg px-3 py-2 text-sm" style:background="var(--wash)" role="status">
				⚠ Source updating - data received from {feed.received ?? 0}/67 counties.
			</p>
		{/if}
	</header>

	{#snippet stat(label: string, margin: number, sub: string, info?: string, hero = false)}
		<div class="card p-4" class:headline-hero={hero}>
			<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
				{label}{#if info}<Info align="left">{info}</Info>{/if}
			</div>
			<div class="mt-1 text-2xl font-semibold {marginClass(margin)}">{fmtMargin(margin, 2)}</div>
			<div class="text-2 text-sm">{sub}</div>
		</div>
	{/snippet}

	{#snippet marginCard()}
		<section class="card p-4">
			<h2 class="mb-2 flex items-center text-base font-semibold">
				Total early-vote margin by day
				<Info align="left">
					IPEV + mail, cumulative. Projected days spread remaining mail evenly. Election Day isn't
					on this line.
				</Info>
			</h2>
			<LegendToggle
				bind:hidden={marginHidden}
				items={[
					{ name: 'Reported', swatch: 'solid' },
					{ name: custom ? 'Your scenario' : 'Projection', swatch: 'dashed' },
					...(showBenchmark
						? [{ name: 'Benchmark path to target', swatch: 'dotted' as const }]
						: [])
				]}
			/>
			<EChart
				option={marginOption}
				height={custom ? 400 : 360}
				label="Cumulative early vote margin by day, reported and projected"
			/>
			{#if custom && forecast.days.length}
				<div
					class="num text-2 mt-3 space-y-1 rounded-lg p-3 text-sm"
					style:background="var(--wash)"
				>
					<div class="path-row flex flex-wrap items-center gap-x-2">
						<b class="w-28" style:color="var(--ink)">
							{forecast.linked ? `Path to ${fmtMargin(forecast.target)}` : 'Your scenario'}
						</b>
						<span
							>IPEV <span class={marginClass(outcome.scenarioIpevMargin)}
								>{fmtMargin(outcome.scenarioIpevMargin)}</span
							></span
						>
						<span class="text-muted">+</span>
						<span
							>mail <span class={marginClass(forecast.mailMargin)}
								>{fmtMargin(forecast.mailMargin)}</span
							></span
						>
						<span class="text-muted">→</span>
						<span
							>early vote ends <span class={marginClass(scenarioEnd)}
								>{fmtMargin(scenarioEnd, 2)}</span
							></span
						>
						<span class="text-muted">→</span>
						<span
							>Election Day <span class={marginClass(forecast.edMargin)}
								>{fmtMargin(forecast.edMargin)}</span
							></span
						>
						<span class="text-muted">→</span>
						<span
							>final <span class={marginClass(outcome.margin)}>{fmtMargin(outcome.margin, 2)}</span
							></span
						>
					</div>
					{#if showBenchmark}
						<div class="path-row flex flex-wrap items-center gap-x-2">
							<b class="w-28" style:color="var(--ink)">Benchmark</b>
							<span
								>IPEV <span class={marginClass(outcome.requiredIpevMargin)}
									>{fmtMargin(outcome.requiredIpevMargin)}</span
								></span
							>
							<span class="text-muted">+</span>
							<span
								>mail <span class={marginClass(forecast.mailMargin)}
									>{fmtMargin(forecast.mailMargin)}</span
								></span
							>
							<span class="text-muted">→</span>
							<span
								>early vote ends <span class={marginClass(benchEnd)}>{fmtMargin(benchEnd, 2)}</span
								></span
							>
							<span class="text-muted">→</span>
							<span
								>Election Day <span class={marginClass(forecast.edMargin)}
									>{fmtMargin(forecast.edMargin)}</span
								></span
							>
							<span class="text-muted">→</span>
							<span
								>final <span class={marginClass(forecast.target)}
									>{fmtMargin(forecast.target, 2)}</span
								></span
							>
						</div>
						<div class="flex items-center">
							{#if Math.abs(outcome.cushion) < 1}
								Lines match - your scenario hits the target.
							{:else}
								Gap: <b class="mx-1" style:color="var(--ink)"
									>{fmtInt(Math.abs(outcome.cushion))} votes</b
								>
								{outcome.cushion < 0 ? 'too Republican' : 'to spare'}
							{/if}
							<Info align="left">
								Both lines share the same mail and Election Day; they differ only in how the
								remaining {fmtInt(outcome.ipevRemainingVolume)} IPEV votes break.
							</Info>
						</div>
					{/if}
				</div>
			{/if}
		</section>
	{/snippet}

	{#snippet tables()}
		<section class="forecast-tables grid gap-6 xl:grid-cols-2">
			<div class="forecast-table card min-w-0 p-4">
				<h2 class="mb-3 flex min-h-6 items-center text-base font-semibold">
					How the final vote adds up
				</h2>
				<div class="overflow-x-auto">
					<table class="num w-full text-sm">
						<thead>
							<tr class="text-muted text-xs leading-tight">
								<th class="pr-2 pb-2 text-left align-bottom font-medium">Component</th>
								<th class="pb-2 pl-3 text-right align-bottom font-medium">Voters</th>
								<th class="pb-2 pl-3 text-right align-bottom font-medium">Margin</th>
								<th class="pb-2 pl-3 text-right align-bottom font-medium">Lead</th>
							</tr>
						</thead>
						<tbody>
							{#each outcome.components as c (c.key)}
								<tr class="border-t" style:border-color="var(--border)">
									<td class="py-2 pr-2 leading-tight">
										{c.label}
										{#if c.projected}<span class="text-muted block text-xs">projected</span>{/if}
									</td>
									<td class="py-2 pl-3 text-right whitespace-nowrap">{fmtInt(c.volume)}</td>
									<td class="py-2 pl-3 text-right whitespace-nowrap {marginClass(c.gap)}">
										{fmtMargin(c.volume ? (c.gap / c.volume) * 100 : 0)}
									</td>
									<td class="py-2 pl-3 text-right whitespace-nowrap">{fmtLead(c.gap)}</td>
								</tr>
							{/each}
							<tr class="border-t-2 font-semibold" style:border-color="var(--axis)">
								<td class="py-2 pr-2">Final electorate</td>
								<td class="py-2 pl-3 text-right whitespace-nowrap">{fmtInt(outcome.total)}</td>
								<td class="py-2 pl-3 text-right whitespace-nowrap {marginClass(outcome.margin)}">
									{fmtMargin(outcome.margin, 2)}
								</td>
								<td class="py-2 pl-3 text-right whitespace-nowrap">{fmtLead(outcome.gap)}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>

			<div class="forecast-table card min-w-0 p-4">
				<h2 class="mb-3 flex min-h-6 items-center text-base font-semibold">
					{custom ? 'IPEV needed by Election Day margin' : 'Final by Election Day margin'}
					<Info align="right">
						{#if custom}
							For a {fmtMargin(forecast.target)} final with your mail and turnout. "Needed" means that
							margin or more Democratic. The last column holds the remaining IPEV at your forecast.
						{:else}
							Final result if Election Day lands on each margin, with early vote and mail as
							projected. The shaded row is the projection.
						{/if}
					</Info>
				</h2>
				<div class="overflow-x-auto">
					<table class="num w-full text-sm">
						<thead>
							<tr class="text-muted text-xs leading-tight">
								<th class="pr-2 pb-2 pl-1 text-left align-bottom font-medium">Election Day</th>
								{#if custom}
									<th class="pb-2 pl-3 text-right align-bottom font-medium">IPEV needed</th>
									<th class="pb-2 pl-3 text-right align-bottom font-medium">IPEV lead</th>
									<th class="pb-2 pl-3 text-right align-bottom font-medium"
										>Final at IPEV forecast</th
									>
								{:else}
									<th class="pb-2 pl-3 text-right align-bottom font-medium">Final margin</th>
									<th class="pb-2 pl-3 text-right align-bottom font-medium">Final lead</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each sensitivity as s (s.ed)}
								<tr
									class="border-t"
									style:border-color="var(--border)"
									style:background={s.current ? 'var(--wash)' : undefined}
								>
									<td class="py-2 pr-2 pl-1 font-medium whitespace-nowrap {marginClass(s.ed)}">
										{fmtMargin(s.ed)}
										{#if s.current && !custom}<span class="text-muted ml-1 text-xs font-normal"
												>projected</span
											>{/if}
									</td>
									{#if custom}
										<td
											class="py-2 pl-3 text-right font-semibold whitespace-nowrap {marginClass(
												s.required
											)}"
										>
											{fmtMargin(s.required, 2)}
										</td>
										<td class="py-2 pl-3 text-right whitespace-nowrap">{fmtLead(s.requiredGap)}</td>
										<td class="py-2 pl-3 text-right whitespace-nowrap {marginClass(s.final)}">
											{fmtMargin(s.final, 2)}
										</td>
									{:else}
										<td
											class="py-2 pl-3 text-right font-semibold whitespace-nowrap {marginClass(
												s.final
											)}"
										>
											{fmtMargin(s.final, 2)}
										</td>
										<td class="py-2 pl-3 text-right whitespace-nowrap">{fmtLead(s.finalGap)}</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	{/snippet}

	{#snippet dailyCard()}
		<section class="card p-4">
			<h2 class="mb-2 flex items-center text-base font-semibold">
				Daily IPEV margins
				{#if showBenchmark}
					<Info align="left">
						Benchmarks shift your daily shape {Math.abs(outcome.shift).toFixed(2)} pts toward
						{outcome.shift >= 0 ? 'Democrats' : 'Republicans'} to land on {fmtMargin(
							forecast.target
						)}.
					</Info>
				{/if}
			</h2>
			<LegendToggle
				bind:hidden={dailyHidden}
				items={[
					{ name: 'Reported IPEV', swatch: 'bar' },
					{ name: custom ? 'Your scenario' : 'Projection', swatch: 'bar-faded' },
					...(showBenchmark ? [{ name: 'Benchmark', swatch: 'tick' as const }] : [])
				]}
			/>
			<div class="daily-chart overflow-x-auto">
				<EChart
					option={dailyOption}
					height={340}
					mobileMinWidth={Math.max(640, dailyRows.length * 52 + 72)}
					label="Daily in-person early vote margins, reported and projected"
				/>
			</div>

			<p class="text-muted mt-1 text-xs md:hidden">Swipe the chart or table to see all days.</p>
			<div
				class="daily-table mt-4 overflow-x-auto"
				style:--table-width={showBenchmark ? '920px' : '640px'}
			>
				<table class="num w-full text-sm">
					<thead>
						<tr class="text-muted text-left text-xs">
							<th class="pb-2 font-medium">Day</th>
							<th class="pb-2 text-right font-medium">IPEV votes</th>
							<th class="pb-2 text-right font-medium">Margin</th>
							<th class="pb-2 text-right font-medium">Lead</th>
							{#if showBenchmark}
								<th class="pb-2 text-right font-medium">Benchmark</th>
								<th class="pb-2 text-right font-medium">Benchmark lead</th>
							{/if}
							<th class="pb-2 text-right font-medium">Running total</th>
						</tr>
					</thead>
					<tbody>
						{#each ctx.complete as d, i (d.date)}
							<tr class="border-t" style:border-color="var(--border)">
								<td class="py-1.5 whitespace-nowrap">{fmtDay(d.date, true)}</td>
								<td class="text-right">{fmtInt(d.total)}</td>
								<td class="text-right {marginClass(marginOf(d))}">{fmtMargin(marginOf(d))}</td>
								<td class="text-right">{fmtLead(d.dem - d.rep)}</td>
								{#if showBenchmark}
									<td class="text-muted text-right">reported</td>
									<td class="text-muted text-right">-</td>
								{/if}
								<td class="text-right {marginClass(history[i].margin)}">
									{fmtMargin(history[i].margin, 2)}
								</td>
							</tr>
						{/each}
						{#if today}
							{@const hasCounts = (today.soFar?.total ?? 0) > 0}
							{@const expectedMargin = plan?.margin ?? today.projectedMargin}
							{@const expectedVolume = today.projectedVolume}
							{@const rowMargin = hasCounts ? marginOf(today.soFar!) : expectedMargin}
							{@const rowGap = hasCounts
								? today.soFar!.dem - today.soFar!.rep
								: (expectedVolume * expectedMargin) / 100}
							{@const runningMargin = hasCounts ? live.margin : scenarioPath[0].margin}
							<tr
								class="border-t"
								style:border-color="var(--border)"
								style:background={today.pollsClosed ? undefined : 'var(--wash)'}
							>
								<td class="py-1.5 whitespace-nowrap">
									{fmtDay(today.date, true)}
									<span class="text-muted block text-xs">
										{hasCounts
											? today.pollsClosed
												? 'Reported'
												: 'So far · in progress'
											: 'Projected'}
									</span>
								</td>
								<td class="text-right">
									{fmtInt(hasCounts ? today.soFar!.total : expectedVolume)}
									{#if hasCounts && !today.pollsClosed}<span class="text-muted block text-xs"
											>Est. {fmtInt(today.projectedVolume)}</span
										>{/if}
								</td>
								<td class="text-right {marginClass(rowMargin)}">
									{fmtMargin(rowMargin)}
									{#if hasCounts && todayBenchmark}<span class="text-muted block text-xs"
											>{custom ? 'Needed' : 'Proj.'}
											{fmtMargin(todayBenchmark.margin, custom ? 2 : 1)}</span
										>{/if}
								</td>
								<td class="text-right">{fmtLead(rowGap)}</td>
								{#if showBenchmark}
									<td class="text-muted text-right"
										>{todayBenchmark ? fmtMargin(todayBenchmark.margin, 2) : '-'}</td
									>
									<td class="text-muted text-right"
										>{todayBenchmark
											? fmtLead((todayBenchmark.volume * todayBenchmark.margin) / 100)
											: '-'}</td
									>
								{/if}
								<td class="text-right {marginClass(runningMargin)}">
									{fmtMargin(runningMargin, 2)}
								</td>
							</tr>
						{/if}
						{#each outcome.benchmarks as b, i (b.date)}
							<tr
								class="border-t"
								style:border-color="var(--border)"
								style:background="var(--wash)"
							>
								<td class="py-1.5 whitespace-nowrap">{fmtDay(b.date, true)}</td>
								<td class="text-right">{fmtInt(b.volume)}</td>
								<td class="text-right {marginClass(active.days[i].margin)}">
									{fmtMargin(active.days[i].margin)}
								</td>
								<td class="text-right">
									{fmtLead((active.days[i].volume * active.days[i].margin) / 100)}
								</td>
								{#if showBenchmark}
									<td class="text-right font-semibold {marginClass(b.margin)}">
										{fmtMargin(b.margin)}
									</td>
									<td class="text-right">{fmtLead(b.gap)}</td>
								{/if}
								<td class="text-right {marginClass(scenarioPath[i + pathOffset].margin)}">
									{fmtMargin(scenarioPath[i + pathOffset].margin, 2)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="text-muted mt-3 pb-1 text-xs">Shaded rows are projected.</p>
		</section>
	{/snippet}

	{#snippet notes()}
		<section class="text-muted px-1 text-xs">
			R+5 means Republicans outnumber Democrats by 5% of all voters, including NPA. Data from
			<a class="underline" href={feed.source} target="_blank" rel="noreferrer"
				>{feed.source.replace('https://', '').replace(/\/$/, '')}</a
			>, compiled from county supervisor feeds.
		</section>
	{/snippet}

	{#if custom}
		<section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Headline numbers">
			{@render stat(
				'Total cast',
				live.margin,
				`${fmtLead(live.gap)} · ${fmtInt(live.total)} voters`
			)}
			{@render stat(
				'Your final',
				outcome.margin,
				`${fmtLead(outcome.gap)} · ${fmtInt(outcome.total)} voters`,
				'Final electorate from your forecast, including Election Day.',
				true
			)}
			<div class="card p-4">
				<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
					IPEV needed<Info align="right"
						>Average margin the remaining IPEV needs for your target at your Election Day margin.</Info
					>
				</div>
				<div class="mt-1 text-2xl font-semibold {marginClass(outcome.requiredIpevMargin)}">
					{fmtMargin(outcome.requiredIpevMargin, 2)}
				</div>
				<div class="text-2 text-sm">
					for {fmtMargin(forecast.target)} · ED {fmtMargin(forecast.edMargin)}
				</div>
			</div>
		</section>

		<div class="grid gap-6 lg:grid-cols-[360px_1fr]">
			<aside class="card h-fit p-4 lg:sticky lg:top-4" aria-label="Forecast inputs">
				<div class="forecast-controls mb-4 flex items-center justify-between gap-2">
					<h2 class="text-base font-semibold">Your forecast</h2>
					<button
						type="button"
						class="edit-toggle btn md:hidden"
						class:btn-primary={!editing}
						aria-pressed={editing}
						onclick={() => (editing = !editing)}>{editing ? 'Done' : 'Edit'}</button
					>
					<span class="inline-flex items-center">
						<label class="text-2 flex cursor-pointer items-center gap-2 text-sm">
							<input
								type="checkbox"
								class="peer sr-only"
								disabled={locked}
								bind:checked={forecast.linked}
							/>
							<span class="switch" aria-hidden="true"></span>
							Lock to target
						</label>
						<Info align="right">
							Keeps the final on your target. Moving Election Day or IPEV re-solves the other.
						</Info>
					</span>
				</div>
				{#if locked}
					<p class="text-muted -mt-2 mb-4 text-xs md:hidden" role="status">
						Inputs are locked so scrolling can't change them. Tap Edit to make changes.
					</p>
				{/if}

				<MarginSlider
					label="Target final electorate"
					bind:value={() => forecast.target, setTarget}
					disabled={locked}
					min={-15}
					max={5}
				>
					{#snippet info()}
						Final party margin of everyone who votes. For reference, the registration gap is
						{fmtMargin(regMargin)}.
					{/snippet}
				</MarginSlider>

				<MarginSlider
					label="Election Day margin"
					bind:value={() => forecast.edMargin, setEdMargin}
					disabled={locked}
					min={ED_RANGE.min}
					max={ED_RANGE.max}
				>
					{#snippet info()}
						Margin of {fmtInt(forecast.edTurnout)} Election Day voters (turnout is under Advanced).
					{/snippet}
				</MarginSlider>

				{#if forecast.days.length}
					<MarginSlider
						label="Remaining IPEV margin"
						bind:value={() => outcome.scenarioIpevMargin, setIpevMargin}
						disabled={locked}
						min={IPEV_RANGE.min}
						max={IPEV_RANGE.max}
					>
						{#snippet hint()}
							{fmtInt(outcome.ipevRemainingVolume)} votes left
						{/snippet}
						{#snippet info()}
							Average over {fmtDay(forecast.days[0].date)} - {fmtDay(
								forecast.days[forecast.days.length - 1].date
							)}. Moving it shifts every day equally; edit single days under Advanced.
						{/snippet}
					</MarginSlider>
				{/if}

				<div class="mb-4 rounded-lg p-3 text-sm" style:background="var(--wash)" role="status">
					<div class="flex items-baseline justify-between">
						<span class="text-2">Final electorate</span>
						<span class="num text-lg font-semibold {marginClass(outcome.margin)}">
							{fmtMargin(outcome.margin, 2)}
						</span>
					</div>
					<div class="text-2 mt-0.5">
						{#if forecast.linked && Math.abs(outcome.cushion) <= 0.5}
							On target
						{:else if forecast.linked}
							Target is outside the current limits by <b>{fmtInt(Math.abs(outcome.cushion))}</b> votes
						{:else if outcome.cushion >= 0}
							Beats {fmtMargin(forecast.target)} by <b>{fmtInt(outcome.cushion)}</b> votes
						{:else}
							Misses {fmtMargin(forecast.target)} by <b>{fmtInt(-outcome.cushion)}</b> votes
						{/if}
					</div>
				</div>

				<details class="mb-4 border-t pt-3" style:border-color="var(--border)">
					<summary class="cursor-pointer text-sm font-semibold">Advanced</summary>

					<div class="mt-3 grid grid-cols-2 gap-2 text-sm">
						<label>
							<span class="text-2 mb-1 block">Election Day voters</span>
							<input
								class="field w-full"
								type="number"
								step="50000"
								min="0"
								disabled={locked}
								bind:value={forecast.edTurnout}
							/>
						</label>
						<span></span>
						<label>
							<span class="text-2 mb-1 block">Final mail total</span>
							<input
								class="field w-full"
								type="number"
								step="10000"
								min="0"
								disabled={locked}
								bind:value={forecast.mailFinal}
							/>
						</label>
						<label>
							<span class="text-2 mb-1 block">Margin of the rest</span>
							<MarginInput
								label="Remaining mail"
								disabled={locked}
								bind:value={forecast.mailMargin}
							/>
						</label>
					</div>
					<p class="text-muted mt-1 inline-flex items-center text-xs">
						{fmtInt(mailRem)} still to come
						<Info align="left">
							{fmtInt(feed.mail.total)} returned so far and {fmtInt(feed.outstanding.total)} outstanding
							({fmtMargin(marginOf(feed.outstanding))}). The default margin applies each party's
							return rate over the last 7 days to its outstanding ballots. What's left shrinks
							automatically as ballots arrive.
						</Info>
					</p>

					{#if today}
						<div class="text-2 mt-4 mb-1 flex items-center text-sm">
							Today ({today.pollsClosed ? 'reported' : 'locked'})
							<Info align="left">
								{#if today.pollsClosed}Polls have closed. This day shows reported counts; late
									uploads still count.
								{:else}Needed full day: {fmtInt(today.projectedVolume)} at {fmtMargin(
										plan?.projectedMargin ?? today.projectedMargin
									)}, so {fmtInt(today.restVolume)} more expected. Today's margin moves with the upcoming
									days when the target or days change.{/if} Becomes reported data after midnight.
							</Info>
						</div>
						<p class="text-muted text-xs">
							{fmtDay(today.date, true)}: {today.soFar
								? `${fmtInt(today.soFar.total)} counted (${fmtMargin(marginOf(today.soFar))})`
								: 'none counted yet'}
						</p>
					{/if}

					{#if forecast.days.length}
						<div class="text-2 mt-4 mb-1 flex items-center text-sm">
							Upcoming IPEV days
							<Info align="left">
								Defaults: votes from the same weekday last week times growth in counties open both
								weeks; margins from the last 3 weekdays plus most of last weekend's swing. The final
								Sunday uses only the counties that open that day, at reduced turnout.
							</Info>
						</div>
						<div class="daily-inputs overflow-x-auto">
							<table class="num w-full text-sm">
								<thead>
									<tr class="text-muted text-left text-xs">
										<th class="pb-1 font-medium">Day</th>
										<th class="pb-1 font-medium">Votes</th>
										<th class="pb-1 font-medium">Margin</th>
									</tr>
								</thead>
								<tbody>
									{#each forecast.days as d (d.date)}
										<tr>
											<td class="pr-2 whitespace-nowrap">{fmtDay(d.date, true)}</td>
											<td class="py-0.5 pr-1">
												<input
													class="field w-24"
													type="number"
													step="5000"
													min="0"
													disabled={locked}
													aria-label="{fmtDay(d.date)} votes"
													bind:value={
														() => d.volume,
														(v) => {
															d.volume = v;
															forecast.balance = 'ipev';
														}
													}
												/>
											</td>
											<td class="py-0.5">
												<MarginInput
													label={fmtDay(d.date)}
													disabled={locked}
													bind:value={
														() => d.margin,
														(v) => {
															d.margin = v;
															forecast.balance = 'ipev';
														}
													}
													compact
												/>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<button class="btn mt-2" disabled={locked} onclick={resetDays}>Reset days</button>
					{/if}
				</details>

				<div class="border-t pt-3" style:border-color="var(--border)">
					<div class="flex gap-2">
						<input
							class="field min-w-0 flex-1 text-sm"
							aria-label="Forecast name"
							disabled={locked}
							bind:value={forecast.name}
						/>
						<button class="btn btn-primary" disabled={locked} onclick={save}>Save</button>
					</div>
					<div class="forecast-actions mt-2 flex flex-wrap gap-2">
						{#if saved.length}
							<select
								class="field min-w-0 flex-1 text-sm"
								aria-label="Load a saved forecast"
								disabled={locked}
								value=""
								onchange={(e) => {
									const s = saved.find((x) => x.name === e.currentTarget.value);
									if (s) applyForecast(s);
									e.currentTarget.value = '';
								}}
							>
								<option value="" disabled>Load saved…</option>
								{#each saved as s (s.name)}
									<option value={s.name}>{s.name}</option>
								{/each}
							</select>
							{#if saved.some((s) => s.name === forecast.name)}
								<button class="btn" disabled={locked} onclick={() => remove(forecast.name)}
									>Delete</button
								>
							{/if}
						{/if}
						<button class="btn" onclick={share}>{copied ? 'Link copied' : 'Share link'}</button>
						<button class="btn" disabled={locked} onclick={resetAll}>Reset</button>
					</div>
				</div>
			</aside>

			<div class="min-w-0 space-y-6">
				{@render marginCard()}
				{@render tables()}
				{@render dailyCard()}
				{@render notes()}
			</div>
		</div>
	{:else}
		{#if today}
			<div class="mb-3 hidden md:block">
				<TodayStats
					{today}
					benchmark={todayBenchmark}
					mailBenchmark={projection.mailMargin}
					mail={reportedMail}
				/>
			</div>
		{/if}

		<section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Headline numbers">
			{@render stat(
				'Total cast',
				live.margin,
				`${fmtLead(live.gap)} · ${fmtInt(live.total)} voters`
			)}
			{@render stat(
				'IPEV',
				marginOf(feed.early),
				`${fmtLead(feed.early.dem - feed.early.rep)} · ${fmtInt(feed.early.total)}`
			)}
			{@render stat(
				'Mail returned',
				marginOf(feed.mail),
				`${fmtLead(feed.mail.dem - feed.mail.rep)} · ${fmtInt(feed.mail.total)}`
			)}
			{@render stat(
				'Projected Election Day',
				projection.edMargin,
				`${fmtLead((projection.edTurnout * projection.edMargin) / 100)} · ${fmtInt(projection.edTurnout)}`
			)}
			{@render stat(
				'Projected final',
				outcome.margin,
				`${fmtLead(outcome.gap)} · ${fmtInt(outcome.total)} voters`,
				'Final electorate including Election Day, from the default projection.',
				true
			)}
		</section>

		<div class="space-y-6">
			{@render marginCard()}
			{@render tables()}
			{@render dailyCard()}
			{#if today}
				<div class="md:hidden">
					<TodayStats
						{today}
						benchmark={todayBenchmark}
						mailBenchmark={projection.mailMargin}
						mail={reportedMail}
					/>
				</div>
			{/if}
			<section class="card p-4">
				<h2 class="mb-3 text-base font-semibold">By county</h2>
				<CountyMap counties={feed.counties} days={feed.earlyDays} currentDate={today?.date} />
			</section>
			{@render notes()}
		</div>
	{/if}
</main>

<style>
	.page-header {
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
	}
	.header-tools {
		margin-left: auto;
		justify-content: flex-end;
	}
	.logo {
		flex: none;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0.2rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	.header-btn .icon {
		display: none;
	}
	.mode-toggle {
		display: inline-flex;
		gap: 3px;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--wash);
	}
	.mode-toggle button {
		position: relative;
		padding: 0.3rem 0.8rem;
		border-radius: 6px;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--ink-2);
		cursor: pointer;
	}
	.mode-toggle button + button::before {
		content: '';
		position: absolute;
		top: 20%;
		bottom: 20%;
		left: -2px;
		width: 1px;
		background: var(--border);
	}
	.mode-toggle button:hover:not([aria-pressed='true']) {
		color: var(--ink);
	}
	.mode-toggle button[aria-pressed='true'] {
		background: var(--ink);
		color: var(--surface);
		font-weight: 600;
	}
	@media (max-width: 767px) {
		.page-header h1 {
			order: 1;
			flex: 1 1 0;
			min-width: 0;
		}
		.header-tools {
			display: contents;
		}
		.header-btn {
			order: 2;
			min-height: 36px;
			min-width: 36px;
			padding: 0 0.5rem;
		}
		.header-btn .label {
			display: none;
		}
		.header-btn .icon {
			display: inline;
			font-size: 1rem;
		}
		.header-tools > span {
			order: 3;
			flex-basis: 100%;
		}
		.mode-toggle {
			order: 4;
			width: 100%;
		}
		.mode-toggle button {
			flex: 1;
			min-height: 36px;
		}
		.page-header > p {
			order: 5;
		}
	}
	@media (min-width: 1280px) {
		.forecast-table {
			display: grid;
			grid-row: span 2;
			grid-template-rows: subgrid;
			row-gap: 0;
		}
		.forecast-table > div {
			align-self: start;
		}
	}
</style>
