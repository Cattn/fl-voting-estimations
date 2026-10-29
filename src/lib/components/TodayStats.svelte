<script lang="ts">
	import Info from './Info.svelte';
	import { fmtDay, fmtInt, fmtLead, fmtMargin, marginOf, type CurrentDay } from '#lib/model.ts';
	import type { DayCounts, ForecastDay } from '#lib/types.ts';

	let {
		today,
		benchmark,
		mail,
		mailBenchmark
	}: {
		today: CurrentDay;
		benchmark: ForecastDay | null;
		mail?: DayCounts;
		mailBenchmark: number;
	} = $props();
	const counted = $derived(today.soFar);
	const mailMargin = $derived(mail?.total ? marginOf(mail) : null);
	const mailDelta = $derived(mailMargin === null ? null : mailMargin - mailBenchmark);
	const margin = $derived(counted?.total ? marginOf(counted) : null);
	const delta = $derived(margin !== null && benchmark ? margin - benchmark.margin : null);
	const color = (v: number) => (v < 0 ? 'text-rep' : v > 0 ? 'text-dem' : '');
</script>

<section aria-label="Today's reported voting" class="today-stats">
	<div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
		<h2 class="text-base font-semibold">Voting snapshot</h2>
		<span class="text-muted text-xs"
			>{fmtDay(today.date)} · {today.pollsClosed ? 'Polls closed' : 'So far'}</span
		>
		<Info align="left"
			>Today's in-person voting by party registration. Counts may still update.</Info
		>
	</div>
	<div
		class="stats-grid grid grid-cols-2 gap-3 {today.pollsClosed
			? 'lg:grid-cols-4'
			: 'lg:grid-cols-5'}"
	>
		<div class="card p-4">
			<div class="text-muted text-xs font-medium uppercase">Today's margin</div>
			<div class="num mt-1 text-2xl font-semibold {color(margin ?? 0)}">
				{margin === null ? '-' : fmtMargin(margin, 2)}
			</div>
			<div class="text-2 mt-1 text-xs">
				{counted?.total ? 'In-person voters today' : 'Awaiting votes'}
			</div>
		</div>
		{#if !today.pollsClosed}<div class="card p-4">
				<div class="text-muted flex items-center text-xs font-medium uppercase">
					Vs. projection<Info align="left"
						>Today's margin so far minus the projected margin for the full day.</Info
					>
				</div>
				<div class="num mt-1 text-2xl font-semibold {color(delta ?? 0)}">
					{delta === null ? '-' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)} pts`}
				</div>
				<div class="text-2 mt-1 text-xs">
					{delta === null
						? 'Awaiting votes'
						: Math.abs(delta) < 0.005
							? 'On projection'
							: `${delta > 0 ? 'D' : 'R'} ahead of projection`}
				</div>
			</div>{/if}
		<div class="card p-4">
			<div class="text-muted text-xs font-medium uppercase">Votes today</div>
			<div class="num mt-1 text-2xl font-semibold">{fmtInt(counted?.total ?? 0)}</div>
			<div class="text-2 mt-1 text-xs">Counted in person</div>
		</div>
		<div class="card p-4">
			<div class="text-muted text-xs font-medium uppercase">Today's lead</div>
			<div class="num mt-1 text-2xl font-semibold {color(margin ?? 0)}">
				{counted?.total ? fmtLead(counted.dem - counted.rep) : '-'}
			</div>
			<div class="text-2 mt-1 text-xs">Vote difference</div>
		</div>
		<div class="card col-span-2 p-4 lg:col-span-1 {today.pollsClosed ? 'max-md:col-span-1' : ''}">
			<div class="text-muted text-xs font-medium uppercase">Party share today</div>
			<div class="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-lg font-semibold">
				<span class="text-rep"
					>R {counted?.total ? `${((counted.rep / counted.total) * 100).toFixed(1)}%` : '-'}</span
				>
				<span class="text-dem"
					>D {counted?.total ? `${((counted.dem / counted.total) * 100).toFixed(1)}%` : '-'}</span
				>
			</div>
			<div class="text-2 mt-1 text-xs">Share of all votes today</div>
		</div>
	</div>
	<div class="mail-row card mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
		<div class="flex items-center font-medium">
			Mail reported today<Info align="left"
				>Mail returns the source assigned to today, compared with the projected margin for remaining
				mail.</Info
			>
		</div>
		{#if mail?.retained}
			<span class="text-muted text-xs"> Last reported today · awaiting source update </span>
		{/if}
		<span class="num">{fmtInt(mail?.total ?? 0)} voters</span>
		<span class="num {color(mailMargin ?? 0)}">
			Margin {mailMargin === null ? '-' : fmtMargin(mailMargin, 2)}
		</span>
		<span class="num {color(mailMargin ?? 0)}">
			Lead {mail?.total ? fmtLead(mail.dem - mail.rep) : '-'}
		</span>
		<span class="num text-muted">Projected {fmtMargin(mailBenchmark, 2)}</span>
		<span class="num {color(mailDelta ?? 0)}">
			{mailDelta === null
				? 'Vs. projection: -'
				: Math.abs(mailDelta) < 0.005
					? 'On projection'
					: `${Math.abs(mailDelta).toFixed(2)} pts ${mailDelta > 0 ? 'D' : 'R'} ahead of projection`}
		</span>
	</div>
</section>

<style>
	@media (max-width: 767px) {
		.stats-grid {
			gap: 0.5rem;
		}
		.stats-grid > .card {
			padding: 0.75rem 0.875rem;
		}
		.text-2xl {
			font-size: 1.25rem;
		}
		.mail-row {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0.375rem 0.75rem;
			padding: 0.75rem 0.875rem;
		}
		.mail-row > :first-child,
		.mail-row > :last-child,
		.mail-row > .text-xs {
			grid-column: 1 / -1;
		}
	}
</style>
