<script lang="ts">
	import { onMount } from 'svelte';
	import { fmtDay, fmtInt, fmtMargin, marginOf } from '#lib/model.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	onMount(() => theme.init());
</script>

<svelte:head><title>Early voting archive · Florida 2026</title></svelte:head>
<main class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
	<a class="text-muted text-sm hover:underline" href="/">← Current election dashboard</a>
	<h1 class="mt-4 text-2xl font-semibold">Early voting archive</h1>
	<p class="text-muted mt-1 text-sm">
		Reported daily party registration counts through November 1. Candidate votes are shown on the
		results pages.
	</p>
	{#if data.feed.stale}<p class="card mt-4 p-3 text-sm" role="status">
			Source delayed. Showing the last available reports.
		</p>{/if}
	{#each [{ title: 'In-person early voting', rows: data.feed.earlyDays }, { title: 'Vote by mail', rows: data.feed.mailDays }] as group (group.title)}
		<section class="card mt-5 p-4">
			<h2 class="mb-3 text-lg font-semibold">{group.title}</h2>
			<div class="overflow-x-auto">
				<table class="num w-full text-right text-sm">
					<thead
						><tr class="text-muted"
							><th class="py-2 text-left">Date</th><th>Republican</th><th>Democratic</th><th
								>NPA / other</th
							><th>Total</th><th>Margin</th></tr
						></thead
					>
					<tbody
						>{#each group.rows as row (row.date)}<tr
								class="border-t"
								style:border-color="var(--border)"
								><td class="py-2 text-left whitespace-nowrap">{fmtDay(row.date)}</td><td
									>{fmtInt(row.rep)}</td
								><td>{fmtInt(row.dem)}</td><td>{fmtInt(row.npa + row.oth)}</td><td
									>{fmtInt(row.total)}</td
								><td class="whitespace-nowrap">{fmtMargin(marginOf(row))}</td></tr
							>{:else}<tr><td colspan="6" class="py-4 text-center">Awaiting daily reports.</td></tr
							>{/each}</tbody
					>
				</table>
			</div>
		</section>
	{/each}
	<section class="card mt-5 p-4">
		<h2 class="text-lg font-semibold">County totals</h2>
		<p class="text-muted mb-3 text-xs">
			Latest cumulative reports. Mail totals continue changing after early voting ends.
		</p>
		<div class="overflow-x-auto">
			<table class="num w-full text-right text-sm">
				<thead
					><tr class="text-muted"
						><th class="py-2 text-left">County</th><th>In-person early</th><th>Early margin</th><th
							>Mail reported</th
						></tr
					></thead
				>
				<tbody
					>{#each data.feed.counties as county (county.code)}<tr
							class="border-t"
							style:border-color="var(--border)"
							><td class="py-2 text-left">{county.name}</td><td>{fmtInt(county.early.total)}</td><td
								>{fmtMargin(marginOf(county.early))}</td
							><td>{fmtInt(county.mail.total)}</td></tr
						>{/each}</tbody
				>
			</table>
		</div>
	</section>
	<p class="text-muted mt-4 text-xs">
		Source: <a class="underline" href={data.feed.source}>Florida turnout tracker</a>. Reports may be
		corrected by the source.
	</p>
</main>
