<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fmtMargin } from '#lib/model.ts';
	import Info from './Info.svelte';

	let {
		value = $bindable(),
		label,
		min = -30,
		max = 20,
		step = 0.1,
		hint,
		info
	}: {
		value: number;
		label: string;
		min?: number;
		max?: number;
		step?: number;
		hint?: Snippet;
		info?: Snippet;
	} = $props();

	const id = $props.id();
	const zero = $derived(((0 - min) / (max - min)) * 100);
</script>

<div class="mb-4">
	<div class="mb-1 flex items-baseline justify-between gap-2">
		<span class="inline-flex items-center">
			<label for={id} class="text-sm font-semibold">{label}</label>
			{#if info}<Info align="left">{@render info()}</Info>{/if}
		</span>
		<span class="num text-lg font-semibold" class:text-rep={value < 0} class:text-dem={value >= 0}>
			{fmtMargin(value)}
		</span>
	</div>
	<input
		{id}
		type="range"
		{min}
		{max}
		{step}
		bind:value
		style:--zero="{zero}%"
		aria-valuetext={fmtMargin(value)}
	/>
	<div class="text-muted num flex justify-between text-[11px]">
		<span>{fmtMargin(min, 0)}</span>
		<span>{fmtMargin(max, 0)}</span>
	</div>
	{#if hint}
		<p class="text-muted mt-0.5 text-xs">{@render hint()}</p>
	{/if}
</div>

<style>
	input[type='range'] {
		width: 100%;
		appearance: none;
		height: 6px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--rep) 0%,
			var(--neutral) var(--zero),
			var(--dem) 100%
		);
		cursor: pointer;
	}

	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--ink);
		border: 3px solid var(--surface);
		box-shadow: 0 0 0 1px var(--axis);
	}

	input[type='range']::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--ink);
		border: 3px solid var(--surface);
		box-shadow: 0 0 0 1px var(--axis);
	}

	input[type='range']:focus-visible {
		outline: 2px solid var(--dem);
		outline-offset: 4px;
	}

	@media (max-width: 767px) {
		input[type='range'] {
			height: 32px;
			background-size: 100% 6px;
			background-repeat: no-repeat;
			background-position: center;
		}

		input[type='range']::-webkit-slider-thumb {
			width: 24px;
			height: 24px;
		}

		input[type='range']::-moz-range-thumb {
			width: 20px;
			height: 20px;
		}
	}
</style>
