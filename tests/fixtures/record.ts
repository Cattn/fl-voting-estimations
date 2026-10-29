import type { ElectionRecord, SourceHealth } from '../../src/lib/live.ts';

export function emptyRecord(at: number): ElectionRecord {
	const health = (url: string): SourceHealth => ({
		url,
		checkedAt: at,
		acceptedAt: at,
		updatedAt: new Date(at).toISOString(),
		error: null
	});
	return {
		sources: {
			turnout: health('https://acorn-maple-earth-lake.grok.me/'),
			results: health(
				'https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt'
			),
			reporting: health('https://floridaelectionwatch.gov/CountyReportingStatus')
		},
		results: [],
		reporting: [],
		history: [],
		night: [],
		baseline: null,
		warnings: []
	};
}
