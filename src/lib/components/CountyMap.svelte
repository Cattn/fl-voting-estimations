<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import EChart from './EChart.svelte';
	import Info from './Info.svelte';
	import { mapOption, type MapMetric, type MapRow } from '#lib/charts.ts';
	import { fmtDay, fmtInt, fmtMargin, marginOf } from '#lib/model.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { County, DayCounts } from '#lib/types.ts';

	let {
		counties,
		days,
		currentDate
	}: { counties: County[]; days: DayCounts[]; currentDate?: string } = $props();

	let ready = $state(false);
	let failed = $state(false);
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

	const rows = $derived(
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

	const mapRows = $derived<MapRow[]>(
		rows.map((r) => {
			const value =
				metric === 'turnout'
					? r.turnout
					: metric === 'mail' && r.mail
						? marginOf(r.mail)
						: metric === 'total' && r.total
							? marginOf(r.total)
							: marginOf(r.ipev);
			if (selected) {
				return {
					name: r.name,
					value,
					lines: [{ label: `IPEV ${dayLabel(selected.date)}`, x: r.ipev }],
					note: `${r.turnout.toFixed(2)}% of ${fmtInt(r.registered)} registered voted in person that day`
				};
			}
			return {
				name: r.name,
				value,
				lines: [
					{ label: 'Total', x: r.total! },
					{ label: 'IPEV', x: r.ipev },
					{ label: 'Mail', x: r.mail! }
				],
				note: `Turnout ${r.turnout.toFixed(1)}% of ${fmtInt(r.registered)} registered`
			};
		})
	);

	const sorted = $derived([...rows].sort((a, b) => b.votes - a.votes));
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
	const option = $derived(mapOption(theme.palette, mapRows, metric));
	const partyTotals = $derived(selected ? totals.ipev : totals.total);
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
	<p class="text-muted text-sm">County map could not be loaded.</p>
{:else if ready}
	<EChart
		{option}
		height={460}
		label="Florida county map of {metric}{selected ? ` on ${selected.date}` : ''}"
	/>
{:else}
	<div style:height="460px" class="text-muted grid place-items-center text-sm">Loading map…</div>
{/if}

<div class="text-muted mt-4 flex items-center text-xs">
	Votes by party
	<Info align="left"
		>Each party shows votes cast and its share of all votes in the selected period. These are not
		party turnout rates; the source does not provide county registration totals by party.</Info
	>
</div>
<div class="mt-2 overflow-x-auto">
	<table class="num w-full text-sm" style:min-width="760px">
		<thead>
			<tr class="text-muted text-left text-xs">
				<th class="pb-2 font-medium">County</th>
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
			</tr>
		</thead>
		<tbody>
			{#each showAll ? sorted : sorted.slice(0, 15) as r (r.code)}
				{@const partyCounts = r.total ?? r.ipev}
				<tr class="border-t" style:border-color="var(--border)">
					<td class="py-1.5">{r.name}</td>
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
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr class="border-t-2 font-semibold" style:border-color="var(--axis)">
				<td class="py-2"
					>Total<span class="text-muted block text-xs font-normal whitespace-nowrap"
						>All {rows.length} counties</span
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
			</tr>
		</tfoot>
	</table>
	<button class="btn mt-2 mb-3" onclick={() => (showAll = !showAll)}>
		{showAll ? 'Show top 15' : `Show all ${sorted.length} counties`}
	</button>
</div>

<style>
	@media (max-width: 767px) {
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
