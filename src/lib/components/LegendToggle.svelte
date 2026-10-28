<script lang="ts" module>
	export type Swatch = 'solid' | 'dashed' | 'dotted' | 'bar' | 'bar-faded' | 'tick';
</script>

<script lang="ts">
	let {
		items,
		hidden = $bindable({})
	}: {
		items: { name: string; swatch: Swatch }[];
		hidden?: Record<string, boolean>;
	} = $props();

	const toggle = (name: string) => (hidden = { ...hidden, [name]: !hidden[name] });
</script>

<div
	class="mb-2 flex flex-wrap items-center gap-1.5 text-sm"
	role="group"
	aria-label="Chart series"
>
	<span class="text-muted mr-1 text-xs">Click to show or hide:</span>
	{#each items as item (item.name)}
		{@const on = !hidden[item.name]}
		<button
			type="button"
			class="chip"
			class:off={!on}
			aria-pressed={on}
			title={on ? `Hide ${item.name}` : `Show ${item.name}`}
			onclick={() => toggle(item.name)}
		>
			<svg width="40" height="14" viewBox="0 0 40 14" aria-hidden="true">
				{#if item.swatch === 'solid' || item.swatch === 'dashed' || item.swatch === 'dotted'}
					<line
						x1="1"
						y1="7"
						x2="39"
						y2="7"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-dasharray={item.swatch === 'dashed'
							? '9 6'
							: item.swatch === 'dotted'
								? '0.1 5'
								: undefined}
					/>
					{#if item.swatch === 'solid'}
						<circle
							cx="20"
							cy="7"
							r="3.5"
							fill="currentColor"
							stroke="var(--surface)"
							stroke-width="1.5"
						/>
					{/if}
				{:else if item.swatch === 'bar'}
					<rect x="14" y="1" width="12" height="12" rx="2" fill="currentColor" />
				{:else if item.swatch === 'bar-faded'}
					<rect
						x="14.5"
						y="1.5"
						width="11"
						height="11"
						rx="2"
						fill="currentColor"
						fill-opacity="0.38"
						stroke="currentColor"
						stroke-dasharray="2 2"
					/>
				{:else}
					<rect x="8" y="6" width="24" height="3" fill="currentColor" />
				{/if}
			</svg>
			<span>{item.name}</span>
		</button>
	{/each}
</div>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.6rem 0.2rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--ink-2);
		background: var(--surface);
		cursor: pointer;
	}

	.chip:hover {
		background: var(--wash);
		border-color: var(--axis);
	}

	.chip.off {
		opacity: 0.45;
	}

	.chip.off span {
		text-decoration: line-through;
	}

	.chip:focus-visible {
		outline: 2px solid var(--dem);
		outline-offset: 2px;
	}

	@media (max-width: 767px) {
		.chip {
			min-height: 40px;
		}
	}
</style>
