<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { updated } from '$app/state';
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
		currentDayBenchmark,
		defaultForecast,
		fmtDay,
		fmtInt,
		fmtLead,
		fmtMargin,
		holdTarget,
		mailRemaining,
		marginOf,
		projectPath,
		reconcileDays,
		REGISTRATION,
		setIpevHoldingTarget,
		shiftDays,
		swingToTarget,
		upgradeForecast
	} from '#lib/model.ts';
	import { decodeForecast, encodeForecast, loadSaved, storeSaved } from '#lib/saved.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { Forecast } from '#lib/types.ts';
	import type { PageProps } from './$types';

	const AUTO_REFRESH_MS = 5 * 60 * 1000;

	let { data }: PageProps = $props();
	const feed = $derived(data.feed);
	const ctx = $derived(buildCtx(data.feed, data.clock));

	let forecast = $state<Forecast>(untrack(() => defaultForecast(buildCtx(data.feed, data.clock))));
	let saved = $state<Forecast[]>([]);
	let refreshing = $state(false);
	let copied = $state(false);
	let mounted = $state(false);

	const today = $derived(ctx.current);
	const reportedMail = $derived(
		feed.mailDays.find((d) => d.date === data.clock.today && d.total > 0) ??
			(feed.lastReportedMail?.date === data.clock.today ? feed.lastReportedMail : undefined)
	);
	const todayBenchmark = $derived(currentDayBenchmark(ctx));
	const history = $derived(buildHistory(feed, data.clock.today));
	const outcome = $derived(computeOutcome(ctx, forecast));
	const scenarioPath = $derived(projectPath(ctx, forecast, forecast.days));
	const benchmarkPath = $derived(projectPath(ctx, forecast, outcome.benchmarks));
	const mailRem = $derived(mailRemaining(ctx, forecast));
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
				target: forecast.target,
				showBenchmark: !forecast.linked,
				inProgressDate: today && !today.pollsClosed ? today.date : undefined
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
						scenario: today.pollsClosed
							? undefined
							: {
									margin: today.projectedMargin,
									volume: today.projectedVolume,
									gap: (today.projectedVolume * today.projectedMargin) / 100
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
		...forecast.days.map((d, i) => ({
			date: d.date,
			scenario: { margin: d.margin, volume: d.volume, gap: (d.volume * d.margin) / 100 },
			benchmark: forecast.linked
				? undefined
				: {
						margin: outcome.benchmarks[i].margin,
						volume: d.volume,
						gap: outcome.benchmarks[i].gap
					}
		}))
	]);
	const dailyOption = $derived(dailyChartOption(theme.palette, dailyRows, visible(dailyHidden)));

	const sensitivity = $derived(
		[-5, -10, -15, -20, -25].map((ed) => {
			const o = computeOutcome(ctx, { ...forecast, edMargin: ed });
			return {
				ed,
				required: o.requiredIpevMargin,
				requiredGap: o.requiredIpevGap,
				final: o.margin
			};
		})
	);

	const pathOffset = $derived(today ? 1 : 0);

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
		mounted = true;

		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void refresh();
		}, AUTO_REFRESH_MS);
		const onVisible = () => {
			if (document.visibilityState === 'visible') void refresh();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	$effect(() => {
		const snapshot = JSON.stringify(forecast);
		if (mounted) localStorage.setItem('fl-ev-current', snapshot);
	});

	$effect(() => {
		const dates = ctx.futureDates.join();
		const current = untrack(() => forecast.days.map((d) => d.date).join());
		if (dates !== current) {
			untrack(() => (forecast.days = reconcileDays(ctx, $state.snapshot(forecast.days))));
		}
	});

	$effect(() => {
		if (forecast.linked && Math.abs(outcome.cushion) > 0.5) {
			untrack(() => (forecast = holdTarget(ctx, $state.snapshot(forecast))));
		}
	});

	function applyForecast(f: Forecast) {
		f = upgradeForecast(ctx, f);
		const base = defaultForecast(ctx);
		const mailFinal =
			f.mailFinal ??
			(f.mailRemaining !== undefined ? feed.mail.total + f.mailRemaining : base.mailFinal);
		forecast = {
			...base,
			...f,
			mailFinal,
			mailRemaining: undefined,
			linked: f.linked ?? false,
			days: reconcileDays(ctx, f.days ?? [])
		};
	}

	function setTarget(v: number) {
		if (forecast.linked) forecast = swingToTarget(ctx, $state.snapshot(forecast), v);
		else forecast.target = v;
	}

	function setIpevMargin(v: number) {
		const f = $state.snapshot(forecast);
		forecast = forecast.linked
			? setIpevHoldingTarget(ctx, f, v)
			: shiftDays(f, v - outcome.scenarioIpevMargin);
	}

	function resetDays() {
		forecast.days = defaultForecast(ctx).days;
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
	<title>Florida Early Vote Forecaster (2026)</title>
	<meta
		name="description"
		content="Florida 2026 early vote (IPEV + mail) tracker with forecast and daily benchmark builder."
	/>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<header class="page-header mb-6 flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
				Florida Early Vote Forecaster (2026)
			</h1>
			<p class="text-2 mt-1 inline-flex items-center text-sm">
				Early vote by party
				<Info align="left">
					IPEV is in-person early voting. Margins compare the party registration of people who have
					voted (Democrats minus Republicans, out of everyone who voted). They aren't candidate vote
					margins.
				</Info>
			</p>
		</div>
		<div class="header-tools flex flex-wrap items-center gap-2 text-sm">
			<span class="header-status text-muted inline-flex flex-wrap items-center gap-y-1 text-xs">
				{#if today}
					<span class="font-medium" style:color="var(--ink-2)">
						{fmtDay(today.date)} · {today.pollsClosed ? 'polls closed' : 'live'}{today.soFar
							? ` · ${fmtInt(today.soFar.total)} IPEV`
							: ''}
					</span>
					<span class="mx-1.5">·</span>
				{:else if lastComplete}
					Final through {fmtDay(lastComplete)}<span class="mx-1.5">·</span>
				{/if}
				Updated {fetched}
				<Info align="right">
					Refreshes every 5 minutes. Today's count can keep changing until midnight as counties
					upload. Data from
					<a class="underline" href={feed.source} target="_blank" rel="noreferrer"
						>{feed.source.replace('https://', '').replace(/\/$/, '')}</a
					>.
				</Info>
			</span>
			<button class="btn" onclick={refresh} disabled={refreshing}>
				{refreshing ? 'Refreshing…' : 'Refresh'}
			</button>
			<button class="btn" onclick={() => theme.toggle()} aria-label="Toggle color theme">
				{theme.mode === 'dark' ? 'Light' : 'Dark'}
			</button>
		</div>
		{#if feed.stale}
			<p class="w-full rounded-lg px-3 py-2 text-sm" style:background="var(--wash)" role="status">
				⚠ Source unavailable - showing data from {fetched}.
			</p>
		{/if}
	</header>

	{#if today}
		<div class="mb-3 hidden md:block">
			<TodayStats
				{today}
				benchmark={todayBenchmark}
				mailBenchmark={forecast.mailMargin}
				mail={reportedMail}
			/>
		</div>
	{/if}

	<section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Headline numbers">
		<div class="card p-4">
			<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
				Total cast<Info align="left">Mail returned plus IPEV cast so far.</Info>
			</div>
			<div class="mt-1 text-2xl font-semibold {marginClass(live.margin)}">
				{fmtMargin(live.margin, 2)}
			</div>
			<div class="text-2 text-sm">{fmtLead(live.gap)} · {fmtInt(live.total)} voters</div>
		</div>
		<div class="card p-4">
			<div class="text-muted text-xs font-medium tracking-wide uppercase">IPEV</div>
			<div class="mt-1 text-2xl font-semibold {marginClass(marginOf(feed.early))}">
				{fmtMargin(marginOf(feed.early), 2)}
			</div>
			<div class="text-2 text-sm">
				{fmtLead(feed.early.dem - feed.early.rep)} · {fmtInt(feed.early.total)}
			</div>
		</div>
		<div class="card p-4">
			<div class="text-muted text-xs font-medium tracking-wide uppercase">Mail returned</div>
			<div class="mt-1 text-2xl font-semibold {marginClass(marginOf(feed.mail))}">
				{fmtMargin(marginOf(feed.mail), 2)}
			</div>
			<div class="text-2 text-sm">
				{fmtLead(feed.mail.dem - feed.mail.rep)} · {fmtInt(feed.mail.total)}
			</div>
		</div>
		<div class="card p-4">
			<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
				Your final<Info>Projected final electorate from your forecast, including Election Day.</Info
				>
			</div>
			<div class="mt-1 text-2xl font-semibold {marginClass(outcome.margin)}">
				{fmtMargin(outcome.margin, 2)}
			</div>
			<div class="text-2 text-sm">{fmtLead(outcome.gap)} · {fmtInt(outcome.total)} voters</div>
		</div>
		<div class="card col-span-2 p-4 lg:col-span-1">
			<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
				IPEV needed<Info align="right"
					>Average margin the remaining in-person early vote needs for your target, given your
					Election Day margin.</Info
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
				<h2 class="text-base font-semibold">Make a forecast</h2>
				<span class="inline-flex items-center">
					<label class="text-2 flex cursor-pointer items-center gap-2 text-sm">
						<input type="checkbox" class="peer sr-only" bind:checked={forecast.linked} />
						<span class="switch" aria-hidden="true"></span>
						Lock to target
					</label>
					<Info align="right">
						When on, the final always equals your target. Moving the target shifts the margins for
						Election Day, remaining IPEV, and remaining mail by the same amount. Moving Election Day
						or IPEV alone re-solves the other.
					</Info>
				</span>
			</div>

			<MarginSlider
				label="Target final electorate"
				bind:value={() => forecast.target, setTarget}
				min={-15}
				max={5}
			>
				{#snippet info()}
					Final party margin of everyone who votes. For reference, the registration gap is
					{fmtMargin(regMargin)}.
				{/snippet}
			</MarginSlider>

			<MarginSlider label="Election Day margin" bind:value={forecast.edMargin} min={-40} max={10}>
				{#snippet info()}
					Party margin of Election Day voters. Turnout ({fmtInt(forecast.edTurnout)}) is under
					Advanced.
				{/snippet}
			</MarginSlider>

			{#if forecast.days.length}
				<MarginSlider
					label="Remaining IPEV margin"
					bind:value={() => outcome.scenarioIpevMargin, setIpevMargin}
					min={-30}
					max={20}
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
					{#if forecast.linked}
						On target
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
							bind:value={forecast.mailFinal}
						/>
					</label>
					<label>
						<span class="text-2 mb-1 block">Margin of the rest</span>
						<MarginInput label="Remaining mail" bind:value={forecast.mailMargin} />
					</label>
				</div>
				<p class="text-muted mt-1 inline-flex items-center text-xs">
					{fmtInt(mailRem)} still to come
					<Info align="left">
						{fmtInt(feed.mail.total)} returned so far and {fmtInt(feed.outstanding.total)} outstanding
						({fmtMargin(marginOf(feed.outstanding))}). What's left shrinks automatically as ballots
						arrive.
					</Info>
				</p>

				{#if today}
					<div class="text-2 mt-4 mb-1 flex items-center text-sm">
						Today (locked)
						<Info align="left">
							Projected full day: {fmtInt(today.projectedVolume)} at {fmtMargin(
								today.projectedMargin
							)}, so {fmtInt(today.restVolume)} more expected. {today.pollsClosed
								? 'Polls have closed, so nothing more is projected, but late uploads still count.'
								: ''} Becomes reported data after midnight.
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
							Defaults: votes from the same weekday last week times recent growth; margins from the
							last 3 weekdays, adjusted for weekends.
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
												aria-label="{fmtDay(d.date)} votes"
												bind:value={d.volume}
											/>
										</td>
										<td class="py-0.5">
											<MarginInput label={fmtDay(d.date)} bind:value={d.margin} compact />
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<button class="btn mt-2" onclick={resetDays}>Reset days</button>
				{/if}
			</details>

			<div class="border-t pt-3" style:border-color="var(--border)">
				<div class="flex gap-2">
					<input
						class="field min-w-0 flex-1 text-sm"
						aria-label="Forecast name"
						bind:value={forecast.name}
					/>
					<button class="btn btn-primary" onclick={save}>Save</button>
				</div>
				<div class="mt-2 flex flex-wrap gap-2">
					{#if saved.length}
						<select
							class="field min-w-0 flex-1 text-sm"
							aria-label="Load a saved forecast"
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
							<button class="btn" onclick={() => remove(forecast.name)}>Delete</button>
						{/if}
					{/if}
					<button class="btn" onclick={share}>{copied ? 'Link copied' : 'Share link'}</button>
					<button class="btn" onclick={resetAll}>Reset</button>
				</div>
			</div>
		</aside>

		<div class="min-w-0 space-y-6">
			<section class="card p-4">
				<h2 class="mb-2 flex items-center text-base font-semibold">
					Total early-vote margin by day
					<Info align="left">
						IPEV + mail, cumulative. Above zero favors Democrats. Projected days spread the
						remaining mail evenly. Election Day isn't on this line. Reported includes today's counts
						so far; late uploads can revise them.
					</Info>
				</h2>
				<LegendToggle
					bind:hidden={marginHidden}
					items={[
						{ name: 'Reported', swatch: 'solid' },
						{ name: 'Your scenario', swatch: 'dashed' },
						...(forecast.linked
							? []
							: [{ name: 'Benchmark path to target', swatch: 'dotted' as const }])
					]}
				/>
				<EChart
					option={marginOption}
					height={400}
					label="Cumulative early vote margin by day with scenario and benchmark projections"
				/>
				{#if forecast.days.length}
					<div
						class="num text-2 mt-3 space-y-1 rounded-lg p-3 text-sm"
						style:background="var(--wash)"
					>
						<div class="flex flex-wrap items-center gap-x-2">
							<b class="w-28" style:color="var(--ink)">
								{forecast.linked ? `Path to ${fmtMargin(forecast.target)}` : 'Your scenario'}
							</b>
							<span
								>IPEV <span class={marginClass(outcome.scenarioIpevMargin)}
									>{fmtMargin(outcome.scenarioIpevMargin)}</span
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
								>final <span class={marginClass(outcome.margin)}
									>{fmtMargin(outcome.margin, 2)}</span
								></span
							>
						</div>
						{#if !forecast.linked}
							<div class="flex flex-wrap items-center gap-x-2">
								<b class="w-28" style:color="var(--ink)">Benchmark</b>
								<span
									>IPEV <span class={marginClass(outcome.requiredIpevMargin)}
										>{fmtMargin(outcome.requiredIpevMargin)}</span
									></span
								>
								<span class="text-muted">→</span>
								<span
									>early vote ends <span class={marginClass(benchEnd)}
										>{fmtMargin(benchEnd, 2)}</span
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
									Both lines share the same {fmtInt(mailRem)} mail ballots and Election Day ({fmtMargin(
										forecast.edMargin
									)}). They differ only in how the remaining
									{fmtInt(outcome.ipevRemainingVolume)} IPEV votes break.
								</Info>
							</div>
						{/if}
					</div>
				{/if}
			</section>

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
						IPEV needed by Election Day margin
						<Info align="right">
							For a {fmtMargin(forecast.target)} final, holding your mail and turnout. "Needed" means
							that margin or anything more Democratic. The shaded row is your Election Day input.
						</Info>
					</h2>
					<div class="overflow-x-auto">
						<table class="num w-full text-sm">
							<thead>
								<tr class="text-muted text-xs leading-tight">
									<th class="pr-2 pb-2 pl-1 text-left align-bottom font-medium">Election Day</th>
									<th class="pb-2 pl-3 text-right align-bottom font-medium">IPEV needed</th>
									<th class="pb-2 pl-3 text-right align-bottom font-medium">IPEV lead</th>
									<th class="pb-2 pl-3 text-right align-bottom font-medium">Final with your IPEV</th
									>
								</tr>
							</thead>
							<tbody>
								{#each sensitivity as s (s.ed)}
									<tr
										class="border-t"
										style:border-color="var(--border)"
										style:background={Math.abs(s.ed - forecast.edMargin) < 0.05
											? 'var(--wash)'
											: undefined}
									>
										<td class="py-2 pr-2 pl-1 font-medium whitespace-nowrap {marginClass(s.ed)}">
											{fmtMargin(s.ed)}
										</td>
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
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</section>

			<section class="card p-4">
				<h2 class="mb-2 flex items-center text-base font-semibold">
					Daily IPEV margins
					<Info align="left">
						{#if forecast.linked}
							Faded bars are the daily targets for {fmtMargin(forecast.target)}.
						{:else}
							Benchmarks keep your daily shape, shifted {Math.abs(outcome.shift).toFixed(2)} pts toward
							{outcome.shift >= 0 ? 'Democrats' : 'Republicans'} so the final lands on
							{fmtMargin(forecast.target)}.
						{/if}
						Days trade off against each other - only the cumulative lead matters.
					</Info>
				</h2>
				<LegendToggle
					bind:hidden={dailyHidden}
					items={[
						{ name: 'Reported IPEV', swatch: 'bar' },
						{ name: 'Your scenario', swatch: 'bar-faded' },
						...(forecast.linked ? [] : [{ name: 'Benchmark', swatch: 'tick' as const }])
					]}
				/>
				<div class="daily-chart overflow-x-auto">
					<EChart
						option={dailyOption}
						height={340}
						mobileMinWidth={Math.max(640, dailyRows.length * 52 + 72)}
						label="Daily in-person early vote margins, reported and projected, with benchmarks"
					/>
				</div>

				<p class="text-muted mt-1 text-xs md:hidden">
					Swipe the chart or table to see all days and columns.
				</p>
				<div
					class="daily-table mt-4 overflow-x-auto"
					style:--table-width={forecast.linked ? '640px' : '920px'}
				>
					<table class="num w-full text-sm">
						<thead>
							<tr class="text-muted text-left text-xs">
								<th class="pb-2 font-medium">Day</th>
								<th class="pb-2 text-right font-medium">IPEV votes</th>
								<th class="pb-2 text-right font-medium">Margin</th>
								<th class="pb-2 text-right font-medium">Lead</th>
								{#if !forecast.linked}
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
									{#if !forecast.linked}
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
								{@const expectedMargin = todayBenchmark?.margin ?? today.projectedMargin}
								{@const expectedVolume = todayBenchmark?.volume ?? today.projectedVolume}
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
													? 'Reported · late uploads possible'
													: 'Reported so far · in progress'
												: 'Projected · awaiting first counts'}
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
												>Expected {fmtMargin(todayBenchmark.margin, 2)}</span
											>{/if}
									</td>
									<td class="text-right">
										{fmtLead(rowGap)}
									</td>
									{#if !forecast.linked}
										<td class="text-muted text-right"
											>{todayBenchmark ? fmtMargin(todayBenchmark.margin, 2) : '-'}<span
												class="block text-xs">daily expectation</span
											></td
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
									<td class="text-right {marginClass(forecast.days[i].margin)}">
										{fmtMargin(forecast.days[i].margin)}
									</td>
									<td class="text-right">
										{fmtLead((forecast.days[i].volume * forecast.days[i].margin) / 100)}
									</td>
									{#if !forecast.linked}
										<td class="text-right font-semibold {marginClass(b.margin)}">
											{fmtMargin(b.margin)}
										</td>
										<td class="text-right">
											{fmtLead(b.gap)}
										</td>
									{/if}
									<td class="text-right {marginClass(scenarioPath[i + pathOffset].margin)}">
										{fmtMargin(scenarioPath[i + pathOffset].margin, 2)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="text-muted mt-3 pb-1 text-xs">
					Shaded rows include projections. Today's benchmark is the same daily expectation used in
					the cards.
				</p>
			</section>

			{#if today}
				<div class="md:hidden">
					<TodayStats
						{today}
						benchmark={todayBenchmark}
						mailBenchmark={forecast.mailMargin}
						mail={reportedMail}
					/>
				</div>
			{/if}

			<section class="card p-4">
				<h2 class="mb-3 text-base font-semibold">By county</h2>
				<CountyMap counties={feed.counties} days={feed.earlyDays} currentDate={today?.date} />
			</section>

			<section class="text-2 card p-4 text-sm">
				<h2 class="mb-2 text-base font-semibold" style:color="var(--ink)">Notes</h2>
				<ul class="list-disc space-y-1 pl-5">
					<li>R+5 means Republicans outnumber Democrats by 5% of all voters, including NPA.</li>
					<li>Final = votes cast + remaining mail + remaining IPEV + Election Day.</li>
					<li>
						Data from
						<a class="underline" href={feed.source} target="_blank" rel="noreferrer"
							>{feed.source.replace('https://', '').replace(/\/$/, '')}</a
						>, compiled from county supervisor feeds.
					</li>
				</ul>
			</section>
		</div>
	</div>
</main>

<style>
	.page-header {
		padding: 0.5rem 0 1.25rem;
		border-bottom: 1px solid var(--border);
	}
	.header-tools {
		justify-content: flex-end;
	}
	.header-status {
		flex-basis: 100%;
		justify-content: flex-end;
		margin-bottom: 0.25rem;
	}
	@media (max-width: 767px) {
		.header-tools {
			justify-content: flex-start;
		}
		.header-status {
			justify-content: flex-start;
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
