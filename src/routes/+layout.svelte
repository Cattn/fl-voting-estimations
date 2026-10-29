<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	let { children }: LayoutProps = $props();
	let mounted = $state(false);
	let busy = false;
	const refresh = async () => {
		if (busy || document.visibilityState !== 'visible') return;
		busy = true;
		try {
			await invalidateAll();
		} catch {
			return;
		} finally {
			busy = false;
		}
	};
	$effect(() => {
		if (!mounted || !page.data.serverClock.next) return;
		const delay = Math.max(
			1000,
			page.data.serverClock.next - Date.parse(page.data.serverClock.now)
		);
		const boundary = setTimeout(() => void refresh(), Math.min(delay + 250, 2_147_000_000));
		return () => clearTimeout(boundary);
	});
	onMount(() => {
		mounted = true;
		const visible = () => {
			if (document.visibilityState === 'visible') void refresh();
		};
		const interval = setInterval(() => void refresh(), 3 * 60_000);
		document.addEventListener('visibilitychange', visible);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', visible);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
