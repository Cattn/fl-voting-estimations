<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import type { EChartsOption } from 'echarts';

	let {
		option,
		height = 380,
		mobileMinWidth = 0,
		label
	}: { option: EChartsOption; height?: number; mobileMinWidth?: number; label: string } = $props();

	let el: HTMLDivElement;
	let chart: echarts.ECharts | undefined = $state();
	let mobile = $state(false);
	const displayOption = $derived<EChartsOption>(
		mobile
			? {
					...option,
					...(option.grid && !Array.isArray(option.grid)
						? {
								grid: {
									...option.grid,
									left: 44,
									right: option.grid.right === 76 ? 60 : option.grid.right === 64 ? 52 : 12
								}
							}
						: {}),
					tooltip: {
						...(!Array.isArray(option.tooltip) ? option.tooltip : {}),
						confine: true,
						extraCssText: 'max-width:calc(100vw - 64px);white-space:normal;'
					},
					...(option.visualMap && !Array.isArray(option.visualMap)
						? {
								visualMap: {
									...option.visualMap,
									orient: 'horizontal',
									left: 'center',
									itemHeight: 120
								}
							}
						: {})
				}
			: option
	);

	onMount(() => {
		const media = matchMedia('(max-width: 767px)');
		const update = () => (mobile = media.matches);
		update();
		media.addEventListener('change', update);
		const resize = () => {
			const width = el.clientWidth;
			const height = el.clientHeight;
			if (width <= 0 || height <= 0) return;
			if (!chart) {
				chart = echarts.init(el, undefined, { renderer: 'svg', width, height });
			} else {
				chart.resize({ width, height });
			}
			chart.setOption(displayOption, { notMerge: true });
		};
		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(el);
		return () => {
			media.removeEventListener('change', update);
			ro.disconnect();
			chart?.dispose();
		};
	});

	$effect(() => {
		const nextOption = displayOption;
		if (el?.clientWidth > 0 && el.clientHeight > 0) {
			chart?.setOption(nextOption, { notMerge: true });
		}
	});
</script>

<div
	bind:this={el}
	role="img"
	aria-label={label}
	style:--chart-height="{height}px"
	style:--mobile-min-width="{mobileMinWidth}px"
	style:--mobile-chart-height="{Math.min(height, option.visualMap ? 340 : 320)}px"
	class="w-full"
></div>

<style>
	div {
		height: var(--chart-height);
	}

	@media (max-width: 767px) {
		div {
			height: var(--mobile-chart-height);
			min-width: var(--mobile-min-width);
		}
	}
</style>
