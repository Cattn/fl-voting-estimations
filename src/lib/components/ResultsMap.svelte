<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import EChart from './EChart.svelte';
	import { mapOption, type MapRow } from '#lib/charts.ts';
	import { addCounts, ZERO } from '#lib/election.ts';
	import { fmtInt, fmtMargin, marginOf } from '#lib/model.ts';
	import { countedMix, lead, PRES_2024, raceMargin, type RaceTally } from '#lib/results.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { County } from '#lib/types.ts';

	let {
		counties,
		race,
		showComparison = true
	}: { counties: County[]; race: RaceTally; showComparison?: boolean } = $props();

	type View = 'margin' | 'ahead' | 'shift';
	const views: { id: View; label: string }[] = [
		{ id: 'margin', label: 'Margin' },
		{ id: 'ahead', label: 'Ahead of party' },
		{ id: 'shift', label: 'Shift vs. 2024' }
	];
	let view = $state<View>('margin');
	const activeView = $derived(showComparison ? view : 'margin');
	let ready = $state(false);
	let failed = $state(false);
	let showAll = $state(false);

	const rows = $derived(
		race.counties.flatMap((t) => {
			const c = counties.find((x) => x.code === t.county);
			if (!c) return [];
			const ballots = addCounts(c.early, c.mail, c.eday ?? ZERO).total;
			const margin = raceMargin(t);
			const registration = marginOf(countedMix(counties, { ...race, counties: [t] }));
			return [
				{
					code: c.code,
					name: c.name,
					tally: t,
					counted: ballots ? Math.min(1, t.total / ballots) : 0,
					margin,
					registration,
					ahead: margin - registration,
					shift: margin + (PRES_2024[c.code] ?? 0)
				}
			];
		})
	);
	const mapRows = $derived<MapRow[]>(
		rows.map((r) => {
			const rep = lead(r.tally.candidates, 'REP');
			const dem = lead(r.tally.candidates, 'DEM');
			return {
				name: r.name,
				value: r.tally.total ? r[activeView] : 0,
				lines: [{ label: 'Votes', x: { rep, dem, total: r.tally.total } }],
				note: `Est. ${Math.round(r.counted * 100)}% counted · ahead of party ${fmtMargin(r.ahead)} · vs. 2024 ${fmtMargin(r.shift)}`
			};
		})
	);
	const option = $derived(
		mapOption(
			theme.palette,
			!showComparison
				? mapRows.map((r) => ({
						...r,
						value: rows.find((x) => x.name === r.name)?.margin ?? 0,
						note: 'Turnout comparison temporarily unavailable'
					}))
				: mapRows,
			'total'
		)
	);
	const sorted = $derived([...rows].sort((a, b) => b.tally.total - a.tally.total));
	const marginClass = (v: number) => (v < 0 ? 'text-rep' : 'text-dem');

	onMount(async () => {
		try {
			const geo = await fetch('/geo/florida.json').then((r) => r.json());
			echarts.registerMap('florida', geo as Parameters<typeof echarts.registerMap>[1]);
			ready = true;
		} catch {
			failed = true;
		}
	});
</script>

<div class="mb-3 flex flex-wrap gap-1" role="group" aria-label="Map measure">
	{#each showComparison ? views : views.slice(0, 1) as v (v.id)}
		<button
			class="btn"
			class:btn-primary={activeView === v.id}
			aria-pressed={activeView === v.id}
			onclick={() => (view = v.id)}>{v.label}</button
		>
	{/each}
</div>

{#if failed}
	<p class="text-muted text-sm">County map could not be loaded.</p>
{:else if ready}
	<EChart {option} height={460} label="Florida county results map" />
{:else}
	<div style:height="460px" class="text-muted grid place-items-center text-sm">Loading map…</div>
{/if}

<div class="mt-4 overflow-x-auto">
	<table class="num w-full text-sm" style:min-width="900px">
		<thead>
			<tr class="text-muted text-xs">
				<th class="pb-2 text-left font-medium">County</th>
				<th class="pb-2 pl-3 text-right font-medium">Est. counted</th>
				<th class="pb-2 pl-3 text-right font-medium">Votes</th>
				<th class="text-rep pb-2 pl-3 text-right font-medium"
					>{race.candidates.find((c) => c.party === 'REP')?.name ?? 'Republican'} (R)</th
				>
				<th class="text-dem pb-2 pl-3 text-right font-medium"
					>{race.candidates.find((c) => c.party === 'DEM')?.name ?? 'Democrat'} (D)</th
				>
				<th class="pb-2 pl-3 text-right font-medium">Margin</th>
				<th class="pb-2 pl-3 text-right font-medium">Registration</th>
				<th class="pb-2 pl-3 text-right font-medium">Ahead of party</th>
				<th class="pb-2 pl-3 text-right font-medium">vs. 2024 Pres.</th>
			</tr>
		</thead>
		<tbody>
			{#each showAll ? sorted : sorted.slice(0, 10) as r (r.code)}
				<tr class="border-t" style:border-color="var(--border)">
					<td class="py-1.5">{r.name}</td>
					<td class="pl-3 text-right">{showComparison ? `${Math.round(r.counted * 100)}%` : '–'}</td
					>
					<td class="pl-3 text-right">{fmtInt(r.tally.total)}</td>
					<td class="text-rep pl-3 text-right">{fmtInt(lead(r.tally.candidates, 'REP'))}</td>
					<td class="text-dem pl-3 text-right">{fmtInt(lead(r.tally.candidates, 'DEM'))}</td>
					<td class="pl-3 text-right {marginClass(r.margin)}"
						>{r.tally.total ? fmtMargin(r.margin) : '-'}</td
					>
					<td class="pl-3 text-right {marginClass(r.registration)}"
						>{showComparison ? fmtMargin(r.registration) : '–'}</td
					>
					<td class="pl-3 text-right {marginClass(r.ahead)}"
						>{showComparison && r.tally.total ? fmtMargin(r.ahead) : '-'}</td
					>
					<td class="pl-3 text-right {marginClass(r.shift)}"
						>{r.tally.total ? fmtMargin(r.shift) : '-'}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
	<button class="btn mt-2" onclick={() => (showAll = !showAll)}>
		{showAll ? 'Show top 10' : `Show all ${sorted.length} counties`}
	</button>
</div>
