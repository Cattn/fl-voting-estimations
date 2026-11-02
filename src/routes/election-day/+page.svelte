<script lang="ts">
	import { onMount } from 'svelte';
	import EChart from '#lib/components/EChart.svelte';
	import EdCountyMap from '#lib/components/EdCountyMap.svelte';
	import Info from '#lib/components/Info.svelte';
	import LegendToggle from '#lib/components/LegendToggle.svelte';
	import MarginSlider from '#lib/components/MarginSlider.svelte';
	import { dailyChartOption, edDayChartOption, type DailyRow } from '#lib/charts.ts';
	import { edMode } from '#lib/ed-mode.svelte.ts';
	import {
		addCounts,
		dayPaths,
		DEFAULT_PRESET,
		edOutcome,
		edProjection,
		fmtClock,
		gapOf,
		halfHourRows,
		LATE_MAIL,
		notYetVoted,
		PRESETS,
		scaleCounts,
		turnoutEstimates
	} from '#lib/election.ts';
	import { DEFAULT_TARGET, fmtInt, fmtLead, fmtMargin, marginOf } from '#lib/model.ts';
	import { loadSaved } from '#lib/saved.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { Forecast } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const ed = $derived(data.election.state);
	const pre = $derived(ed.phase === 'pre');
	const open = $derived(ed.phase === 'open');
	const closed = $derived(ed.phase === 'closed');
	const custom = $derived(edMode.custom && !closed);

	let target = $state(DEFAULT_TARGET);
	let preset = $state('live');
	let saved = $state<Forecast[]>([]);
	let showRows = $state(false);
	let dayHidden = $state<Record<string, boolean>>({});
	let mounted = $state(false);

	const estimates = $derived(turnoutEstimates(ed));
	const projection = $derived(edProjection(ed));
	const choice = $derived(preset === DEFAULT_PRESET ? 'live' : preset);
	const turnout = $derived(
		choice === 'live'
			? estimates.live.turnout
			: estimates.presets.find((p) => p.id === choice)!.turnout
	);
	const outcome = $derived(edOutcome(ed, turnout, target));
	const options = $derived([
		{ id: 'live', label: 'Live pace', turnout: estimates.live.turnout },
		...PRESETS.filter((p) => p.id !== DEFAULT_PRESET).map((p) => ({
			id: p.id,
			label: p.label,
			turnout: estimates.presets.find((e) => e.id === p.id)!.turnout
		}))
	]);
	const middle = PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
	const pctOf = (v: number) => `${+(v * 100).toFixed(1)}%`;
	const rate = (votes: number, of: number) => `${of ? Math.round((votes / of) * 100) : 0}%`;

	const total = $derived(addCounts(ed.early, ed.mail, ed.eday));
	const mailSince = $derived(addCounts(ed.mail, scaleCounts(ed.evMail, -1)));
	const pool = $derived(notYetVoted(ed));
	const expected = $derived(custom ? outcome.turnout : projection.base.turnout);
	const edExpected = $derived(custom ? outcome.turnout.total : projection.edTotal);
	const counted = $derived(ed.eday.total / Math.max(1, edExpected));

	const paths = $derived(
		custom
			? { ...dayPaths(ed, outcome), live: [] }
			: { ...dayPaths(ed, { ...projection.base, restMargin: projection.restMargin }), path: [] }
	);
	const visible = (hidden: Record<string, boolean>) =>
		Object.fromEntries(Object.entries(hidden).map(([k, v]) => [k, !v]));
	const dayOption = $derived(
		edDayChartOption(
			theme.palette,
			paths,
			custom ? target : null,
			visible(dayHidden),
			custom
				? { path: 'Path to target', live: 'Selected turnout' }
				: { path: '', live: 'Projection' }
		)
	);
	const rows = $derived(halfHourRows(ed, turnout, target));
	const evDays = $derived<DailyRow[]>(
		data.feed.earlyDays.map((d) => ({
			date: d.date,
			reported: { margin: marginOf(d), volume: d.total, gap: d.dem - d.rep }
		}))
	);
	const recapOption = $derived(dailyChartOption(theme.palette, evDays));
	const marginClass = (v: number) => (v < 0 ? 'text-rep' : 'text-dem');
	const millions = (n: number) => `${(n / 1e6).toFixed(2)}M`;
	const parties = $derived([
		{
			label: 'Republican',
			cls: 'text-rep',
			sofar: ed.eday.rep,
			full: expected.rep,
			pool: pool.rep
		},
		{ label: 'Democrat', cls: 'text-dem', sofar: ed.eday.dem, full: expected.dem, pool: pool.dem },
		{
			label: 'NPA + minor',
			cls: '',
			sofar: ed.eday.npa + ed.eday.oth,
			full: expected.npa + expected.oth,
			pool: pool.oth
		}
	]);

	function loadForecast(f: Forecast) {
		target = f.target;
	}

	onMount(() => {
		saved = loadSaved();
		try {
			const stored = JSON.parse(localStorage.getItem('fl-ed-forecast') ?? 'null') as {
				target?: number;
				preset?: string;
			} | null;
			if (typeof stored?.target === 'number' && Number.isFinite(stored.target))
				target = stored.target;
			if (stored?.preset === 'live' || PRESETS.some((p) => p.id === stored?.preset))
				preset = stored!.preset!;
		} catch {
			return;
		} finally {
			mounted = true;
		}
	});

	$effect(() => {
		const snapshot = JSON.stringify({ target, preset });
		if (mounted) localStorage.setItem('fl-ed-forecast', snapshot);
	});
</script>

{#snippet stat(label: string, margin: number | null, sub: string, info?: string, hero = false)}
	<div class="card p-4" class:headline-hero={hero}>
		<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
			{label}{#if info}<Info align="left">{info}</Info>{/if}
		</div>
		<div class="mt-1 text-2xl font-semibold {margin === null ? '' : marginClass(margin)}">
			{margin === null ? '-' : fmtMargin(margin, 2)}
		</div>
		<div class="text-2 text-sm">{sub}</div>
	</div>
{/snippet}

{#snippet progress()}
	<section class="card p-4">
		<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
			<h2 class="text-base font-semibold">Election Day so far</h2>
			<span class="text-2 num text-sm">
				{#if custom}
					Rest needs <b class={marginClass(outcome.needed ?? 0)}
						>{outcome.needed === null
							? '-'
							: Math.abs(outcome.needed) > 100
								? 'out of reach'
								: fmtMargin(outcome.needed, 1)}</b
					>
				{:else}
					Rest projected <b class={marginClass(projection.restMargin)}
						>{fmtMargin(projection.restMargin, 1)}</b
					>
					{#if projection.trend !== null}
						<span class="text-muted">· live trend {fmtMargin(projection.trend, 1)}</span>
					{/if}
				{/if}
			</span>
		</div>
		<div class="mt-3 h-2 overflow-hidden rounded-full" style:background="var(--wash)">
			<div
				class="h-full rounded-full"
				style:width="{Math.min(1, counted) * 100}%"
				style:background="var(--ink-2)"
			></div>
		</div>
		<div class="text-muted num mt-1 flex justify-between text-xs">
			<span
				>{fmtInt(ed.eday.total)} votes{ed.eday.total
					? ` · ${fmtMargin(marginOf(ed.eday), 1)}`
					: ''}</span
			>
			<span>{Math.round(counted * 100)}% of ~{millions(edExpected)}</span>
		</div>
	</section>
{/snippet}

{#snippet fixedRows()}
	<div class="flex justify-between">
		<span class="text-muted">Early vote</span>
		<span class={marginClass(marginOf(addCounts(ed.early, ed.evMail)))}
			>{fmtMargin(marginOf(addCounts(ed.early, ed.evMail)), 2)}</span
		>
	</div>
	<div class="flex justify-between">
		<span class="text-muted">Mail since EV</span>
		<span class={marginClass(marginOf(mailSince))}
			>{ed.lateMailEstimate === false
				? '-'
				: `${fmtInt(mailSince.total)} · ${fmtMargin(marginOf(mailSince))}`}</span
		>
	</div>
	<div class="flex justify-between">
		<span class="text-muted">Late mail expected</span>
		<span class="text-dem"
			>{ed.lateMailEstimate === false
				? '-'
				: `~${fmtInt(LATE_MAIL.total / 1000)}k · ${fmtMargin(LATE_MAIL.margin)}`}</span
		>
	</div>
{/snippet}

{#snippet dayChart()}
	<section class="card p-4">
		<h2 class="mb-2 text-base font-semibold">Final electorate through the day</h2>
		{#if paths.path.length || paths.live.length}
			<LegendToggle
				bind:hidden={dayHidden}
				items={[
					{ name: 'Reported', swatch: 'solid' },
					...(paths.path.length ? [{ name: 'Path to target', swatch: 'dashed' as const }] : []),
					...(paths.live.length
						? [{ name: custom ? 'Selected turnout' : 'Projection', swatch: 'dotted' as const }]
						: [])
				]}
			/>
		{/if}
		<EChart option={dayOption} height={300} label="Final electorate margin through Election Day" />
	</section>
{/snippet}

{#snippet partyTable()}
	<section class="card p-4">
		<h2 class="mb-2 flex items-center text-base font-semibold">
			By party<Info align="left"
				>Turnout is the share of each party's voters who hadn't voted early or by mail.</Info
			>
		</h2>
		<div class="overflow-x-auto">
			<table class="num w-full text-sm">
				<thead>
					<tr class="text-muted text-xs">
						<th class="pb-2 text-left font-medium">Party</th>
						{#if !pre}<th class="pb-2 pl-3 text-right font-medium"
								>{closed ? 'Election Day' : 'So far'}</th
							>{/if}
						{#if !closed}<th class="pb-2 pl-3 text-right font-medium">Expected</th>{/if}
						<th class="pb-2 pl-3 text-right font-medium">Turnout</th>
					</tr>
				</thead>
				<tbody>
					{#each parties as r (r.label)}
						{@const votes = closed ? r.sofar : r.full}
						<tr class="border-t" style:border-color="var(--border)">
							<td class="py-1.5 {r.cls}">{r.label}</td>
							{#if !pre}<td class="pl-3 text-right">{fmtInt(r.sofar)}</td>{/if}
							{#if !closed}<td class="pl-3 text-right">{fmtInt(r.full)}</td>{/if}
							<td class="pl-3 text-right">{r.pool ? ((votes / r.pool) * 100).toFixed(1) : '0'}%</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/snippet}

{#snippet halfHours()}
	{#if rows.length}
		<section class="card p-4">
			<h2 class="mb-2 text-base font-semibold">Every 30 minutes</h2>
			<div class="overflow-x-auto">
				<table class="num w-full text-sm" style:min-width={custom ? '520px' : '420px'}>
					<thead>
						<tr class="text-muted text-xs">
							<th class="pb-2 text-left font-medium">Time</th>
							<th class="pb-2 pl-3 text-right font-medium">New votes</th>
							<th class="pb-2 pl-3 text-right font-medium">Margin</th>
							<th class="pb-2 pl-3 text-right font-medium">ED so far</th>
							<th class="pb-2 pl-3 text-right font-medium">Total</th>
							{#if custom}<th class="pb-2 pl-3 text-right font-medium">Rest needs</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each showRows ? rows : rows.slice(0, 6) as r (r.minute)}
							<tr class="border-t" style:border-color="var(--border)">
								<td class="py-1.5">{fmtClock(r.minute)}</td>
								<td class="pl-3 text-right">{fmtInt(r.added.total)}</td>
								<td class="pl-3 text-right {marginClass(marginOf(r.added))}"
									>{r.added.total ? fmtMargin(marginOf(r.added)) : '-'}</td
								>
								<td class="pl-3 text-right {marginClass(marginOf(r.sofar))}"
									>{fmtMargin(marginOf(r.sofar), 2)}</td
								>
								<td class="pl-3 text-right {marginClass(r.totalMargin)}"
									>{fmtMargin(r.totalMargin, 2)}</td
								>
								{#if custom}
									<td
										class="pl-3 text-right {r.needed === null
											? 'text-muted'
											: marginClass(r.needed)}"
										>{r.needed === null
											? '-'
											: Math.abs(r.needed) > 100
												? 'Out of reach'
												: fmtMargin(r.needed, 2)}</td
									>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if rows.length > 6}
				<button class="btn mt-2" onclick={() => (showRows = !showRows)}>
					{showRows ? 'Show latest 6' : `Show all ${rows.length}`}
				</button>
			{/if}
		</section>
	{/if}
{/snippet}

{#snippet recap()}
	<details class="card p-4">
		<summary class="cursor-pointer text-base font-semibold">Early voting recap</summary>
		<div class="mt-3 max-md:overflow-x-auto">
			<EChart
				option={recapOption}
				height={300}
				mobileMinWidth={Math.max(640, evDays.length * 52 + 72)}
				label="Daily IPEV margins"
			/>
		</div>
	</details>
{/snippet}

{#if custom}
	<section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Headline numbers">
		{@render stat(
			'Total cast',
			marginOf(total),
			`${fmtLead(gapOf(total))} · ${fmtInt(total.total)}`
		)}
		{@render stat(
			'Your final',
			target,
			`${fmtLead((target * outcome.final.total) / 100)} · ${millions(outcome.final.total)} voters`,
			undefined,
			true
		)}
		{@render stat(
			pre ? 'Election Day needs' : 'Rest of day needs',
			outcome.needed === null || Math.abs(outcome.needed) > 100 ? null : outcome.needed,
			outcome.needed === null
				? 'Turnout is final'
				: Math.abs(outcome.needed) > 100
					? 'Out of reach'
					: `on ~${millions(outcome.rest.total)} votes · ${options.find((o) => o.id === choice)?.label}`
		)}
	</section>

	<div class="grid gap-6 lg:grid-cols-[320px_1fr]">
		<aside class="card h-fit p-4 lg:sticky lg:top-4" aria-label="Forecast inputs">
			<h2 class="mb-3 text-base font-semibold">Your forecast</h2>
			<MarginSlider bind:value={target} label="Target final" min={-16} max={0}>
				{#snippet info()}
					Final party-registration margin of everyone who votes. With the turnout below, it sets
					what Election Day needs.
				{/snippet}
			</MarginSlider>

			<div class="border-t pt-4" style:border-color="var(--border)">
				<h3 class="flex items-center text-sm font-semibold">
					Election Day turnout<Info align="left"
						>Share of each party's voters who hadn't voted yet that show up. Live pace starts at {pctOf(
							middle.rep
						)} R, {pctOf(middle.dem)} D, {pctOf(middle.oth)} other and moves toward each county's reported
						pace during the day. The lean is the party margin of that turnout.</Info
					>
				</h3>
				<div
					class="presets mt-2 flex flex-col gap-1.5"
					role="radiogroup"
					aria-label="Turnout preset"
				>
					{#each options as o (o.id)}
						{@const on = choice === o.id}
						{@const lean = marginOf(o.turnout)}
						<button
							type="button"
							role="radio"
							aria-checked={on}
							class="num grid grid-cols-[1fr_auto] rounded-lg border px-2.5 py-1.5 text-left text-xs"
							style:border-color={on ? 'var(--ink)' : 'var(--border)'}
							style:box-shadow={on ? 'inset 0 0 0 1px var(--ink)' : undefined}
							onclick={() => (preset = o.id)}
						>
							<span class="text-sm font-semibold"
								>{o.label}{#if o.id === 'live'}<span class="text-muted ml-1.5 text-xs font-normal"
										>projected</span
									>{/if}</span
							>
							<span class="text-sm font-semibold">{millions(o.turnout.total)}</span>
							<span class="text-muted"
								>R {rate(o.turnout.rep, pool.rep)} · D {rate(o.turnout.dem, pool.dem)} · Other {rate(
									o.turnout.npa + o.turnout.oth,
									pool.oth
								)}</span
							>
							<span class="text-right {marginClass(lean)}">{fmtMargin(lean, 1)} lean</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="num mt-4 space-y-1 border-t pt-4 text-sm" style:border-color="var(--border)">
				{@render fixedRows()}
			</div>

			{#if saved.length}
				<div class="mt-4 border-t pt-4" style:border-color="var(--border)">
					<select
						class="field w-full cursor-pointer text-sm"
						aria-label="Use a saved forecast's target"
						onchange={(e) => {
							const f = saved[Number(e.currentTarget.value)];
							if (f) loadForecast(f);
							e.currentTarget.value = '';
						}}
					>
						<option value="">Use a saved forecast's target…</option>
						{#each saved as f, i (i)}
							<option value={i}>{f.name} · {fmtMargin(f.target, 2)}</option>
						{/each}
					</select>
				</div>
			{/if}
		</aside>

		<div class="flex min-w-0 flex-col gap-6">
			{#if open}
				{@render progress()}
				{@render dayChart()}
			{/if}
			{@render partyTable()}
			{@render halfHours()}
		</div>
	</div>
{:else if closed}
	<section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Headline numbers">
		{@render stat(
			'Total cast',
			marginOf(total),
			`${fmtLead(gapOf(total))} · ${fmtInt(total.total)}`,
			ed.turnoutFinal ? undefined : 'Some counties are still reporting turnout.'
		)}
		{@render stat(
			'Election Day',
			ed.eday.total ? marginOf(ed.eday) : null,
			ed.eday.total ? `${fmtLead(gapOf(ed.eday))} · ${fmtInt(ed.eday.total)}` : 'No reports yet'
		)}
		{@render stat(
			'IPEV',
			marginOf(ed.early),
			`${fmtLead(gapOf(ed.early))} · ${fmtInt(ed.early.total)}`
		)}
		{@render stat(
			'Mail',
			marginOf(ed.mail),
			`${fmtLead(gapOf(ed.mail))} · ${fmtInt(ed.mail.total)}`
		)}
	</section>

	<div class="flex flex-col gap-6">
		{#if paths.reported.length}{@render dayChart()}{/if}
		<section class="card p-4">
			<h2 class="mb-3 text-base font-semibold">By county</h2>
			<EdCountyMap counties={ed.counties} />
		</section>
		<div class="grid gap-6 lg:grid-cols-2">
			{@render partyTable()}
			{@render halfHours()}
		</div>
		{@render recap()}
	</div>
{:else}
	<section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Headline numbers">
		{@render stat(
			'Total cast',
			marginOf(total),
			`${fmtLead(gapOf(total))} · ${fmtInt(total.total)}`
		)}
		{#if open}
			{@render stat(
				'Election Day so far',
				ed.eday.total ? marginOf(ed.eday) : null,
				ed.eday.total ? `${fmtLead(gapOf(ed.eday))} · ${fmtInt(ed.eday.total)}` : 'No reports yet'
			)}
		{:else}
			{@render stat(
				'IPEV',
				marginOf(ed.early),
				`${fmtLead(gapOf(ed.early))} · ${fmtInt(ed.early.total)}`
			)}
		{/if}
		{@render stat(
			'Mail returned',
			marginOf(ed.mail),
			`${fmtLead(gapOf(ed.mail))} · ${fmtInt(ed.mail.total)}`
		)}
		{@render stat(
			'Projected Election Day',
			projection.edMargin,
			`${fmtLead((projection.edMargin * projection.edTotal) / 100)} · ~${millions(projection.edTotal)}`
		)}
		{@render stat(
			'Projected final',
			projection.final.margin,
			`${fmtLead(projection.final.gap)} · ${millions(projection.final.total)} voters`,
			`Starts at ${fmtMargin(DEFAULT_TARGET, 1)} and shifts toward the live Election Day trend as votes are counted.`,
			true
		)}
	</section>

	<div class="flex flex-col gap-6">
		{#if open}
			{@render progress()}
			{@render dayChart()}
		{/if}
		<section class="card p-4">
			<h2 class="mb-3 text-base font-semibold">By county</h2>
			<EdCountyMap counties={ed.counties} />
		</section>
		<div class="grid gap-6 lg:grid-cols-2">
			<div class="flex min-w-0 flex-col gap-6">
				{@render partyTable()}
				<section class="card num space-y-1 p-4 text-sm">
					<h2 class="mb-2 text-base font-semibold">Early and mail</h2>
					{@render fixedRows()}
				</section>
			</div>
			{@render halfHours()}
		</div>
		{@render recap()}
	</div>
{/if}

<style>
	@media (max-width: 767px) {
		.presets button {
			min-height: 48px;
			align-content: center;
			padding: 0.5rem 0.75rem;
			touch-action: manipulation;
		}
	}
</style>
