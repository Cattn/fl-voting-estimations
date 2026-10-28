import { describe, expect, it } from 'vitest';
import { marginChartOption } from './charts.ts';
import type { HistoryPoint } from './model.ts';

describe('reported chart dates', () => {
	it('includes reported today and its projection on the same date', () => {
		const counts = { date: '2026-10-27', rep: 50, dem: 40, npa: 10, oth: 0, total: 100 };
		const history: HistoryPoint[] = [
			{
				date: counts.date,
				total: 100,
				gap: -10,
				margin: -10,
				ipevTotal: 100,
				mailTotal: 0,
				dayIpev: counts
			}
		];
		const path = [{ date: counts.date, total: 200, gap: -30, margin: -15 }];
		const palette = {
			surface: '#fff',
			ink: '#000',
			ink2: '#333',
			muted: '#666',
			grid: '#ccc',
			axis: '#aaa',
			dem: '#00f',
			rep: '#f00',
			neutral: '#eee',
			seq: ['#fff']
		};
		const option = marginChartOption(palette, history, path, path, {
			scenario: -5,
			target: -5,
			showBenchmark: false,
			inProgressDate: counts.date
		});
		expect((option.xAxis as { data: string[] }).data).toEqual([counts.date]);
		const series = option.series as { data: { value: number; kind: string }[] }[];
		expect(series[0].data[0]).toMatchObject({ value: -10, kind: 'Reported so far' });
		expect(series[1].data[0]).toMatchObject({ value: -15, kind: 'Your scenario' });
	});
});
