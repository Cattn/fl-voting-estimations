<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import type { EChartsOption } from 'echarts';

	let {
		option,
		height = 380,
		label
	}: { option: EChartsOption; height?: number; label: string } = $props();

	let el: HTMLDivElement;
	let chart: echarts.ECharts | undefined = $state();

	onMount(() => {
		chart = echarts.init(el, undefined, { renderer: 'svg' });
		const ro = new ResizeObserver(() => chart?.resize());
		ro.observe(el);
		return () => {
			ro.disconnect();
			chart?.dispose();
		};
	});

	$effect(() => {
		chart?.setOption(option, { notMerge: true });
	});
</script>

<div bind:this={el} role="img" aria-label={label} style:height="{height}px" class="w-full"></div>
