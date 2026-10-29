<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { fmtClock } from '#lib/election.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const ed = $derived(data.election.state);
	const reporting = $derived(ed.counties.filter((c) => (c.eday?.total ?? 0) > 0).length);
	const tabs = [
		{ href: '/election-day', label: 'Vote Forecaster' },
		{ href: '/election-day/state', label: 'State Results' },
		{ href: '/election-day/congress', label: 'Congressional Results' }
	];
	const orderedTabs = $derived(ed.phase === 'closed' ? [...tabs.slice(1), tabs[0]] : tabs);

	const status = $derived(
		ed.phase === 'pre'
			? `${data.serverClock.date} · ${fmtClock(data.minute)} ET · before polls open`
			: ed.phase === 'open'
				? `Polls open · ${fmtClock(data.minute)} ET · ${reporting} of 67 counties reporting`
				: `Polls closed · ${data.election.state.turnoutFinal ? 'turnout reports complete' : 'turnout reports may still arrive'} · unofficial results`
	);
	const dot = $derived(
		ed.phase === 'pre' ? 'var(--muted)' : ed.phase === 'open' ? '#3fb950' : '#e3b341'
	);

	onMount(() => theme.init());
</script>

<svelte:head>
	<title>Florida Vote Forecaster (2026) · Election Day</title>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<nav
		class="mb-4 flex [scrollbar-width:none] gap-1 overflow-x-auto border-b [&::-webkit-scrollbar]:hidden"
		style:border-color="var(--border)"
	>
		{#each orderedTabs as tab (tab.href)}
			{@const on = page.url.pathname === tab.href}
			<a
				href="{tab.href}{page.url.search}"
				class="-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap"
				class:font-semibold={on}
				style:border-color={on ? 'var(--ink)' : 'transparent'}
				style:color={on ? 'var(--ink)' : 'var(--muted)'}
				aria-current={on ? 'page' : undefined}>{tab.label}</a
			>
		{/each}
	</nav>

	<header class="mb-4 flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
				Florida Vote Forecaster (2026)
			</h1>
			<p class="text-2 mt-1 text-sm">Election Day · Tue, Nov 3</p>
		</div>
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<span class="text-2 inline-flex items-center gap-2 text-xs font-medium">
				<span class="inline-block h-2 w-2 rounded-full" style:background={dot}></span>{status}
			</span>
			<button class="btn" onclick={() => theme.toggle()} aria-label="Toggle color theme">
				{theme.mode === 'dark' ? 'Light' : 'Dark'}
			</button>
		</div>
	</header>

	<div class="text-muted mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
		{#each Object.entries(data.election.sources) as [name, source] (name)}
			<a class="hover:underline" href={source.url} target="_blank" rel="noreferrer"
				>{name}: {source.acceptedAt
					? new Date(source.acceptedAt).toLocaleTimeString('en-US', {
							timeZone: 'America/New_York',
							hour: 'numeric',
							minute: '2-digit'
						}) + ' ET'
					: 'awaiting data'}{source.error ? ' · delayed' : ''}</a
			>
		{/each}
		<a class="hover:underline" href="/early-voting">Early voting archive</a>
	</div>
	{#if data.election.warnings.length || Object.values(data.election.sources).some((s) => s.error)}
		<div class="card mb-4 p-3 text-sm" role="status">
			{#each [...new Set(data.election.warnings)] as warning (warning)}<p class="text-2">
					{warning}
				</p>{/each}
			{#each Object.entries(data.election.sources).filter(([, s]) => s.error) as [name] (name)}<p
					class="text-2"
				>
					{name} data is delayed. Showing the last accepted report.
				</p>{/each}
		</div>
	{/if}

	{@render children()}
</main>
