<script lang="ts">
	let {
		value = $bindable(),
		label,
		step = 0.1,
		compact = false
	}: { value: number; label: string; step?: number; compact?: boolean } = $props();

	const party = $derived(value > 0 ? 'D' : 'R');
	const magnitude = $derived(Math.round(Math.abs(value) * 100) / 100);

	const setParty = (p: 'R' | 'D') => (value = p === 'D' ? magnitude : -magnitude);
	const setMagnitude = (m: number) => {
		const n = Math.max(0, Number.isFinite(m) ? m : 0);
		value = party === 'D' ? n : -n;
	};
</script>

<div class="flex items-center gap-1" class:w-full={!compact}>
	<div class="toggle" role="group" aria-label="{label} party">
		<button
			type="button"
			class="text-rep"
			class:on={party === 'R'}
			aria-pressed={party === 'R'}
			onclick={() => setParty('R')}>R+</button
		>
		<button
			type="button"
			class="text-dem"
			class:on={party === 'D'}
			aria-pressed={party === 'D'}
			onclick={() => setParty('D')}>D+</button
		>
	</div>
	<input
		class="field min-w-0"
		class:w-16={compact}
		class:flex-1={!compact}
		type="number"
		min="0"
		{step}
		aria-label="{label} margin"
		value={magnitude}
		oninput={(e) => setMagnitude(e.currentTarget.valueAsNumber)}
	/>
</div>

<style>
	.toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		flex-shrink: 0;
	}

	.toggle button {
		padding: 0.35rem 0.45rem;
		font-size: 0.8rem;
		font-weight: 600;
		opacity: 0.4;
	}

	.toggle button.on {
		opacity: 1;
		background: var(--wash);
	}
</style>
