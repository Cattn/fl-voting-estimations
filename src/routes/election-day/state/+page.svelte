<script lang="ts">
	import EChart from '#lib/components/EChart.svelte';
	import Info from '#lib/components/Info.svelte';
	import ResultsMap from '#lib/components/ResultsMap.svelte';
	import { resultsNightChartOption, type NightPoint } from '#lib/charts.ts';
	import { addCounts, edOutcome, fmtClock, liveTurnout, RESULTS_START } from '#lib/election.ts';
	import { DEFAULT_TARGET, fmtInt, fmtLead, fmtMargin, marginOf } from '#lib/model.ts';
	import {
		countedMix,
		PRES_2024_STATE,
		projectRace,
		raceMargin,
		tallyRaces,
		type RaceTally
	} from '#lib/results.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const tabs = [
		{ race: 'GOV', label: 'Governor' },
		{ race: 'USS', label: 'U.S. Senate' },
		{ race: 'ATG', label: 'Attorney General' },
		{ race: 'CFO', label: 'CFO' },
		{ race: 'AGR', label: 'Agriculture' },
		{ race: 'AMD', label: 'Amendments' }
	];
	let tab = $state('GOV');

	const ed = $derived(data.election.state);
	const races = $derived(tallyRaces(data.election.results));
	const race = $derived(races.find((r) => r.race === tab) ?? null);
	const amendments = $derived(races.filter((r) => r.race === 'AMD'));
	const started = $derived(races.some((r) => r.total > 0));
	const electorate = $derived(edOutcome(ed, liveTurnout(ed).turnout, DEFAULT_TARGET).final);
	const projection = $derived(
		data.election.projectable && race && race.total
			? projectRace(ed.counties, race, electorate.total, electorate.margin)
			: null
	);
	const rep = $derived(race?.candidates.find((c) => c.party === 'REP'));
	const dem = $derived(race?.candidates.find((c) => c.party === 'DEM'));
	const others = $derived(race ? race.total - (rep?.votes ?? 0) - (dem?.votes ?? 0) : 0);
	const margin = $derived(race ? raceMargin(race) : 0);
	const leader = $derived(margin < 0 ? rep : dem);
	const share = (v: number) => (race?.total ? (v / race.total) * 100 : 0);
	const counties = $derived(ed.counties.filter((c) => c.registered).length);
	const complete = $derived(
		race ? race.counties.filter((c) => c.precincts && c.reporting >= c.precincts).length : 0
	);

	const night = $derived<NightPoint[]>(data.election.night.filter((p) => p.race === tab));
	const nightOption = $derived(
		projection
			? resultsNightChartOption(
					theme.palette,
					night,
					{ margin: projection.projected, electorate: electorate.margin, range: projection.range },
					leader?.name ?? ''
				)
			: null
	);
	const marginClass = (v: number) => (v < 0 ? 'text-rep' : 'text-dem');
	const signed = (v: number) => `${v > 0 ? 'D' : 'R'} +${Math.abs(v).toFixed(1)}`;
</script>

{#if !started}
	<section class="card mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
		<div>
			<h2 class="text-base font-semibold">Results at 8 PM ET</h2>
			<p class="text-muted text-sm">
				Counties post early and mail ballots first, once the panhandle closes at 8 PM ET, then
				Election Day precincts through the night. Unofficial results from the Florida Department of
				State.
			</p>
		</div>
		<span class="text-2 text-sm">Governor · U.S. Senate · Cabinet · 3 amendments</span>
	</section>
{/if}

<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h2 class="text-lg font-semibold">Statewide results</h2>
		<p class="text-muted text-xs">
			Unofficial · candidate votes, which include NPA and minor-party voters
		</p>
	</div>
	{#if started && race}
		<span class="text-2 text-xs"
			>{complete} of {counties} counties at 100% precinct reporting · {fmtClock(data.minute)} ET</span
		>
	{/if}
</div>

<div class="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Race">
	{#each tabs as t (t.race)}
		<button
			class="btn"
			role="tab"
			class:btn-primary={tab === t.race}
			aria-selected={tab === t.race}
			onclick={() => (tab = t.race)}>{t.label}</button
		>
	{/each}
</div>

{#if tab === 'AMD'}
	<section class="card p-4">
		<h2 class="mb-1 flex items-center text-base font-semibold">
			Amendments<Info align="left">Constitutional amendments need 60% Yes to pass.</Info>
		</h2>
		{#each amendments as a (a.name)}
			{@const yes = a.candidates.find((c) => c.name.startsWith('Yes'))?.votes ?? 0}
			{@const pct = a.total ? (yes / a.total) * 100 : 0}
			<div
				class="grid grid-cols-1 items-center gap-2 border-t py-2.5 text-sm sm:grid-cols-[1fr_200px_64px]"
				style:border-color="var(--border)"
			>
				<span>{a.name}</span>
				<div class="relative h-2.5 overflow-hidden rounded-full" style:background="var(--wash)">
					<div
						class="h-full rounded-full"
						style:width="{pct}%"
						style:background={pct >= 60 ? '#3fb950' : 'var(--muted)'}
					></div>
					<div
						class="absolute top-0 h-full w-px"
						style:left="60%"
						style:background="var(--ink)"
					></div>
				</div>
				<span class="num text-right font-semibold">{a.total ? `${pct.toFixed(1)}%` : '-'}</span>
			</div>
		{/each}
	</section>
{:else if race}
	<div class="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
		<section class="card p-4">
			{#each [rep, dem] as c (c?.party)}
				{#if c}
					<div class="num mt-1 flex items-baseline justify-between gap-3">
						<span
							><b class="text-base {c.party === 'REP' ? 'text-rep' : 'text-dem'}">{c.name}</b>
							<span class="text-muted text-xs">{c.party}</span></span
						>
						<span
							><b class="text-xl">{race.total ? `${share(c.votes).toFixed(1)}%` : '-'}</b>
							<span class="text-muted text-sm">{fmtInt(c.votes)}</span></span
						>
					</div>
				{/if}
			{/each}
			<div class="mt-3 flex h-3 overflow-hidden rounded-full" style:background="var(--wash)">
				<div style:width="{share(rep?.votes ?? 0)}%" style:background="var(--rep)"></div>
				<div style:width="{share(others)}%" style:background="var(--muted)"></div>
				<div style:width="{share(dem?.votes ?? 0)}%" style:background="var(--dem)"></div>
			</div>
			<div class="text-muted num mt-1 flex justify-between text-xs">
				<span>Others {share(others).toFixed(1)}% · {fmtInt(others)}</span>
				<span>{fmtInt(race.reporting)} of {fmtInt(race.precincts)} precincts</span>
			</div>
		</section>
		<section class="card p-4">
			<div class="text-muted text-xs font-medium tracking-wide uppercase">Margin now</div>
			<div class="num mt-1 text-2xl font-semibold {race.total ? marginClass(margin) : ''}">
				{race.total ? fmtMargin(margin, 1) : '-'}
			</div>
			<div class="text-2 num text-sm">
				{race.total
					? `${fmtLead((dem?.votes ?? 0) - (rep?.votes ?? 0))} · ${Math.round((projection?.counted ?? 0) * 100)}% of ~${(electorate.total / 1e6).toFixed(1)}M ballots counted`
					: 'No votes counted yet'}
			</div>
			<div class="mt-3 h-2 overflow-hidden rounded-full" style:background="var(--wash)">
				<div
					class="h-full rounded-full"
					style:width="{(projection?.counted ?? 0) * 100}%"
					style:background="var(--ink-2)"
				></div>
			</div>
			<p class="text-muted mt-1 text-xs">
				Estimated share of ballots counted, using turnout reports. Candidate totals exclude votes
				left blank or invalid in this race.
			</p>
		</section>
	</div>

	{#if projection}
		<div class="mt-4 grid gap-4 sm:grid-cols-3">
			<section class="card p-4">
				<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
					Counted ballots by registration<Info align="left"
						>The party-registration mix of the ballots counted so far. Counties post early and mail
						ballots first, so this is estimated from each county's early, mail, and Election Day
						turnout and how many votes it has counted.</Info
					>
				</div>
				<div class="num mt-1 text-2xl font-semibold {marginClass(projection.registration)}">
					{fmtMargin(projection.registration, 1)}
				</div>
				<div class="text-2 text-sm">Party mix of the ballots in so far</div>
			</section>
			<section class="card p-4">
				<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
					{leader?.name ?? 'Leader'} vs. party<Info align="left"
						>The candidate margin minus the registration margin of the same counted ballots. It
						shows how NPA voters break and how many voters cross party lines. In 2024 Trump ran
						about 2 points ahead of an R+11 electorate.</Info
					>
				</div>
				<div class="num mt-1 text-2xl font-semibold {marginClass(projection.ahead)}">
					{signed(projection.ahead)} pts
				</div>
				<div class="text-2 text-sm">Ahead of party registration</div>
			</section>
			<section class="card p-4">
				<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
					Rough projection<Info align="right"
						>The projected final electorate ({fmtMargin(electorate.margin, 1)} by registration, from Election
						Day turnout so far) plus how far the race is running ahead of party. The ballots still out
						are mostly Election Day votes, which are more Republican than the early and mail ballots counted
						first; this carries that forward assuming each party's voters keep breaking the same way.
						The range narrows as the count finishes. Not a race call.</Info
					>
				</div>
				<div class="num mt-1 text-2xl font-semibold {marginClass(projection.projected)}">
					{fmtMargin(projection.projected, 1)}
				</div>
				<div class="text-2 num text-sm">
					{fmtMargin(electorate.margin, 1)} electorate {projection.ahead < 0 ? '−' : '+'}
					{Math.abs(projection.ahead).toFixed(1)} · ±{projection.range.toFixed(1)}
				</div>
			</section>
		</div>

		{#if nightOption && night.length}
			<section class="card mt-4 p-4">
				<h2 class="mb-1 flex items-center text-base font-semibold">
					Count through the night<Info align="left"
						>Each point is a snapshot of the statewide count. The dotted line is the registration
						margin of the same counted ballots. The gap between the two is how far the race runs
						ahead of party.</Info
					>
				</h2>
				<EChart option={nightOption} height={280} label="Statewide margin by share counted" />
			</section>
		{/if}
	{/if}
	{#if !projection && race.total}<p class="text-muted mt-4 text-sm">
			Turnout comparisons and projections are paused until consistent, current turnout data is
			available. Candidate results continue updating.
		</p>{/if}
	<section class="card mt-4 p-4">
		<h2 class="mb-3 text-base font-semibold">By county</h2>
		<ResultsMap counties={ed.counties} {race} showComparison={data.election.projectable} />
	</section>
{/if}

<p class="text-muted mt-6 text-xs">
	Unofficial results from the Florida Department of State. Statewide 2024 presidential result for
	reference: {fmtMargin(-PRES_2024_STATE, 1)}.
</p>
