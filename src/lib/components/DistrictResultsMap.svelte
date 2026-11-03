<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import EChart from './EChart.svelte';
	import { mapOption, type MapRow } from '#lib/charts.ts';
	import { fmtMargin } from '#lib/model.ts';
	import type { DistrictResult } from '#lib/results.ts';
	import { theme } from '#lib/theme.svelte.ts';

	let { rows }: { rows: DistrictResult[] } = $props();

	type View = 'margin' | 'shift' | 'pres';
	const views: { id: View; label: string }[] = [
		{ id: 'margin', label: 'Margin' },
		{ id: 'shift', label: 'Shift vs. 2024' },
		{ id: 'pres', label: '2024 Pres.' }
	];
	let view = $state<View>('margin');
	let ready = $state(false);
	let failed = $state(false);

	const pres = (trump: number) =>
		trump > 0 ? `Trump +${trump.toFixed(1)}` : `Harris +${(-trump).toFixed(1)}`;

	const mapRows = $derived<MapRow[]>(
		rows.map((r) => {
			const d = r.district;
			const counted = !!r.race?.total && !d.uncontested;
			const value =
				view === 'pres'
					? -d.trump24
					: d.uncontested
						? view === 'margin'
							? d.uncontested.party === 'REP'
								? -50
								: 50
							: NaN
						: counted
							? view === 'margin'
								? r.margin
								: r.shift
							: NaN;
			const names = [r.rep && `${r.rep.name} (R)`, r.dem && `${r.dem.name} (D)`]
				.filter(Boolean)
				.join(' vs. ');
			const status = d.uncontested
				? `${d.uncontested.name}, uncontested`
				: counted
					? `${names}<br>${Math.round(r.counted * 100)}% precincts · shift ${fmtMargin(r.shift, 1)}`
					: names || 'No votes yet';
			return {
				name: String(d.n),
				title: `FL-${d.n}`,
				value,
				lines: counted
					? [
							{
								label: 'Votes',
								x: { rep: r.rep?.votes ?? 0, dem: r.dem?.votes ?? 0, total: r.race!.total }
							}
						]
					: [],
				note: `${status}<br>2024: ${pres(d.trump24)}`
			};
		})
	);
	const option = $derived(mapOption(theme.palette, mapRows, 'total', 'florida-cd'));

	onMount(async () => {
		try {
			const geo = await fetch('/geo/florida-cd.json').then((r) => {
				if (!r.ok) throw new Error(`Map responded ${r.status}`);
				return r.json();
			});
			echarts.registerMap('florida-cd', geo as Parameters<typeof echarts.registerMap>[1]);
			ready = true;
		} catch {
			failed = true;
		}
	});
</script>

<div class="mb-3 flex flex-wrap gap-1" role="group" aria-label="District map measure">
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
	<p class="text-muted text-sm">District map could not be loaded.</p>
{:else if ready}
	<EChart
		{option}
		height={460}
		label="Florida congressional district map, {views.find((v) => v.id === view)?.label}"
	/>
{:else}
	<div style:height="460px" class="text-muted grid place-items-center text-sm">Loading map…</div>
{/if}
