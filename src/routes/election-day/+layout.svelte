<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import logo from '#lib/assets/favicon.svg';
	import { edMode, loadEdMode, setEdMode } from '#lib/ed-mode.svelte.ts';
	import { fmtClock } from '#lib/election.ts';
	import { ELECTION_DAY } from '#lib/model.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import { electionNotice } from '#lib/view-election.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let refreshing = $state(false);

	const ed = $derived(data.election.state);
	const closed = $derived(ed.phase === 'closed');
	const reporting = $derived(ed.counties.filter((c) => (c.eday?.total ?? 0) > 0).length);
	const tabs = $derived([
		{ href: '/election-day', label: closed ? 'Turnout' : 'Turnout & forecast', short: 'Turnout' },
		{ href: '/election-day/state', label: 'State results', short: 'State' },
		{ href: '/election-day/congress', label: 'Congress', short: 'Congress' }
	]);
	const orderedTabs = $derived(closed ? [...tabs.slice(1), tabs[0]] : tabs);
	const showMode = $derived(!closed && page.url.pathname === '/election-day');

	const status = $derived(
		ed.phase === 'pre'
			? data.serverClock.date < ELECTION_DAY
				? Math.floor(data.minute / 1440) === -1
					? 'Polls open tomorrow at 7 AM ET'
					: 'Polls open Tue, Nov 3 at 7 AM ET'
				: 'Polls open at 7 AM ET'
			: ed.phase === 'open'
				? `Live · ${fmtClock(data.minute)} ET · ${reporting}/67 counties`
				: ed.turnoutFinal
					? 'Polls closed · turnout final'
					: 'Polls closed · turnout still arriving'
	);
	const dot = $derived(
		ed.phase === 'pre' ? 'var(--muted)' : ed.phase === 'open' ? '#3fb950' : '#e3b341'
	);
	const time = (at: number) =>
		new Date(at).toLocaleTimeString('en-US', {
			timeZone: 'America/New_York',
			hour: 'numeric',
			minute: '2-digit'
		});
	const updated = $derived(data.election.sources.turnout.acceptedAt);
	const notice = $derived(electionNotice(data.election));

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidate('app:election');
		} finally {
			refreshing = false;
		}
	}

	onMount(() => {
		theme.init();
		loadEdMode();
	});

	$effect(() => {
		const at = updated;
		if (!at) return;
		let timer: ReturnType<typeof setTimeout>;
		const tick = async () => {
			if (document.visibilityState === 'visible') await refresh();
			if (data.election.sources.turnout.acceptedAt === at) timer = setTimeout(tick, 30_000);
		};
		timer = setTimeout(tick, Math.max(5_000, at + 3 * 60_000 + 20_000 - Date.now()));
		return () => clearTimeout(timer);
	});
</script>

<svelte:head>
	<title>Florida Vote Forecaster · Election Day</title>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 py-4 sm:px-6">
	<header class="page-header mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
		<h1 class="flex items-center gap-2.5 text-lg font-semibold tracking-tight sm:text-xl">
			<img src={logo} alt="" class="logo" width="28" height="28" />
			<span>Florida Vote Forecaster</span>
		</h1>
		{#if showMode}
			<div class="mode-toggle" role="group" aria-label="View">
				<button type="button" aria-pressed={!edMode.custom} onclick={() => setEdMode(false)}
					>Live projection</button
				>
				<button type="button" aria-pressed={edMode.custom} onclick={() => setEdMode(true)}
					>Custom forecast</button
				>
			</div>
		{/if}
		<div class="header-tools flex flex-wrap items-center gap-2 text-sm">
			<span class="text-muted inline-flex items-center gap-1.5 text-xs">
				<span class="inline-block h-2 w-2 flex-none rounded-full" style:background={dot}></span>
				<span class="font-medium" style:color="var(--ink-2)">{status}</span>
				{#if updated}<span>· Updated {time(updated)}</span>{/if}
			</span>
			<button
				class="btn header-btn"
				onclick={refresh}
				disabled={refreshing}
				aria-label="Refresh data"
			>
				<span class="label">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
				<span class="icon" aria-hidden="true">↻</span>
			</button>
			<button class="btn header-btn" onclick={() => theme.toggle()} aria-label="Toggle color theme">
				<span class="label">{theme.mode === 'dark' ? 'Light' : 'Dark'}</span>
				<span class="icon" aria-hidden="true">{theme.mode === 'dark' ? '☀' : '☾'}</span>
			</button>
		</div>
		{#if notice}
			<p class="w-full rounded-lg px-3 py-2 text-sm" style:background="var(--wash)" role="status">
				⚠ {notice}
			</p>
		{/if}
	</header>

	<nav
		class="ed-tabs mb-4 flex [scrollbar-width:none] gap-1 overflow-x-auto border-b [&::-webkit-scrollbar]:hidden"
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
				aria-current={on ? 'page' : undefined}
				><span class="max-md:hidden">{tab.label}</span><span class="md:hidden">{tab.short}</span></a
			>
		{/each}
	</nav>

	{@render children()}

	<footer class="text-muted mt-6 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs">
		{#each Object.entries(data.election.sources) as [name, source] (name)}
			<a class="hover:underline" href={source.url} target="_blank" rel="noreferrer"
				>{name[0].toUpperCase() + name.slice(1)}: {source.acceptedAt
					? `${time(source.acceptedAt)} ET`
					: 'waiting'}</a
			>
		{/each}
		<a class="hover:underline" href="/early-voting">Early voting archive</a>
	</footer>
</main>

<style>
	@media (max-width: 767px) {
		.ed-tabs a {
			flex: 1 0 auto;
			padding-top: 0.625rem;
			padding-bottom: 0.625rem;
			text-align: center;
		}
	}
</style>
