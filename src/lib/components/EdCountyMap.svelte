<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import EChart from './EChart.svelte';
	import Info from './Info.svelte';
	import { mapOption, type MapRow } from '#lib/charts.ts';
	import { apportionDistricts, type DistrictCounts } from '#lib/districts.ts';
	import { addCounts, fmtClock, minuteOfDay, ZERO } from '#lib/election.ts';
	import { fmtInt, fmtMargin, marginOf } from '#lib/model.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { County, PartyCounts } from '#lib/types.ts';

	let { counties }: { counties: County[] } = $props();

	type View = 'all' | 'eday' | 'early' | 'mail' | 'turnout';
	const allViews: { id: View; label: string }[] = [
		{ id: 'all', label: 'All votes' },
		{ id: 'eday', label: 'Election Day' },
		{ id: 'early', label: 'IPEV' },
		{ id: 'mail', label: 'Mail' },
		{ id: 'turnout', label: 'Turnout' }
	];

	let view = $state<View>('all');
	let layer = $state<'counties' | 'districts'>('counties');
	let ready = $state(false);
	let districtsReady = $state(false);
	let failed = $state(false);
	let showAll = $state(false);
	const districtMode = $derived(layer === 'districts');

	interface Row {
		key: string;
		code: string;
		name: string;
		registered: number;
		eday: PartyCounts;
		all: PartyCounts;
		early: PartyCounts;
		mail: PartyCounts;
		turnout: number;
		updated: string | null;
		district?: DistrictCounts;
	}

	const countyRows = $derived<Row[]>(
		counties.map((c) => {
			const eday = c.eday ?? ZERO;
			const all = addCounts(c.early, c.mail, eday);
			return {
				key: c.name,
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

	const districtRows = $derived.by<Row[]>(() => {
		if (!districtMode) return [];
		const base = apportionDistricts(
			countyRows.map((r) => ({
				code: r.code,
				name: r.name,
				registered: r.registered,
				ipev: r.early,
				mail: r.mail,
				total: r.all
			}))
		);
		const eday = apportionDistricts(
			countyRows.map((r) => ({
				code: r.code,
				name: r.name,
				registered: r.registered,
				ipev: r.eday,
				mail: null,
				total: null
			}))
		);
		return base.map((d, i) => {
			const all = d.total ?? addCounts(d.ipev, d.mail ?? ZERO);
			return {
				key: String(d.n),
				code: `CD${d.n}`,
				name: `District ${d.n}`,
				registered: d.registered,
				eday: eday[i].ipev,
				all,
				early: d.ipev,
				mail: d.mail ?? ZERO,
				turnout: d.registered ? (all.total / d.registered) * 100 : 0,
				updated: null,
				district: d
			};
		});
	});

	const rows = $derived(districtMode ? districtRows : countyRows);
	const pres = (trump: number) =>
		trump > 0 ? `Trump +${trump.toFixed(1)}` : `Harris +${(-trump).toFixed(1)}`;

	const mapRows = $derived<MapRow[]>(
		rows.map((r) => ({
			name: r.key,
			title: r.district ? r.name : undefined,
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
			note: r.district
				? `2024: ${pres(r.district.trump24)} · estimate`
				: `Turnout ${r.turnout.toFixed(1)}% of ${fmtInt(r.registered)} registered${r.updated ? ` · ED updated ${r.updated}` : ''}`
		}))
	);
	const option = $derived(
		mapOption(
			theme.palette,
			mapRows,
			view === 'turnout' ? 'turnout' : 'total',
			districtMode ? 'florida-cd' : 'florida'
		)
	);
	const sorted = $derived(
		districtMode
			? rows
			: [...rows].sort((a, b) => b.eday.total - a.eday.total || b.all.total - a.all.total)
	);
	const waiting = $derived(countyRows.filter((r) => !r.eday.total).length);
	const started = $derived(waiting < countyRows.length);
	const views = $derived(started ? allViews : allViews.filter((v) => v.id !== 'eday'));
	const mapReady = $derived(districtMode ? districtsReady : ready);
	const marginClass = (v: number) => (v < 0 ? 'text-rep' : 'text-dem');

	async function loadMap(name: string, url: string) {
		const geo = await fetch(url).then((r) => {
			if (!r.ok) throw new Error(`Map responded ${r.status}`);
			return r.json();
		});
		echarts.registerMap(name, geo as Parameters<typeof echarts.registerMap>[1]);
	}

	async function pickLayer(next: 'counties' | 'districts') {
		layer = next;
		if (next !== 'districts' || districtsReady) return;
		try {
			await loadMap('florida-cd', '/geo/florida-cd.json');
			districtsReady = true;
		} catch {
			failed = true;
		}
	}

	onMount(async () => {
		try {
			await loadMap('florida', '/geo/florida.json');
			ready = true;
		} catch {
			failed = true;
		}
	});
</script>

<div class="seg mb-3" role="group" aria-label="Map areas">
	<button type="button" aria-pressed={!districtMode} onclick={() => pickLayer('counties')}
		>Counties</button
	>
	<button type="button" aria-pressed={districtMode} onclick={() => pickLayer('districts')}
		>Congressional districts</button
	>
</div>

<div class="mb-3 flex flex-wrap gap-1" role="group" aria-label="Map view">
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
	<p class="text-muted text-sm">Map could not be loaded.</p>
{:else if mapReady}
	<EChart
		{option}
		height={460}
		label="Florida {districtMode ? 'congressional district' : 'county'} map, {views.find(
			(v) => v.id === view
		)?.label}"
	/>
{:else}
	<div style:height="460px" class="text-muted grid place-items-center text-sm">Loading map…</div>
{/if}

{#if districtMode}
	<p class="text-muted mt-3 flex items-center text-xs">
		2026 lines · estimated from county data
		<Info align="left">
			Votes are reported by county only. Each county is split across districts by population, and
			split counties are adjusted using 2024 presidential results.
		</Info>
	</p>
{/if}

<div class="mt-4 overflow-x-auto">
	<table class="num w-full text-sm" style:min-width={started ? '560px' : '320px'}>
		<thead>
			<tr class="text-muted text-left text-xs">
				<th class="pb-2 font-medium">{districtMode ? 'District' : 'County'}</th>
				{#if started}
					<th class="pb-2 pl-3 text-right font-medium">ED votes</th>
					<th class="pb-2 pl-3 text-right font-medium">ED margin</th>
				{/if}
				<th class="pb-2 pl-3 text-right font-medium">All votes</th>
				<th class="pb-2 pl-3 text-right font-medium">Turnout</th>
				{#if districtMode}
					<th class="pb-2 pl-3 text-right font-medium">2024 pres.</th>
				{:else if started}
					<th class="pb-2 pl-3 text-right font-medium">Updated</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{#each showAll || districtMode ? sorted : sorted.slice(0, 10) as r (r.code)}
				<tr class="border-t" style:border-color="var(--border)">
					<td class="py-1.5">
						{r.name}
						{#if r.district}<span class="text-muted block max-w-56 truncate text-xs"
								>{r.district.counties.map((c) => c.name).join(', ')}</span
							>{/if}
					</td>
					{#if started}
						<td class="pl-3 text-right">{r.eday.total ? fmtInt(r.eday.total) : '-'}</td>
						<td class="pl-3 text-right {marginClass(marginOf(r.eday))}"
							>{r.eday.total ? fmtMargin(marginOf(r.eday)) : '-'}</td
						>
					{/if}
					<td class="pl-3 text-right {marginClass(marginOf(r.all))}"
						>{fmtMargin(marginOf(r.all))}</td
					>
					<td class="pl-3 text-right">{r.turnout.toFixed(1)}%</td>
					{#if r.district}
						<td class="pl-3 text-right whitespace-nowrap {marginClass(-r.district.trump24)}"
							>{fmtMargin(-r.district.trump24)}</td
						>
					{:else if started}
						<td class="text-muted pl-3 text-right">{r.updated ?? '-'}</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
	<div class="mt-2 flex flex-wrap items-center gap-3">
		{#if !districtMode}
			<button class="btn" onclick={() => (showAll = !showAll)}>
				{showAll ? 'Show top 10' : `Show all ${sorted.length} counties`}
			</button>
		{/if}
		{#if started && waiting}<span class="text-muted text-xs"
				>{waiting} {waiting === 1 ? 'county' : 'counties'} not reporting yet</span
			>{/if}
	</div>
</div>
