<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import EChart from './EChart.svelte';
	import Info from './Info.svelte';
	import { mapOption, type MapMetric, type MapRow } from '#lib/charts.ts';
	import { apportionDistricts, type DistrictCounts } from '#lib/districts.ts';
	import { fmtDay, fmtInt, fmtMargin, marginOf } from '#lib/model.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { County, DayCounts, PartyCounts } from '#lib/types.ts';

	let {
		counties,
		days,
		currentDate
	}: { counties: County[]; days: DayCounts[]; currentDate?: string } = $props();

	let ready = $state(false);
	let failed = $state(false);
	let layer = $state<'counties' | 'districts'>('counties');
	let districtsReady = $state(false);
	const districtMode = $derived(layer === 'districts');
	let metric = $state<MapMetric>('total');
	let day = $state('all');
	let showAll = $state(false);

	const metrics: { id: MapMetric; label: string; daily: boolean }[] = [
		{ id: 'total', label: 'Total margin', daily: false },
		{ id: 'early', label: 'IPEV margin', daily: true },
		{ id: 'mail', label: 'Mail margin', daily: false },
		{ id: 'turnout', label: 'Turnout %', daily: true }
	];

	const daysWithCounties = $derived(days.filter((d) => d.counties?.length));
	const selected = $derived(daysWithCounties.find((d) => d.date === day));
	const dayLabel = (date: string) =>
		date === currentDate ? `${fmtDay(date)} (so far)` : fmtDay(date);

	function pickDay(next: string) {
		day = next;
		if (next !== 'all' && !metrics.find((m) => m.id === metric)?.daily) metric = 'early';
	}

	const zero = { rep: 0, dem: 0, npa: 0, oth: 0, total: 0 };

	const countyRows = $derived(
		counties.map((c) => {
			const pct = (n: number) => (c.registered ? (n / c.registered) * 100 : 0);
			if (selected) {
				const d = selected.counties?.find((x) => x.code === c.code) ?? { code: c.code, ...zero };
				return {
					code: c.code,
					name: c.name,
					registered: c.registered,
					votes: d.total,
					turnout: pct(d.total),
					ipev: d,
					total: null,
					mail: null
				};
			}
			const t = {
				rep: c.mail.rep + c.early.rep,
				dem: c.mail.dem + c.early.dem,
				npa: c.mail.npa + c.early.npa,
				oth: c.mail.oth + c.early.oth,
				total: c.mail.total + c.early.total
			};
			return {
				code: c.code,
				name: c.name,
				registered: c.registered,
				votes: t.total,
				turnout: pct(t.total),
				ipev: c.early,
				total: t,
				mail: c.mail
			};
		})
	);

	interface Row {
		key: string;
		code: string;
		name: string;
		registered: number;
		votes: number;
		turnout: number;
		ipev: PartyCounts;
		total: PartyCounts | null;
		mail: PartyCounts | null;
		district?: DistrictCounts;
	}

	const rows = $derived<Row[]>(
		districtMode
			? apportionDistricts(countyRows).map((d) => {
					const votes = (d.total ?? d.ipev).total;
					return {
						key: String(d.n),
						code: `CD${d.n}`,
						name: `District ${d.n}`,
						registered: d.registered,
						votes,
						turnout: d.registered ? (votes / d.registered) * 100 : 0,
						ipev: d.ipev,
						total: d.total,
						mail: d.mail,
						district: d
					};
				})
			: countyRows.map((r) => ({ ...r, key: r.name }))
	);

	const pres = (trump: number) =>
		trump > 0 ? `Trump +${trump.toFixed(1)}` : `Harris +${(-trump).toFixed(1)}`;
	const districtNote = (d: DistrictCounts) => `2024: ${pres(d.trump24)} · estimate`;

	const valueOf = (r: Row) =>
		metric === 'turnout'
			? r.turnout
			: metric === 'mail' && r.mail
				? marginOf(r.mail)
				: metric === 'total' && r.total
					? marginOf(r.total)
					: marginOf(r.ipev);
	const metricLabel = $derived(
		metric === 'turnout'
			? 'Turnout'
			: metric === 'mail' && !selected
				? 'Mail'
				: metric === 'total' && !selected
					? 'Total'
					: 'IPEV'
	);

	const mapRows = $derived<MapRow[]>(
		rows.map((r) => {
			const name = r.key;
			const title = r.district ? r.name : undefined;
			const value = valueOf(r);
			if (selected) {
				return {
					name,
					title,
					value,
					lines: [{ label: `IPEV ${dayLabel(selected.date)}`, x: r.ipev }],
					note: r.district
						? districtNote(r.district)
						: `${r.turnout.toFixed(2)}% of ${fmtInt(r.registered)} registered voted in person that day`
				};
			}
			return {
				name,
				title,
				value,
				lines: [
					{ label: 'Total', x: r.total! },
					{ label: 'IPEV', x: r.ipev },
					{ label: 'Mail', x: r.mail! }
				],
				note: r.district
					? districtNote(r.district)
					: `Turnout ${r.turnout.toFixed(1)}% of ${fmtInt(r.registered)} registered`
			};
		})
	);

	const sorted = $derived(districtMode ? rows : [...rows].sort((a, b) => b.votes - a.votes));
	const parties = [
		{ key: 'rep', label: 'R voters', color: 'text-rep' },
		{ key: 'dem', label: 'D voters', color: 'text-dem' }
	] as const;
	const totals = $derived.by(() => {
		const registered = rows.reduce((sum, r) => sum + r.registered, 0);
		const votes = rows.reduce((sum, r) => sum + r.votes, 0);
		const counts = (key: 'ipev' | 'mail' | 'total') =>
			rows.reduce(
				(sum, r) => ({
					rep: sum.rep + (r[key]?.rep ?? 0),
					dem: sum.dem + (r[key]?.dem ?? 0),
					npa: sum.npa + (r[key]?.npa ?? 0),
					oth: sum.oth + (r[key]?.oth ?? 0),
					total: sum.total + (r[key]?.total ?? 0)
				}),
				{ rep: 0, dem: 0, npa: 0, oth: 0, total: 0 }
			);
		return {
			votes,
			turnout: registered ? (votes / registered) * 100 : 0,
			ipev: counts('ipev'),
			mail: counts('mail'),
			total: counts('total')
		};
	});
	const option = $derived(
		mapOption(theme.palette, mapRows, metric, districtMode ? 'florida-cd' : 'florida')
	);
	const partyTotals = $derived(selected ? totals.ipev : totals.total);
	const marginClass = (v: number) => (v < 0 ? 'text-rep' : 'text-dem');
	const mapReady = $derived(districtMode ? districtsReady : ready);

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

<div class="layer-toggle mb-3" role="group" aria-label="Map areas">
	<button type="button" aria-pressed={!districtMode} onclick={() => pickLayer('counties')}
		>Counties</button
	>
	<button type="button" aria-pressed={districtMode} onclick={() => pickLayer('districts')}
		>Congressional districts</button
	>
</div>

<div class="mb-2 flex flex-wrap gap-1" role="group" aria-label="Map measure">
	{#each metrics as m (m.id)}
		<button
			class="btn"
			class:btn-primary={metric === m.id}
			aria-pressed={metric === m.id}
			disabled={!!selected && !m.daily}
			title={selected && !m.daily
				? 'The source reports county mail only as a running total'
				: undefined}
			style:opacity={selected && !m.daily ? 0.4 : undefined}
			onclick={() => (metric = m.id)}>{m.label}</button
		>
	{/each}
</div>

<div class="day-row mb-3 flex items-center gap-2 text-sm">
	<label class="flex items-center gap-2">
		<span class="text-2">Day</span>
		<select
			class="field cursor-pointer"
			value={day}
			onchange={(e) => pickDay(e.currentTarget.value)}
		>
			<option value="all">All days</option>
			{#each [...daysWithCounties].reverse() as d (d.date)}
				<option value={d.date}
					>{fmtDay(d.date, true)}{d.date === currentDate ? ' (so far)' : ''}</option
				>
			{/each}
		</select>
	</label>
	<Info align="left">
		A single day shows in-person voting only. Mail and total margins need all days, because the
		source reports county mail as a running total.
	</Info>
</div>

{#if failed}
	<p class="text-muted text-sm">Map could not be loaded.</p>
{:else if mapReady}
	<EChart
		{option}
		height={460}
		label="Florida {districtMode ? 'congressional district' : 'county'} map of {metric}{selected
			? ` on ${selected.date}`
			: ''}"
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

	<div class="mt-4 md:hidden">
		<table class="num w-full text-sm">
			<thead>
				<tr class="text-muted text-left text-xs">
					<th class="pb-2 font-medium">District</th>
					<th class="pb-2 pl-3 text-right font-medium">{metricLabel}</th>
					<th class="pb-2 pl-3 text-right font-medium">2024</th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as r (r.code)}
					{@const value = valueOf(r)}
					<tr class="border-t" style:border-color="var(--border)">
						<td class="py-2 pr-2">
							<span class="font-medium">{r.district!.n}</span>
							<span class="text-muted block text-xs leading-snug"
								>{r.district!.counties.map((c) => c.name).join(', ')}</span
							>
						</td>
						<td class="py-2 pl-3 text-right whitespace-nowrap">
							<span class={metric === 'turnout' ? '' : marginClass(value)}
								>{metric === 'turnout'
									? `${value.toFixed(selected ? 2 : 1)}%`
									: fmtMargin(value)}</span
							>
							<span class="text-muted block text-xs">{fmtInt(r.votes)} votes</span>
						</td>
						<td class="py-2 pl-3 text-right whitespace-nowrap {marginClass(-r.district!.trump24)}">
							{fmtMargin(-r.district!.trump24)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<div class="text-muted mt-4 flex items-center text-xs {districtMode ? 'max-md:hidden' : ''}">
	Votes by party
	<Info align="left"
		>Votes cast by party and each party's share of all votes in the selected period, not party
		turnout rates.</Info
	>
</div>
<div class="mt-2 overflow-x-auto {districtMode ? 'max-md:hidden' : ''}">
	<table class="num w-full text-sm" style:min-width={districtMode ? '860px' : '760px'}>
		<thead>
			<tr class="text-muted text-left text-xs">
				<th class="pb-2 font-medium">{districtMode ? 'District' : 'County'}</th>
				<th class="pb-2 pl-3 text-right font-medium">{selected ? 'IPEV votes' : 'Voted'}</th>
				<th class="pb-2 pl-3 text-right font-medium">
					{selected ? '% of registered' : 'Turnout'}
				</th>
				{#each parties as party (party.key)}
					<th class="pb-2 pl-3 text-right font-medium whitespace-nowrap {party.color}"
						>{party.label}</th
					>
				{/each}
				{#if !selected}
					<th class="pb-2 pl-3 text-right font-medium">Total</th>
				{/if}
				<th class="pb-2 pl-3 text-right font-medium">IPEV</th>
				{#if !selected}
					<th class="pb-2 pl-3 text-right font-medium">Mail</th>
				{/if}
				{#if districtMode}
					<th class="pb-2 pl-3 text-right font-medium">2024 pres.</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{#each showAll || districtMode ? sorted : sorted.slice(0, 15) as r (r.code)}
				{@const partyCounts = r.total ?? r.ipev}
				<tr class="border-t" style:border-color="var(--border)">
					<td class="py-1.5">
						{r.name}
						{#if r.district}<span class="text-muted block max-w-56 truncate text-xs"
								>{r.district.counties.map((c) => c.name).join(', ')}</span
							>{/if}
					</td>
					<td class="pl-3 text-right">{fmtInt(r.votes)}</td>
					<td class="pl-3 text-right">{r.turnout.toFixed(selected ? 2 : 1)}%</td>
					{#each parties as party (party.key)}
						<td class="py-1.5 pl-3 text-right whitespace-nowrap {party.color}">
							{fmtInt(partyCounts[party.key])}
							<span class="text-muted block text-xs"
								>{r.votes ? `${((partyCounts[party.key] / r.votes) * 100).toFixed(1)}%` : '-'}</span
							>
						</td>
					{/each}
					{#if r.total}
						<td class="pl-3 text-right {marginClass(marginOf(r.total))}">
							{fmtMargin(marginOf(r.total))}
						</td>
					{/if}
					<td class="pl-3 text-right {marginClass(marginOf(r.ipev))}">
						{r.ipev.total ? fmtMargin(marginOf(r.ipev)) : '-'}
					</td>
					{#if r.mail}
						<td class="pl-3 text-right {marginClass(marginOf(r.mail))}">
							{fmtMargin(marginOf(r.mail))}
						</td>
					{/if}
					{#if r.district}
						<td class="pl-3 text-right whitespace-nowrap {marginClass(-r.district.trump24)}">
							{r.district.trump24 > 0 ? 'Trump' : 'Harris'} +{Math.abs(r.district.trump24).toFixed(
								1
							)}
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr class="border-t-2 font-semibold" style:border-color="var(--axis)">
				<td class="py-2"
					>Total<span class="text-muted block text-xs font-normal whitespace-nowrap"
						>All {rows.length} {districtMode ? 'districts' : 'counties'}</span
					></td
				>
				<td class="py-2 pl-3 text-right">{fmtInt(totals.votes)}</td>
				<td class="py-2 pl-3 text-right">{totals.turnout.toFixed(selected ? 2 : 1)}%</td>
				{#each parties as party (party.key)}
					<td class="py-2 pl-3 text-right whitespace-nowrap {party.color}">
						{fmtInt(partyTotals[party.key])}
						<span class="text-muted block text-xs font-normal"
							>{totals.votes
								? `${((partyTotals[party.key] / totals.votes) * 100).toFixed(1)}%`
								: '-'}</span
						>
					</td>
				{/each}
				{#if !selected}
					<td class="py-2 pl-3 text-right {marginClass(marginOf(totals.total))}"
						>{totals.total.total ? fmtMargin(marginOf(totals.total)) : '-'}</td
					>
				{/if}
				<td class="py-2 pl-3 text-right {marginClass(marginOf(totals.ipev))}"
					>{totals.ipev.total ? fmtMargin(marginOf(totals.ipev)) : '-'}</td
				>
				{#if !selected}
					<td class="py-2 pl-3 text-right {marginClass(marginOf(totals.mail))}"
						>{totals.mail.total ? fmtMargin(marginOf(totals.mail)) : '-'}</td
					>
				{/if}
				{#if districtMode}
					<td></td>
				{/if}
			</tr>
		</tfoot>
	</table>
	{#if !districtMode}
		<button class="btn mt-2 mb-3" onclick={() => (showAll = !showAll)}>
			{showAll ? 'Show top 15' : `Show all ${sorted.length} counties`}
		</button>
	{/if}
</div>

<style>
	.layer-toggle {
		display: inline-flex;
		gap: 3px;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--wash);
	}
	.layer-toggle button {
		padding: 0.3rem 0.8rem;
		border-radius: 6px;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--ink-2);
		cursor: pointer;
	}
	.layer-toggle button:hover:not([aria-pressed='true']) {
		color: var(--ink);
	}
	.layer-toggle button[aria-pressed='true'] {
		background: var(--ink);
		color: var(--surface);
		font-weight: 600;
	}
	@media (max-width: 767px) {
		.layer-toggle {
			display: flex;
			width: 100%;
		}
		.layer-toggle button {
			flex: 1;
			min-height: 36px;
		}
		.day-row > label {
			flex: 1;
			min-width: 0;
		}

		.day-row select {
			flex: 1;
			min-width: 0;
		}
	}
</style>
