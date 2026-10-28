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
			>Cards show today's in-person voting; mail returns are listed below. These are voter party
			registrations, not candidate votes. Margin is (Democrats minus Republicans) divided by all
			voters, including NPA and other registrations. Counts may still update.</Info
		>
	</div>
	<div class="stats-grid grid grid-cols-2 gap-3 lg:grid-cols-5">
		<div class="card p-4">
			<div class="text-muted text-xs font-medium uppercase">Today's margin</div>
			<div class="num mt-1 text-2xl font-semibold {color(margin ?? 0)}">
				{margin === null ? '-' : fmtMargin(margin, 2)}
			</div>
			<div class="text-2 mt-1 text-xs">
				{counted?.total ? 'In-person voters today' : 'Awaiting votes'}
			</div>
		</div>
		<div class="card p-4">
			<div class="text-muted flex items-center text-xs font-medium uppercase">
				Vs. today's forecast<Info align="left"
					>Compares today's actual margin with the same daily expectation shown in the table. The
					expectation uses completed days and stays separate from today's actual counts, including
					after polls close. A positive difference favors Democrats; a negative difference favors
					Republicans.</Info
				>
			</div>
			<div class="num mt-1 text-2xl font-semibold {color(delta ?? 0)}">
				{delta === null ? '-' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)} pts`}
			</div>
			<div class="text-2 mt-1 text-xs">
				{delta === null
					? 'Awaiting votes'
					: Math.abs(delta) < 0.005
						? 'On benchmark'
						: `${delta > 0 ? 'D' : 'R'} ahead of benchmark`}
			</div>
			{#if benchmark}<div class="text-muted mt-1 text-xs">
					Expected {fmtMargin(benchmark.margin, 2)}
				</div>{/if}
		</div>
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
		<div class="card col-span-2 p-4 lg:col-span-1">
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
	<div class="card mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
		<div class="flex items-center font-medium">
			Mail reported today<Info align="left"
				>Mail returns assigned to this date by the source, including any batch uploads. These are
				already included in the total early-vote chart's reported line alongside IPEV. They are
				separate from the in-person counts above. The benchmark is the forecast's remaining-mail
				margin, which is applied to each projected day. Change it under Advanced to update the
				comparison.</Info
			>
		</div>
		<span class="num">{fmtInt(mail?.total ?? 0)} voters</span>
		<span class="num {color(mailMargin ?? 0)}">
			Margin {mailMargin === null ? '-' : fmtMargin(mailMargin, 2)}
		</span>
		<span class="num {color(mailMargin ?? 0)}">
			Lead {mail?.total ? fmtLead(mail.dem - mail.rep) : '-'}
		</span>
		<span class="num text-muted">Expected {fmtMargin(mailBenchmark, 2)}</span>
		<span class="num {color(mailDelta ?? 0)}">
			{mailDelta === null
				? 'Vs. forecast: -'
				: Math.abs(mailDelta) < 0.005
					? 'On benchmark'
					: `${Math.abs(mailDelta).toFixed(2)} pts ${mailDelta > 0 ? 'D' : 'R'} ahead of benchmark`}
		</span>
	</div>
</section>

<style>
	@media (max-width: 767px) {
		.stats-grid {
			gap: 0.5rem;
		}
		.text-2xl {
			font-size: 1.25rem;
		}
	}
</style>
