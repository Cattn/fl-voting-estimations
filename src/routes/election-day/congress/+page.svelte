<script lang="ts">
	import DistrictResultsMap from '#lib/components/DistrictResultsMap.svelte';
	import Info from '#lib/components/Info.svelte';
	import { addCounts, ZERO } from '#lib/election.ts';
	import { fmtInt, fmtMargin, marginOf } from '#lib/model.ts';
	import {
		closestDistricts,
		countedMix,
		districtResults,
		lead,
		tallyRaces,
		type DistrictResult
	} from '#lib/results.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type View = 'margin' | 'counted';
	let view = $state<View>('margin');
	const views: { id: View; label: string }[] = [
		{ id: 'margin', label: 'Margin' },
		{ id: 'counted', label: 'Precincts' }
	];
	const ed = $derived(data.election.state);
	const races = $derived(tallyRaces(data.results));
	const governor = $derived(races.find((r) => r.race === 'GOV'));
	const all = $derived(addCounts(ed.early, ed.mail, ed.eday));
	const mix = $derived(governor ? countedMix(ed.counties, governor) : ZERO);
	const remaining = $derived({
		rep: Math.max(0, all.rep - mix.rep),
		dem: Math.max(0, all.dem - mix.dem),
		total: Math.max(0, all.total - mix.total)
	});
	const drift = $derived(
		mix.total && remaining.total > 1000 ? marginOf(remaining) - marginOf(mix) : 0
	);
	const rows = $derived(districtResults(races, data.projectable ? drift : 0));
	const reported = $derived(rows.filter((r) => !r.district.uncontested && r.race?.total));
	const watch = $derived(closestDistricts(rows));
	const unopposed = (party: 'REP' | 'DEM') =>
		rows.filter((r) => r.district.uncontested?.party === party).length;
	const repSeats = $derived(reported.filter((r) => r.margin < 0).length + unopposed('REP'));
	const demSeats = $derived(reported.filter((r) => r.margin > 0).length + unopposed('DEM'));
	const avgShift = $derived(
		reported.length ? reported.reduce((n, r) => n + r.shift, 0) / reported.length : null
	);
	const partyColor = (party: 'REP' | 'DEM') => (party === 'REP' ? 'var(--rep)' : 'var(--dem)');
	const close = $derived(reported.filter((r) => Math.abs(r.margin) < 5).length);
	const popular = $derived({
		rep: reported.reduce((n, r) => n + lead(r.race!.candidates, 'REP'), 0),
		dem: reported.reduce((n, r) => n + lead(r.race!.candidates, 'DEM'), 0),
		total: reported.reduce((n, r) => n + r.race!.total, 0)
	});
	const marginClass = (v: number) => (v < 0 ? 'text-rep' : 'text-dem');
	const pct = (votes: number, r: DistrictResult) =>
		r.race?.total ? (votes / r.race.total) * 100 : 0;
	const callOf = (n: number) => data.calls[`USR-${n}`] ?? null;
	const called = $derived(
		rows.map((r) => callOf(r.district.n)).filter((c): c is NonNullable<typeof c> => !!c)
	);
	const counting = (r: DistrictResult) =>
		!!r.race?.total && r.counted >= 1 && !r.district.uncontested && !callOf(r.district.n);
	const tileColor = (r: DistrictResult) => {
		if (r.district.uncontested)
			return `color-mix(in srgb, ${partyColor(r.district.uncontested.party)} 95%, var(--surface))`;
		if (!r.race?.total) return 'var(--wash)';
		if (view === 'counted')
			return `color-mix(in srgb, var(--ink-2) ${20 + r.counted * 65}%, var(--surface))`;
		const value = r.margin;
		const color = value < 0 ? 'var(--rep)' : 'var(--dem)';
		return `color-mix(in srgb, ${color} ${35 + Math.min(1, Math.abs(value) / 35) * 60}%, var(--surface))`;
	};
</script>

<div class="mb-4">
	<h2 class="text-lg font-semibold">U.S. House · Florida</h2>
	<p class="text-muted text-xs">2026 district layout · unofficial candidate results</p>
</div>

{#if !reported.length}
	<section class="card mb-4 p-4">
		<h3 class="font-semibold">Results after 7 PM ET</h3>
		<p class="text-muted text-sm">
			Counties post early and mail ballots first, starting when most polls close at 7 PM ET (the
			western Panhandle closes at 8). Election Day precincts follow through the night.
		</p>
	</section>
{/if}

<div
	class="mb-4 grid gap-4 max-sm:grid-cols-2 max-sm:gap-2 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr]"
>
	<section class="card p-4 max-sm:col-span-2 sm:col-span-2 lg:col-span-1">
		<div class="text-muted text-xs font-medium tracking-wide uppercase">
			Seats · currently leading
		</div>
		<div class="num mt-1 flex items-baseline justify-between gap-2">
			<span class="text-rep text-2xl font-semibold">{repSeats} R</span>
			<span class="text-muted text-xs">{close} within 5 pts</span>
			<span class="text-dem text-2xl font-semibold">{demSeats} D</span>
		</div>
		<div class="mt-3 flex gap-0.5" aria-label="District leaders">
			{#each rows as r (r.district.n)}
				<div
					class="h-4 min-w-0 flex-1 rounded-sm"
					style:background={r.district.uncontested
						? partyColor(r.district.uncontested.party)
						: r.race?.total && r.margin !== 0
							? r.margin < 0
								? 'var(--rep)'
								: 'var(--dem)'
							: 'var(--wash)'}
					title="FL-{r.district.n}: {r.district.uncontested
						? `${r.district.uncontested.name}, uncontested`
						: r.race?.total
							? fmtMargin(r.margin)
							: 'No votes yet'}"
				></div>
			{/each}
		</div>
		<p class="text-muted mt-1 text-xs">
			{28 - repSeats - demSeats} unreported or tied{#if called.length}
				· Called: <span class="text-rep font-semibold"
					>{called.filter((c) => c.party === 'REP').length} R</span
				>,
				<span class="text-dem font-semibold"
					>{called.filter((c) => c.party === 'DEM').length} D</span
				>
				({28 - called.length} not yet){/if}
		</p>
	</section>
	<section class="card p-4">
		<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
			House popular vote<Info align="left"
				>Votes across districts reporting candidate totals. Missing district reports are excluded.</Info
			>
		</div>
		<div
			class="num mt-1 text-2xl font-semibold {popular.total ? marginClass(marginOf(popular)) : ''}"
		>
			{popular.total ? fmtMargin(marginOf(popular), 1) : '–'}
		</div>
		<p class="text-2 num text-sm">R {fmtInt(popular.rep)} · D {fmtInt(popular.dem)}</p>
	</section>
	<section class="card p-4">
		<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
			Avg. shift vs. 2024 Pres.<Info align="right"
				>Average change from the 2024 presidential margin on the 2026 lines, across contested
				districts reporting votes.</Info
			>
		</div>
		<div class="num mt-1 text-2xl font-semibold {avgShift === null ? '' : marginClass(avgShift)}">
			{avgShift === null ? '–' : `${avgShift < 0 ? 'R' : 'D'} +${Math.abs(avgShift).toFixed(1)}`}
		</div>
		<p class="text-2 text-sm">
			{avgShift === null ? 'Once districts report' : `${reported.length} districts reporting`}
		</p>
	</section>
</div>

<section class="card mb-4 p-4">
	<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
		<h2 class="flex items-center text-base font-semibold">
			Districts to watch<Info align="left"
				>The four closest reporting races. Uses the current margin until 20% of precincts report,
				then the rough projected margin when turnout inputs are reliable. Updates as reports arrive.</Info
			>
		</h2>
		<span class="text-muted text-xs">Closest races right now</span>
	</div>
	<div class="watch grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each watch as r (r.district.n)}
			<div class="rounded-lg border p-3" style:border-color="var(--border)">
				<div class="mb-2 flex justify-between gap-2">
					<a class="font-semibold hover:underline" href="#district-{r.district.n}"
						>FL-{r.district.n}</a
					>
					<span class="text-muted num text-xs"
						>{counting(r)
							? 'All precincts in · still counting'
							: `${Math.round(r.counted * 100)}% precincts`}</span
					>
				</div>
				{#each [r.rep, r.dem] as c (c?.party)}
					{#if c}
						<div class="num flex justify-between gap-2 text-sm">
							<span class={c.party === 'REP' ? 'text-rep' : 'text-dem'}>{c.name}</span>
							<b>{pct(c.votes, r).toFixed(1)}%</b>
						</div>
					{/if}
				{/each}
				<div class="my-2 flex h-2 overflow-hidden rounded-full" style:background="var(--muted)">
					<div style:width="{pct(r.rep?.votes ?? 0, r)}%" style:background="var(--rep)"></div>
					<div style:width="{pct(r.dem?.votes ?? 0, r)}%" style:background="var(--dem)"></div>
				</div>
				<div class="text-muted num text-xs">
					Now <b class={marginClass(r.margin)}>{fmtMargin(r.margin, 1)}</b>
				</div>
				<div class="text-muted num mt-1 text-xs">
					Proj. <b class={marginClass(r.projected)}
						>{data.projectable ? fmtMargin(r.projected, 1) : 'Awaiting turnout'}</b
					>
					{#if data.projectable}±{r.range.toFixed(1)}{/if}
				</div>
			</div>
		{:else}
			<p class="text-muted text-sm">Closest races appear once votes are reported.</p>
		{/each}
	</div>
</section>

<section class="card mb-4 p-4">
	<h2 class="mb-3 flex items-center text-base font-semibold">
		District map<Info align="left"
			>Candidate margin in each district on the 2026 lines. Uncontested seats are shaded for the
			unopposed party; districts without votes stay gray.</Info
		>
	</h2>
	<DistrictResultsMap {rows} />
</section>

<section class="card mb-4 p-4">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<h2 class="text-base font-semibold">All 28 districts</h2>
		<div class="flex flex-wrap gap-1" role="group" aria-label="District tile measure">
			{#each views as v (v.id)}
				<button
					class="btn"
					class:btn-primary={view === v.id}
					aria-pressed={view === v.id}
					onclick={() => (view = v.id)}>{v.label}</button
				>
			{/each}
		</div>
	</div>
	<div class="tiles grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
		{#each rows as r (r.district.n)}
			<a
				href="#district-{r.district.n}"
				class="num rounded-lg px-3 py-2 text-sm"
				class:outline-dashed={!!r.race?.total && Math.abs(r.margin) < 5}
				class:outline-2={!!r.race?.total && Math.abs(r.margin) < 5}
				class:-outline-offset-2={!!r.race?.total && Math.abs(r.margin) < 5}
				style:background={tileColor(r)}
			>
				<div class="flex flex-wrap justify-between gap-1">
					<b
						>{#if callOf(r.district.n)}<span aria-label="called" title="Called by NBC News"
								>✓
							</span>{/if}FL-{r.district.n}</b
					>
					<span
						>{r.district.uncontested
							? 'Unc.'
							: !r.race?.total
								? '–'
								: view === 'counted'
									? counting(r)
										? 'Counting'
										: `${Math.round(r.counted * 100)}%`
									: fmtMargin(r.margin, 1)}</span
					>
				</div>
				<div class="mt-1 truncate text-xs">
					{r.district.uncontested
						? r.district.uncontested.name
						: !r.race?.total
							? 'No votes yet'
							: r.margin === 0
								? 'Tied'
								: r.margin < 0
									? r.rep?.name
									: r.dem?.name}
				</div>
			</a>
		{/each}
	</div>
	<p class="text-muted mt-2 text-xs">
		One tile per district. ✓ = projected winner called by NBC News. Dashed outline = current margin
		within 5 points.
	</p>
</section>

<section class="card p-4">
	<h2 class="mb-3 flex items-center text-base font-semibold">
		Results by district<Info align="left"
			>Candidate votes include voters of every registration. 2024 Pres. is the 2024 presidential
			margin on the 2026 lines; Shift is the change from it. Precincts at 100% means every precinct
			has reported, but provisional, overseas and cured mail ballots can still be added until the
			count is final.</Info
		>
	</h2>
	<div class="overflow-x-auto">
		<table class="num w-full text-sm" style:min-width="900px">
			<thead>
				<tr class="text-muted text-xs">
					<th class="pb-2 text-left font-medium">Dist.</th>
					<th class="pb-2 pl-3 text-left font-medium">Republican</th>
					<th class="pb-2 pl-3 text-left font-medium">Democrat</th>
					<th class="pb-2 pl-3 text-right font-medium">Margin</th>
					<th class="pb-2 pl-3 text-right font-medium">Precincts</th>
					<th class="pb-2 pl-3 text-right font-medium">2024 Pres.</th>
					<th class="pb-2 pl-3 text-right font-medium">Shift</th>
					<th class="pb-2 pl-3 text-right font-medium">Rough proj.</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.district.n)}
					<tr
						id="district-{r.district.n}"
						class="scroll-mt-4 border-t"
						style:border-color="var(--border)"
					>
						<td class="py-2 align-top font-medium">FL-{r.district.n}</td>
						{#each [r.rep, r.dem] as c, i (i)}
							{@const unopposed =
								r.district.uncontested?.party === (i === 0 ? 'REP' : 'DEM')
									? r.district.uncontested
									: null}
							<td class="pl-3 align-top">
								<div class={i === 0 ? 'text-rep' : 'text-dem'}>
									{#if callOf(r.district.n)?.party === (i === 0 ? 'REP' : 'DEM')}<span
											aria-label="projected winner"
											title="Projected winner (NBC News)">✓</span
										>{/if}
									{unopposed?.name ?? c?.name ?? '–'}
								</div>
								<div class="text-muted text-xs">
									{unopposed
										? 'Uncontested'
										: r.race?.total && c
											? `${fmtInt(c.votes)} · ${pct(c.votes, r).toFixed(1)}%`
											: '–'}
								</div>
							</td>
						{/each}
						{#if r.district.uncontested}
							<td class="pl-3 text-right">Unc.</td>
							<td class="pl-3 text-right">–</td>
						{:else}
							<td class="pl-3 text-right {r.race?.total ? marginClass(r.margin) : ''}"
								>{r.race?.total ? fmtMargin(r.margin, 1) : '–'}</td
							>
							<td class="pl-3 text-right"
								>{r.race?.total ? `${Math.round(r.counted * 100)}%` : '–'}{#if counting(r)}<span
										class="text-muted block text-xs whitespace-nowrap">still counting</span
									>{/if}</td
							>
						{/if}
						<td class="pl-3 text-right {marginClass(-r.district.trump24)}"
							>{fmtMargin(-r.district.trump24, 1)}</td
						>
						<td
							class="pl-3 text-right {r.race?.total && !r.district.uncontested
								? marginClass(r.shift)
								: ''}"
							>{r.race?.total && !r.district.uncontested
								? `${r.shift < 0 ? 'R' : 'D'} +${Math.abs(r.shift).toFixed(1)}`
								: '–'}</td
						>
						<td
							class="pl-3 text-right whitespace-nowrap {r.race?.total
								? marginClass(r.projected)
								: ''}"
						>
							{data.projectable && r.race?.total ? fmtMargin(r.projected, 1) : '–'}
							{#if data.projectable && r.race?.total}<span class="text-muted text-xs"
									>±{r.range.toFixed(1)}</span
								>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="text-muted mt-3 text-xs">
		Rough projection shifts each district's uncounted share by how the remaining statewide vote
		differs from what's counted. Not a race call.
	</p>
</section>

<style>
	@media (max-width: 767px) {
		.watch {
			display: flex;
			overflow-x: auto;
			margin-inline: -0.875rem;
			padding-inline: 0.875rem;
			scroll-padding-inline: 0.875rem;
			scroll-snap-type: x mandatory;
			overscroll-behavior-x: contain;
			scrollbar-width: none;
		}

		.watch::-webkit-scrollbar {
			display: none;
		}

		.watch > div {
			flex: 0 0 min(82%, 18rem);
			scroll-snap-align: start;
		}

		.watch > p {
			flex: 1;
		}
	}

	@media (max-width: 639px) {
		.tiles {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 0.375rem;
		}

		.tiles > a {
			padding: 0.5rem;
			font-size: 0.75rem;
			line-height: 1.3;
		}

		.tiles > a > div:last-child {
			font-size: 0.6875rem;
		}
	}

	@media (max-width: 359px) {
		.tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
