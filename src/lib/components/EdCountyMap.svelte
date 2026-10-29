<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import EChart from './EChart.svelte';
	import { mapOption, type MapRow } from '#lib/charts.ts';
	import { addCounts, fmtClock, minuteOfDay, ZERO } from '#lib/election.ts';
	import { fmtInt, fmtMargin, marginOf } from '#lib/model.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { County } from '#lib/types.ts';

	let { counties }: { counties: County[] } = $props();

	type View = 'all' | 'eday' | 'early' | 'mail' | 'turnout';
	const views: { id: View; label: string }[] = [
		{ id: 'all', label: 'All votes' },
		{ id: 'eday', label: 'Election Day only' },
		{ id: 'early', label: 'IPEV' },
		{ id: 'mail', label: 'Mail' },
		{ id: 'turnout', label: 'Turnout %' }
	];

	let view = $state<View>('all');
	let ready = $state(false);
	let failed = $state(false);
	let showAll = $state(false);

	const rows = $derived(
		counties.map((c) => {
			const eday = c.eday ?? ZERO;
			const all = addCounts(c.early, c.mail, eday);
			return {
				code: c.code,
				name: c.name,
				registered: c.registered,
				eday,
				all,
				early: c.early,
				mail: c.mail,
				turnout: c.registered ? (all.total / c.registered) * 100 : 0,
				updated: eday.total && c.updated ? fmtClock(minuteOfDay(c.updated)) : null
			};
		})
	);

	const mapRows = $derived<MapRow[]>(
		rows.map((r) => ({
			name: r.name,
			value:
				view === 'turnout'
					? r.turnout
					: marginOf(view === 'all' ? r.all : view === 'eday' ? r.eday : r[view]),
			lines: [
				{ label: 'All votes', x: r.all },
				{ label: 'Election Day', x: r.eday },
				{ label: 'IPEV', x: r.early },
				{ label: 'Mail', x: r.mail }
			],
			note: `Turnout ${r.turnout.toFixed(1)}% of ${fmtInt(r.registered)} registered${r.updated ? ` · ED updated ${r.updated}` : ''}`
		}))
	);
	const option = $derived(
		mapOption(theme.palette, mapRows, view === 'turnout' ? 'turnout' : 'total')
	);
	const sorted = $derived(
		[...rows].sort((a, b) => b.eday.total - a.eday.total || b.all.total - a.all.total)
	);
	const waiting = $derived(rows.filter((r) => !r.eday.total).length);
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
	{#each views as v (v.id)}
		<button
			class="btn"
			class:btn-primary={view === v.id}
			aria-pressed={view === v.id}
			onclick={() => (view = v.id)}>{v.label}</button
		>
	{/each}
</div>

{#if failed}
	<p class="text-muted text-sm">County map could not be loaded.</p>
{:else if ready}
	<EChart
		{option}
		height={460}
		label="Florida county map, {views.find((v) => v.id === view)?.label}"
	/>
{:else}
	<div style:height="460px" class="text-muted grid place-items-center text-sm">Loading map…</div>
{/if}

<div class="mt-4 overflow-x-auto">
	<table class="num w-full text-sm" style:min-width="640px">
		<thead>
			<tr class="text-muted text-left text-xs">
				<th class="pb-2 font-medium">County</th>
				<th class="pb-2 pl-3 text-right font-medium">ED so far</th>
				<th class="pb-2 pl-3 text-right font-medium">ED margin</th>
				<th class="pb-2 pl-3 text-right font-medium">All votes</th>
				<th class="pb-2 pl-3 text-right font-medium">Turnout</th>
				<th class="pb-2 pl-3 text-right font-medium">Updated</th>
			</tr>
		</thead>
		<tbody>
			{#each showAll ? sorted : sorted.slice(0, 10) as r (r.code)}
				<tr class="border-t" style:border-color="var(--border)">
					<td class="py-1.5">{r.name}</td>
					<td class="pl-3 text-right">{r.eday.total ? fmtInt(r.eday.total) : '-'}</td>
					<td class="pl-3 text-right {marginClass(marginOf(r.eday))}"
						>{r.eday.total ? fmtMargin(marginOf(r.eday)) : '-'}</td
					>
					<td class="pl-3 text-right {marginClass(marginOf(r.all))}"
						>{fmtMargin(marginOf(r.all))}</td
					>
					<td class="pl-3 text-right">{r.turnout.toFixed(1)}%</td>
					<td class="text-muted pl-3 text-right">{r.updated ?? 'Not yet'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<div class="mt-2 flex flex-wrap items-center gap-3">
		<button class="btn" onclick={() => (showAll = !showAll)}>
			{showAll ? 'Show top 10' : `Show all ${sorted.length} counties`}
		</button>
		{#if waiting}<span class="text-muted text-xs"
				>{waiting}
				{waiting === 1 ? 'county has' : 'counties have'} not reported Election Day turnout</span
			>{/if}
	</div>
</div>
