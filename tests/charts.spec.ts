import { describe, expect, it } from 'vitest';
import { dailyChartOption, marginChartOption } from '../src/lib/charts.ts';
import type { HistoryPoint } from '../src/lib/model.ts';

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
		const tooltip = (option.tooltip as { formatter: (params: unknown) => string }).formatter;
		const params = [
			{
				seriesName: 'Reported',
				axisValue: counts.date,
				data: { ...series[0].data[0], value: -1 }
			},
			{
				seriesName: 'Your scenario',
				axisValue: counts.date,
				data: { ...series[1].data[0], value: -1.67 }
			}
		];
		expect(tooltip(params)).toContain('D+0.67 ahead currently');
		params[0].data.value = -2.34;
		expect(tooltip(params)).toContain('R+0.67 ahead currently');
		params[0].data.value = -1.67;
		expect(tooltip(params)).toContain('On forecast currently');
		expect(tooltip(params.slice(0, 1))).not.toContain('Vs. forecast:');
		expect(tooltip(params.slice(1))).not.toContain('Vs. forecast:');
		const dailyRows = [
			{
				date: counts.date,
				inProgress: true,
				reference: -1.67,
				reported: { margin: -1, volume: 100, gap: -1 },
				scenario: { margin: -1.67, volume: 1000, gap: -16.7 }
			}
		];
		const daily = () =>
			(
				dailyChartOption(palette, dailyRows).tooltip as { formatter: (params: unknown) => string }
			).formatter([{ dataIndex: 0 }]);
		expect(daily()).toContain('Needed full day');
		expect(daily()).toContain('D+0.67 ahead currently');
		expect(daily()).not.toContain('Needed:');
		dailyRows[0].reported.margin = -2.34;
		expect(daily()).toContain('R+0.67 ahead currently');
		dailyRows[0].reported.margin = -1.67;
		expect(daily()).toContain('On pace currently');
		dailyRows[0].reported.volume = 0;
		expect(daily()).not.toContain('Vs. needed:');
		dailyRows[0].inProgress = false;
		expect(daily()).not.toContain('Vs. needed:');
		const nextDay = [{ ...path[0], date: '2026-10-28' }];
		const rollover = marginChartOption(palette, history, nextDay, nextDay, {
			scenario: -5,
			target: -5,
			showBenchmark: true,
			inProgressDate: '2026-10-28'
		});
		const rolloverSeries = rollover.series as {
			data: ({ value: number; kind: string } | null)[];
		}[];
		expect(rolloverSeries[0].data[1]).toBeNull();
		expect(rolloverSeries[1].data[0]).toMatchObject({ value: -10, kind: 'Reported' });
		expect(rolloverSeries[1].data[1]).toMatchObject({ value: -15, kind: 'Your scenario' });
		expect(rolloverSeries[2].data[0]).toMatchObject({ value: -10, kind: 'Reported' });
	});
});
