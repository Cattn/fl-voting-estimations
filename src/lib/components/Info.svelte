<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		label = 'More info',
		align = 'center'
	}: { children: Snippet; label?: string; align?: 'left' | 'center' | 'right' } = $props();

	const id = $props.id();
	let open = $state(false);
	let pinned = $state(false);
	let root: HTMLSpanElement;

	function onDocClick(e: MouseEvent) {
		if (pinned && !root.contains(e.target as Node)) {
			pinned = false;
			open = false;
		}
	}
</script>

<svelte:document onclick={onDocClick} />

<span
	bind:this={root}
	class="info"
	role="presentation"
	onmouseenter={() => (open = true)}
	onmouseleave={() => (open = pinned)}
>
	<button
		type="button"
		aria-label={label}
		aria-expanded={open}
		aria-describedby={open ? id : undefined}
		onclick={() => {
			pinned = !pinned;
			open = pinned;
		}}
		onfocus={() => (open = true)}
		onblur={() => (open = pinned)}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				pinned = false;
				open = false;
			}
		}}>?</button
	>
	{#if open}
		<span {id} role="tooltip" class="bubble {align}">{@render children()}</span>
	{/if}
</span>

<style>
	.info {
		position: relative;
		display: inline-flex;
		vertical-align: middle;
		margin-left: 0.3rem;
	}

	button {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1px solid var(--axis);
		color: var(--muted);
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
		display: grid;
		place-items: center;
		cursor: help;
		background: transparent;
	}

	button:hover,
	button[aria-expanded='true'] {
		color: var(--ink);
		border-color: var(--ink-2);
	}

	button:focus-visible {
		outline: 2px solid var(--dem);
		outline-offset: 2px;
	}

	.bubble {
		position: absolute;
		top: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		width: max-content;
		max-width: 280px;
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--axis);
		background: var(--surface);
		color: var(--ink-2);
		font-size: 12px;
		font-weight: 400;
		line-height: 1.45;
		text-align: left;
		text-transform: none;
		letter-spacing: normal;
		white-space: normal;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
	}

	.bubble.left {
		left: -6px;
		transform: none;
	}

	.bubble.right {
		left: auto;
		right: -6px;
		transform: none;
	}
</style>
