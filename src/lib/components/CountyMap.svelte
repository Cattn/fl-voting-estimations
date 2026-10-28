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
	const option = $derived(mapOption(theme.palette, mapRows, metric));
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

<div class="mb-3 flex items-center gap-2 text-sm">
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

<div class="mt-4 overflow-x-auto">
	<table class="num w-full text-sm">
		<thead>
			<tr class="text-muted text-left text-xs">
				<th class="pb-2 font-medium">County</th>
				<th class="pb-2 pl-3 text-right font-medium">{selected ? 'IPEV votes' : 'Voted'}</th>
				<th class="pb-2 pl-3 text-right font-medium">
					{selected ? '% of registered' : 'Turnout'}
				</th>
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
				<tr class="border-t" style:border-color="var(--border)">
					<td class="py-1.5">{r.name}</td>
					<td class="pl-3 text-right">{fmtInt(r.votes)}</td>
					<td class="pl-3 text-right">{r.turnout.toFixed(selected ? 2 : 1)}%</td>
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
	</table>
	<button class="btn mt-2" onclick={() => (showAll = !showAll)}>
		{showAll ? 'Show top 15' : `Show all ${sorted.length} counties`}
	</button>
</div>
