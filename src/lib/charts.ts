import type { EChartsOption } from 'echarts';
import type { Palette } from './theme.svelte.ts';
import {
	fmtDay,
	fmtInt,
	fmtLead,
	fmtMargin,
	marginOf,
	type HistoryPoint,
	type ProjectedPoint
} from './model.ts';

const baseText = (p: Palette) => ({
	fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
	color: p.ink2
});

const tooltipBase = (p: Palette) => ({
	backgroundColor: p.surface,
	borderColor: p.axis,
	textStyle: { color: p.ink, fontSize: 12 },
	extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);'
});

const signColor = (p: Palette, v: number) => (v < 0 ? p.rep : p.dem);

const niceBounds = (values: number[], pad = 1) => {
	const lo = Math.min(0, ...values) - pad;
	const hi = Math.max(0, ...values) + pad;
	return { min: Math.floor(lo), max: Math.ceil(hi) };
};

export function marginChartOption(
	p: Palette,
	history: HistoryPoint[],
	scenario: ProjectedPoint[],
	benchmark: ProjectedPoint[],
	final: { scenario: number; target: number; showBenchmark: boolean; inProgressDate?: string },
	selected: Record<string, boolean> = {}
): EChartsOption {
	const dates = [
		...new Set([...history.map((h) => h.date), ...scenario.map((s) => s.date)])
	].sort();

	type Pt = { value: number; total: number; gap: number; kind: string };
	const hist: (Pt | null)[] = dates.map((date) => {
		const h = history.find((h) => h.date === date);
		return h
			? {
					value: h.margin,
					total: h.total,
					gap: h.gap,
					kind: date === final.inProgressDate ? 'Reported so far' : 'Reported'
				}
			: null;
	});
	const proj = (path: ProjectedPoint[], kind: string): (Pt | null)[] => {
		const anchor = history.findLast((h) => !path.length || h.date < path[0].date);
		return dates.map((date) => {
			const point = path.find((s) => s.date === date);
			if (point) return { value: point.margin, total: point.total, gap: point.gap, kind };
			return anchor?.date === date ? hist[dates.indexOf(date)] : null;
		});
	};

	const all = [
		...history.map((h) => h.margin),
		...scenario.map((s) => s.margin),
		...benchmark.map((s) => s.margin),
		final.scenario,
		final.target
	];
	const { min, max } = niceBounds(all, 1.2);

	const lineSeries = (
		name: string,
		data: (Pt | null)[],
		style: { dash: 'solid' | number[]; width: number; symbolSize: number; opacity?: number },
		z: number,
		showEnd = true,
		labelAbove = false
	) => ({
		name,
		type: 'line' as const,
		data,
		z,
		symbol: style.symbolSize ? 'circle' : 'none',
		symbolSize: style.symbolSize,
		showSymbol: style.symbolSize > 0,
		connectNulls: false,
		lineStyle: { width: style.width, type: style.dash, cap: 'round', opacity: style.opacity ?? 1 },
		itemStyle: { color: p.ink2, borderColor: p.surface, borderWidth: 2 },
		emphasis: { scale: 1.4 },
		endLabel: {
			show: showEnd,
			color: p.ink,
			fontSize: 12,
			backgroundColor: p.surface,
			padding: [2, 4],
			borderRadius: 3,
			...(labelAbove ? { offset: [-14, -16] } : {}),
			formatter: (o: { value: unknown }) => fmtMargin(Number((o.value as Pt)?.value ?? o.value), 2)
		}
	});

	return {
		textStyle: baseText(p),
		animationDuration: 400,
		grid: { left: 56, right: 76, top: 16, bottom: 40 },
		legend: {
			show: false,
			selected,
			data: [
				'Reported',
				'Your scenario',
				...(final.showBenchmark ? ['Benchmark path to target'] : [])
			]
		},
		tooltip: {
			...tooltipBase(p),
			trigger: 'axis',
			axisPointer: { type: 'line', lineStyle: { color: p.axis } },
			formatter: (params: unknown) => {
				const rows = (
					params as { seriesName: string; data: Pt | null; axisValue: string }[]
				).filter((r) => r.data);
				if (!rows.length) return '';
				const seen = new Set<string>();
				const lines = rows
					.filter((r) => {
						const k = `${r.data!.kind}-${r.data!.value}`;
						if (seen.has(k)) return false;
						seen.add(k);
						return true;
					})
					.map((r) => {
						const d = r.data!;
						const label = d.kind.startsWith('Reported') ? d.kind : r.seriesName;
						return `<div style="display:flex;gap:12px;justify-content:space-between"><span>${label}</span><b style="color:${signColor(p, d.value)}">${fmtMargin(d.value, 2)}</b></div><div style="color:${p.muted};font-size:11px;margin-bottom:4px">${fmtLead(d.gap)} lead · ${fmtInt(d.total)} voters</div>`;
					});
				const sc = rows.find((r) => r.data!.kind === 'Your scenario')?.data;
				const reported = rows.find((r) => r.data!.kind === 'Reported so far')?.data;
				const delta = reported && sc ? reported.value - sc.value : null;
				const liveDiff =
					delta === null
						? ''
						: `<div style="border-top:1px solid ${p.axis};margin-top:4px;padding-top:4px;color:${Math.abs(delta) < 0.005 ? p.ink2 : signColor(p, delta)};font-size:11px">Vs. forecast: ${Math.abs(delta) < 0.005 ? 'On forecast currently' : `${fmtMargin(delta, 2)} ahead currently`}</div>`;
				const bm = rows.find((r) => r.data!.kind === 'Benchmark path to target')?.data;
				const diff =
					sc && bm
						? `<div style="border-top:1px solid ${p.axis};margin-top:4px;padding-top:4px;color:${p.ink2};font-size:11px">Difference: ${fmtInt(Math.abs(sc.gap - bm.gap))} votes ${sc.gap < bm.gap ? 'more Republican' : 'more Democratic'} than the benchmark</div>`
						: '';
				return `<div style="min-width:190px"><div style="font-weight:600;margin-bottom:4px">${fmtDay(rows[0].axisValue, true)}</div>${lines.join('')}${liveDiff}${diff}</div>`;
			}
		},
		visualMap: {
			show: false,
			type: 'piecewise',
			dimension: 1,
			seriesIndex: final.showBenchmark ? [0, 1, 2] : [0, 1],
			pieces: [
				{ min: -100, max: 0, color: p.rep },
				{ min: 0, max: 100, color: p.dem }
			]
		},
		xAxis: {
			type: 'category',
			data: dates,
			boundaryGap: false,
			axisLine: { lineStyle: { color: p.axis } },
			axisTick: { show: false },
			axisLabel: { color: p.muted, formatter: (v: string) => fmtDay(v) }
		},
		yAxis: {
			type: 'value',
			min,
			max,
			interval: Math.max(1, Math.round((max - min) / 6)),
			axisLabel: { color: p.muted, formatter: (v: number) => fmtMargin(v, 0) },
			splitLine: { lineStyle: { color: p.grid } }
		},
		series: [
			{
				...lineSeries('Reported', hist, { dash: 'solid', width: 2, symbolSize: 9 }, 3, true, true),
				markLine: {
					silent: true,
					symbol: 'none',
					label: { color: p.ink2, fontSize: 11, position: 'insideStartTop' },
					data: [
						{
							yAxis: 0,
							lineStyle: { color: p.axis, type: 'solid', width: 1.5 },
							label: { show: false }
						},
						{
							yAxis: final.target,
							lineStyle: { color: p.ink2, type: 'solid', width: 1, opacity: 0.6 },
							label: {
								formatter: `Target ${fmtMargin(final.target)} · your scenario ends ${fmtMargin(final.scenario, 2)} incl. Election Day`
							}
						}
					]
				}
			},
			lineSeries(
				'Your scenario',
				proj(scenario, 'Your scenario'),
				{ dash: [9, 6], width: 2, symbolSize: 7 },
				2
			),
			...(final.showBenchmark
				? [
						lineSeries(
							'Benchmark path to target',
							proj(benchmark, 'Benchmark path to target'),
							{ dash: [0.1, 5], width: 2.5, symbolSize: 0, opacity: 0.75 },
							1,
							false
						)
					]
				: [])
		]
	} as EChartsOption;
}

export interface DailyRow {
	date: string;
	reference?: number;
	reported?: { margin: number; volume: number; gap: number };
	scenario?: { margin: number; volume: number; gap: number };
	benchmark?: { margin: number; volume: number; gap: number };
	soFar?: { margin: number; volume: number; gap: number };
	inProgress?: boolean;
}

export function dailyChartOption(
	p: Palette,
	rows: DailyRow[],
	selected: Record<string, boolean> = {}
): EChartsOption {
	const values = rows.flatMap((r) =>
		[r.reported?.margin, r.scenario?.margin, r.benchmark?.margin].filter(
			(v): v is number => v !== undefined
		)
	);
	const { min, max } = niceBounds(values, 2);

	const bar = (r: DailyRow['reported'], faded: boolean) =>
		r
			? {
					value: r.margin,
					itemStyle: {
						color: signColor(p, r.margin),
						opacity: faded ? 0.38 : 1,
						borderColor: faded ? signColor(p, r.margin) : 'transparent',
						borderWidth: faded ? 1 : 0,
						borderType: 'dashed',
						borderRadius: r.margin < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0]
					}
				}
			: null;

	return {
		textStyle: baseText(p),
		animationDuration: 400,
		grid: { left: 56, right: 16, top: 24, bottom: 40 },
		legend: {
			show: false,
			selected,
			data: [
				{ name: 'Reported IPEV', itemStyle: { color: p.ink2 } },
				{ name: 'Your scenario', itemStyle: { color: p.ink2, opacity: 0.38 } },
				...(rows.some((r) => r.benchmark)
					? [{ name: 'Benchmark', itemStyle: { color: p.ink } }]
					: [])
			]
		},
		tooltip: {
			...tooltipBase(p),
			trigger: 'axis',
			axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(128,128,128,0.08)' } },
			formatter: (params: unknown) => {
				const i = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
				const r = rows[i];
				const delta =
					r.inProgress && r.reported && r.reported.volume > 0 && r.scenario
						? r.reported.margin - r.scenario.margin
						: null;
				const comparison =
					delta === null
						? ''
						: `<div style="color:${Math.abs(delta) < 0.005 ? p.ink2 : signColor(p, delta)};font-size:11px">Vs. projected: ${Math.abs(delta) < 0.005 ? 'On projection currently' : `${fmtMargin(delta, 2)} ahead currently`}</div>`;
				const line = (label: string, x?: DailyRow['reported']) =>
					x
						? `<div style="display:flex;gap:12px;justify-content:space-between"><span>${label}</span><b style="color:${signColor(p, x.margin)}">${fmtMargin(x.margin)}</b></div><div style="color:${p.muted};font-size:11px;margin-bottom:4px">${fmtLead(x.gap)} lead · ${fmtInt(x.volume)} votes</div>`
						: '';
				return `<div style="min-width:180px"><div style="font-weight:600;margin-bottom:4px">${fmtDay(r.date, true)}</div>${line(r.inProgress ? 'Reported so far' : 'Reported', r.reported)}${line('Counted so far', r.soFar)}${line(r.inProgress ? 'Projected full day' : 'Your scenario', r.scenario)}${line('Benchmark', r.benchmark)}${r.inProgress ? comparison : r.reference === undefined ? '' : `<div style="color:${p.muted};font-size:11px">Expected: ${fmtMargin(r.reference, 2)}</div>`}</div>`;
			}
		},
		xAxis: {
			type: 'category',
			data: rows.map((r) => r.date),
			axisLine: { lineStyle: { color: p.axis } },
			axisTick: { show: false },
			axisLabel: { color: p.muted, formatter: (v: string) => fmtDay(v) }
		},
		yAxis: {
			type: 'value',
			min,
			max,
			axisLabel: { color: p.muted, formatter: (v: number) => fmtMargin(v, 0) },
			splitLine: { lineStyle: { color: p.grid } }
		},
		series: [
			{
				name: 'Reported IPEV',
				type: 'bar',
				barWidth: '58%',
				barGap: '-100%',
				data: rows.map((r) => bar(r.reported, false)),
				label: {
					show: true,
					position: 'outside',
					color: p.ink2,
					fontSize: 11,
					formatter: (o: { value: unknown }) => fmtMargin(Number(o.value))
				}
			},
			{
				name: 'Your scenario',
				type: 'bar',
				barWidth: '58%',
				data: rows.map((r) => bar(r.scenario, true)),
				label: {
					show: !rows.some((r) => r.benchmark),
					position: 'outside',
					color: p.ink2,
					fontSize: 11,
					formatter: (o: { value: unknown }) => fmtMargin(Number(o.value))
				}
			},
			{
				name: 'Benchmark',
				type: 'scatter',
				symbol: 'rect',
				symbolSize: [30, 3],
				itemStyle: { color: p.ink },
				z: 5,
				data: rows.map((r) => (r.benchmark ? r.benchmark.margin : null)),
				label: {
					show: true,
					position: 'top',
					color: p.ink,
					fontSize: 11,
					formatter: (o: { value: unknown }) => fmtMargin(Number(o.value))
				}
			}
		]
	} as EChartsOption;
}

export type MapMetric = 'total' | 'early' | 'mail' | 'turnout';

export interface MapRow {
	name: string;
	value: number;
	lines: { label: string; x: { rep: number; dem: number; total: number } }[];
	note: string;
}

const niceMax = (v: number) => {
	if (v <= 0) return 1;
	const step = v <= 2 ? 0.25 : v <= 5 ? 0.5 : v <= 20 ? 2 : 5;
	return Math.ceil(v / step) * step;
};

export function mapOption(p: Palette, rows: MapRow[], metric: MapMetric): EChartsOption {
	const turnoutMax = niceMax(Math.max(...rows.map((r) => r.value)));
	const pct = (v: number) => `${turnoutMax < 5 ? v.toFixed(1) : Math.round(v)}%`;

	return {
		textStyle: baseText(p),
		tooltip: {
			...tooltipBase(p),
			trigger: 'item',
			formatter: (o: unknown) => {
				const d = (o as { data?: MapRow }).data;
				if (!d) return '';
				const line = (label: string, x: { rep: number; dem: number; total: number }) =>
					`<div style="display:flex;gap:12px;justify-content:space-between"><span>${label}</span><span><b style="color:${signColor(p, marginOf(x))}">${fmtMargin(marginOf(x))}</b> <span style="color:${p.muted}">${fmtInt(x.total)}</span></span></div>`;
				return `<div style="min-width:200px"><div style="font-weight:600;margin-bottom:4px">${d.name}</div>${d.lines.map((l) => line(l.label, l.x)).join('')}<div style="color:${p.muted};font-size:11px;margin-top:4px">${d.note}</div></div>`;
			}
		},
		visualMap:
			metric === 'turnout'
				? {
						type: 'continuous',
						min: 0,
						max: turnoutMax,
						left: 0,
						bottom: 0,
						calculable: false,
						text: [pct(turnoutMax), '0%'],
						textStyle: { color: p.muted },
						inRange: { color: p.seq }
					}
				: {
						type: 'continuous',
						min: -50,
						max: 50,
						left: 0,
						bottom: 0,
						text: ['D+50', 'R+50'],
						textStyle: { color: p.muted },
						inRange: { color: [p.rep, p.neutral, p.dem] }
					},
		series: [
			{
				type: 'map',
				map: 'florida',
				roam: true,
				scaleLimit: { min: 1, max: 8 },
				aspectScale: 0.92,
				data: rows,
				itemStyle: { borderColor: p.surface, borderWidth: 0.8, areaColor: p.neutral },
				emphasis: {
					label: { show: false },
					itemStyle: { borderColor: p.ink, borderWidth: 1.5 }
				},
				select: { disabled: true },
				label: { show: false }
			}
		]
	} as EChartsOption;
}
