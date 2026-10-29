<script lang="ts">
	import { onMount } from 'svelte';
	import EChart from '#lib/components/EChart.svelte';
	import EdCountyMap from '#lib/components/EdCountyMap.svelte';
	import Info from '#lib/components/Info.svelte';
	import LegendToggle from '#lib/components/LegendToggle.svelte';
	import MarginSlider from '#lib/components/MarginSlider.svelte';
	import { dailyChartOption, edDayChartOption, type DailyRow } from '#lib/charts.ts';
	import {
		addCounts,
		dayPaths,
		DEFAULT_PRESET,
		edOutcome,
		fmtClock,
		gapOf,
		halfHourRows,
		LATE_MAIL,
		notYetVoted,
		PRESETS,
		scaleCounts,
		turnoutEstimates
	} from '#lib/election.ts';
	import { DEFAULT_TARGET, fmtInt, fmtLead, fmtMargin, marginOf } from '#lib/model.ts';
	import { loadSaved } from '#lib/saved.ts';
	import { theme } from '#lib/theme.svelte.ts';
	import type { Forecast } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const ed = $derived(data.election.state);
	let target = $state(DEFAULT_TARGET);
	let preset = $state('live');
	let saved = $state<Forecast[]>([]);
	let showRows = $state(false);
	let dayHidden = $state<Record<string, boolean>>({});
	let mounted = $state(false);

	const estimates = $derived(turnoutEstimates(ed));
	const live = $derived(estimates.live);
	const choice = $derived(ed.phase === 'pre' && preset === 'live' ? DEFAULT_PRESET : preset);
	const turnout = $derived(
		ed.phase === 'closed' && ed.turnoutFinal
			? ed.eday
			: ed.phase === 'closed' || choice === 'live'
				? live.turnout
				: estimates.presets.find((p) => p.id === choice)!.turnout
	);
	const outcome = $derived(edOutcome(ed, turnout, target));
	const options = $derived([
		...(ed.phase === 'open' ? [{ id: 'live', label: 'Live estimate', turnout: live.turnout }] : []),
		...PRESETS.map((p) => ({
			id: p.id,
			label: p.label,
			turnout: estimates.presets.find((e) => e.id === p.id)!.turnout
		}))
	]);
	const optionFinal = (t: typeof turnout) => edOutcome(ed, t, target).final.margin;
	const spread = $derived(estimates.presets.map((p) => optionFinal(p.turnout)));
	const paths = $derived(dayPaths(ed, outcome));
	const rows = $derived(halfHourRows(ed, turnout, target));
	const total = $derived(addCounts(ed.early, ed.mail, ed.eday));
	const mailSince = $derived(addCounts(ed.mail, scaleCounts(ed.evMail, -1)));
	const pool = $derived(notYetVoted(ed));
	const visible = (hidden: Record<string, boolean>) =>
		Object.fromEntries(Object.entries(hidden).map(([k, v]) => [k, !v]));
	const dayOption = $derived(edDayChartOption(theme.palette, paths, target, visible(dayHidden)));
	const evDays = $derived<DailyRow[]>(
		data.feed.earlyDays.map((d) => ({
			date: d.date,
			reported: { margin: marginOf(d), volume: d.total, gap: d.dem - d.rep }
		}))
	);
	const recapOption = $derived(dailyChartOption(theme.palette, evDays));
	const marginClass = (v: number) => (v < 0 ? 'text-rep' : 'text-dem');
	const millions = (n: number) => `${(n / 1e6).toFixed(2)}M`;
	const vsTarget = $derived(outcome.final.margin - target);
	const parties = $derived([
		{
			label: 'Republican',
			cls: 'text-rep',
			sofar: ed.eday.rep,
			full: outcome.turnout.rep,
			pool: pool.rep
		},
		{
			label: 'Democrat',
			cls: 'text-dem',
			sofar: ed.eday.dem,
			full: outcome.turnout.dem,
			pool: pool.dem
		},
		{
			label: 'NPA + minor',
			cls: '',
			sofar: ed.eday.npa + ed.eday.oth,
			full: outcome.turnout.npa + outcome.turnout.oth,
			pool: pool.oth
		}
	]);
	const middle = PRESETS.find((p) => p.id === 'middle')!;

	function loadForecast(f: Forecast) {
		target = f.target;
	}

	onMount(() => {
		saved = loadSaved();
		try {
			const current = JSON.parse(
				localStorage.getItem('fl-ev-current') ?? 'null'
			) as Forecast | null;
			const stored = JSON.parse(localStorage.getItem('fl-ed-forecast') ?? 'null') as {
				target?: number;
				preset?: string;
			} | null;
			if (typeof stored?.target === 'number' && Number.isFinite(stored.target))
				target = stored.target;
			else if (current) loadForecast(current);
			if (stored?.preset === 'live' || PRESETS.some((p) => p.id === stored?.preset))
				preset = stored!.preset!;
		} catch {
			return;
		} finally {
			mounted = true;
		}
	});

	$effect(() => {
		const snapshot = JSON.stringify({ target, preset });
		if (mounted) localStorage.setItem('fl-ed-forecast', snapshot);
	});
</script>

<section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Headline numbers">
	<div class="card p-4">
		<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
			Total cast<Info align="left">Mail returned, IPEV, and Election Day voters so far.</Info>
		</div>
		<div class="mt-1 text-2xl font-semibold {marginClass(marginOf(total))}">
			{fmtMargin(marginOf(total), 2)}
		</div>
		<div class="text-2 text-sm">{fmtLead(gapOf(total))} · {fmtInt(total.total)} voters</div>
	</div>
	<div class="card p-4">
		<div class="text-muted text-xs font-medium tracking-wide uppercase">Election Day</div>
		<div class="mt-1 text-2xl font-semibold {ed.eday.total ? marginClass(marginOf(ed.eday)) : ''}">
			{ed.eday.total ? fmtMargin(marginOf(ed.eday), 2) : '-'}
		</div>
		<div class="text-2 text-sm">
			{ed.eday.total ? `${fmtLead(gapOf(ed.eday))} · ${fmtInt(ed.eday.total)}` : 'Polls open 7 AM'}
		</div>
	</div>
	<div class="card p-4">
		<div class="text-muted text-xs font-medium tracking-wide uppercase">IPEV · reported</div>
		<div class="mt-1 text-2xl font-semibold {marginClass(marginOf(ed.early))}">
			{fmtMargin(marginOf(ed.early), 2)}
		</div>
		<div class="text-2 text-sm">{fmtLead(gapOf(ed.early))} · {fmtInt(ed.early.total)}</div>
	</div>
	<div class="card p-4">
		<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
			Mail returned<Info align="right"
				>All mail ballots received, including those arriving after early voting ended.</Info
			>
		</div>
		<div class="mt-1 text-2xl font-semibold {marginClass(marginOf(ed.mail))}">
			{fmtMargin(marginOf(ed.mail), 2)}
		</div>
		<div class="text-2 text-sm">{fmtLead(gapOf(ed.mail))} · {fmtInt(ed.mail.total)}</div>
	</div>
</section>

<div class="grid gap-6 {ed.phase !== 'closed' ? 'lg:grid-cols-[320px_1fr]' : ''}">
	{#if ed.phase !== 'closed'}
		<aside class="card h-fit p-4 lg:sticky lg:top-4" aria-label="Forecast inputs">
			<h2 class="mb-3 text-base font-semibold">Make a forecast</h2>
			<MarginSlider bind:value={target} label="Target final electorate" min={-16} max={0}>
				{#snippet info()}
					The party-registration margin of everyone who votes, including early, mail, and Election
					Day. Nothing else adjusts when you move it; it only changes what the rest of today needs.
				{/snippet}
				{#snippet hint()}
					{#if outcome.needed !== null && Math.abs(outcome.needed) > 100}
						Target is out of reach with the estimated votes left.
					{:else if outcome.needed !== null}
						Rest of {ed.phase === 'pre' ? 'Election Day' : 'today'} needs
						<b class={marginClass(outcome.needed)}>{fmtMargin(outcome.needed, 2)}</b>
						on ~{millions(outcome.rest.total)} votes{#if ed.eday.total}
							· so far <span class={marginClass(outcome.sofarMargin)}
								>{fmtMargin(outcome.sofarMargin, 2)}</span
							>{/if}
					{:else}
						Turnout is final, so the target no longer changes anything.
					{/if}
				{/snippet}
			</MarginSlider>

			<div class="border-t pt-4" style:border-color="var(--border)">
				<h3 class="flex items-center text-sm font-semibold">
					Election Day turnout<Info align="left"
						>Each preset is the share of each party's registered voters who haven't voted yet and
						turn out on Election Day. Middle assumes 41% of remaining Republicans, 29.5% of
						Democrats, and 27% of other voters turn out. These are starting scenarios informed by
						past turnout, not a fitted forecast or probability range. Lean D and Strong D describe
						improvement for Democrats; the final electorate can still favor Republicans. Once polls
						open, every scenario adjusts only the votes still expected. Fresh, consistent county
						reports narrow the spread; changing turnout patterns or stale reports widen it again.
						Missing counties keep their uncertainty, and Central-time counties get their full voting
						day. Live extrapolates reported turnout in each county from its latest update and local
						time. It uses the same Middle starting assumption only where reports are missing or too
						early to extrapolate, and is independent of your selected preset. Report support is
						{Math.round(live.weight * 100)}% right now, with {Math.round(estimates.coverage * 100)}%
						weighted reporting coverage. The turnout curve and scenario spread are assumptions, not
						a statistical confidence interval.</Info
					>
				</h3>
				<p class="text-muted mt-1 text-xs">Who still shows up decides the rest of the day.</p>
				<div class="mt-2 flex flex-col gap-1.5" role="radiogroup" aria-label="Turnout preset">
					{#each options as o (o.id)}
						{@const on = choice === o.id}
						{@const final = optionFinal(o.turnout)}
						<button
							type="button"
							role="radio"
							aria-checked={on}
							class="num grid grid-cols-[1fr_auto] rounded-lg border px-2.5 py-1.5 text-left text-xs"
							style:border-color={on ? 'var(--ink)' : 'var(--border)'}
							style:box-shadow={on ? 'inset 0 0 0 1px var(--ink)' : undefined}
							onclick={() => (preset = o.id)}
						>
							<span class="text-sm font-semibold">{o.label}</span>
							<span class="font-semibold {marginClass(final)}">{fmtMargin(final, 2)}</span>
							<span class="text-muted"
								>{millions(o.turnout.total)} · ED {fmtMargin(marginOf(o.turnout))}</span
							>
							<span class="text-muted text-right">final</span>
						</button>
					{/each}
				</div>
				<p class="text-muted num mt-2 text-xs">
					Scenario span: {fmtMargin(Math.min(...spread), 2)} to {fmtMargin(Math.max(...spread), 2)}
					· {(Math.max(...spread) - Math.min(...spread)).toFixed(2)} pts
				</p>
			</div>

			<div class="mt-4 border-t pt-4 text-sm" style:border-color="var(--border)">
				<h3 class="flex items-center text-sm font-semibold">
					Fixed inputs<Info align="left"
						>These can't change anymore. Early voting is final. Mail ballots keep arriving at
						supervisor offices until 7 PM on Election Day; the expected total uses 2022 and 2024
						late returns and is not editable.</Info
					>
				</h3>
				<div class="num mt-2 flex justify-between">
					<span class="text-muted">Early vote</span>
					<span class={marginClass(marginOf(addCounts(ed.early, ed.evMail)))}
						>{fmtMargin(marginOf(addCounts(ed.early, ed.evMail)), 2)} · final</span
					>
				</div>
				<div class="num mt-1 flex justify-between">
					<span class="text-muted">Mail since EV</span>
					<span class={marginClass(marginOf(mailSince))}
						>{ed.lateMailEstimate === false
							? 'Baseline unavailable'
							: `${fmtInt(mailSince.total)} · ${fmtMargin(marginOf(mailSince))}`}</span
					>
				</div>
				<div class="num mt-1 flex justify-between">
					<span class="text-muted">Late mail expected</span>
					<span class="text-dem"
						>{ed.lateMailEstimate === false
							? 'Paused'
							: `~${fmtInt(LATE_MAIL.total / 1000)}k · ${fmtMargin(LATE_MAIL.margin)}`}</span
					>
				</div>
			</div>

			{#if saved.length}
				<div class="mt-4 border-t pt-4" style:border-color="var(--border)">
					<select
						class="field w-full cursor-pointer text-sm"
						aria-label="Load a saved forecast's target"
						onchange={(e) => {
							const f = saved[Number(e.currentTarget.value)];
							if (f) loadForecast(f);
							e.currentTarget.value = '';
						}}
					>
						<option value="">Use a saved forecast's target…</option>
						{#each saved as f, i (i)}
							<option value={i}>{f.name} · {fmtMargin(f.target, 2)}</option>
						{/each}
					</select>
				</div>
			{/if}
		</aside>
	{/if}

	<div class="flex min-w-0 flex-col gap-6">
		<section class="card p-4">
			{#if ed.phase === 'closed'}
				<div class="text-muted text-xs font-medium tracking-wide uppercase">
					{ed.turnoutFinal
						? 'Reported electorate · turnout complete'
						: 'Estimated electorate · turnout updates pending'}
				</div>
				<div class="flex flex-wrap items-baseline gap-x-3">
					<span class="num text-3xl font-semibold {marginClass(outcome.final.margin)}"
						>{fmtMargin(outcome.final.margin, 2)}</span
					>
					<span class="text-2 text-sm"
						>{fmtInt(outcome.final.total)}
						{ed.turnoutFinal ? 'reported' : 'estimated'} voters · {Math.abs(vsTarget).toFixed(2)} pts
						{vsTarget > 0 ? 'more D' : 'more R'} than your target</span
					>
				</div>
			{:else}
				<div class="text-muted flex items-center text-xs font-medium tracking-wide uppercase">
					Projected final<Info align="left"
						>Early vote and mail so far, the late mail estimate, and Election Day turnout from the
						option you picked.</Info
					>
				</div>
				<div class="flex flex-wrap items-baseline gap-x-3">
					<span class="num text-3xl font-semibold {marginClass(outcome.final.margin)}"
						>{fmtMargin(outcome.final.margin, 2)}</span
					>
					<span class="text-2 text-sm"
						>{Math.abs(vsTarget) < 0.005
							? 'On your target'
							: `${Math.abs(vsTarget).toFixed(2)} pts ${vsTarget > 0 ? 'more D' : 'more R'} than your target`}{ed
							.eday.total
							? ` · rest of today at ${fmtMargin(outcome.restMargin, 1)}`
							: ''}</span
					>
				</div>
				<div class="mt-3 h-2 overflow-hidden rounded-full" style:background="var(--wash)">
					<div
						class="h-full rounded-full"
						style:width="{outcome.share * 100}%"
						style:background="var(--ink-2)"
					></div>
				</div>
				<div class="text-muted num mt-1 flex justify-between text-xs">
					<span>{fmtInt(ed.eday.total)} Election Day votes</span>
					<span
						>{Math.round(outcome.share * 100)}% of {millions(outcome.turnout.total)} expected</span
					>
				</div>
			{/if}
		</section>

		<section class="card p-4">
			<h2 class="mb-2 flex items-center text-base font-semibold">
				Final electorate through the day
				<Info align="left"
					>Every half hour: early vote, mail, and Election Day votes so far. After now, the dashed
					line is the path the rest of today needs to land on your target, and the dotted line is
					where the selected turnout lands. Central-time counties close at 8 PM ET.</Info
				>
			</h2>
			{#if ed.phase === 'pre'}
				<p class="text-muted py-10 text-center text-sm">
					Fills in from 7 AM. Election Day needs
					<b class={marginClass(outcome.needed ?? 0)}>{fmtMargin(outcome.needed ?? 0, 2)}</b> for your
					target.
				</p>
			{:else}
				<LegendToggle
					bind:hidden={dayHidden}
					items={[
						{ name: 'Reported', swatch: 'solid' },
						...(paths.path.length ? [{ name: 'Path to target', swatch: 'dashed' as const }] : []),
						...(paths.live.length ? [{ name: 'Selected turnout', swatch: 'dotted' as const }] : [])
					]}
				/>
				<EChart
					option={dayOption}
					height={320}
					label="Final electorate margin through Election Day"
				/>
			{/if}
		</section>

		<section class="card p-4">
			<h2 class="mb-2 flex items-center text-base font-semibold">
				By party today<Info align="left"
					>"Of not-yet-voted" is the share of each party's registered voters who hadn't voted early
					or by mail and are expected to vote today with the selected turnout.</Info
				>
			</h2>
			<div class="overflow-x-auto">
				<table class="num w-full text-sm">
					<thead>
						<tr class="text-muted text-xs">
							<th class="pb-2 text-left font-medium">Party</th>
							<th class="pb-2 pl-3 text-right font-medium">So far</th>
							<th class="pb-2 pl-3 text-right font-medium">Full day</th>
							<th class="pb-2 pl-3 text-right font-medium">Of not-yet-voted</th>
							<th class="pb-2 pl-3 text-right font-medium">Middle</th>
						</tr>
					</thead>
					<tbody>
						{#each parties as r, i (r.label)}
							<tr class="border-t" style:border-color="var(--border)">
								<td class="py-1.5 {r.cls}">{r.label}</td>
								<td class="pl-3 text-right">{fmtInt(r.sofar)}</td>
								<td class="pl-3 text-right">{fmtInt(r.full)}</td>
								<td class="pl-3 text-right"
									>{r.pool ? ((r.full / r.pool) * 100).toFixed(1) : '0'}%</td
								>
								<td class="text-muted pl-3 text-right"
									>{Math.round([middle.rep, middle.dem, middle.oth][i] * 100)}%</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	</div>
</div>

{#if rows.length}
	<section class="card mt-6 p-4">
		<h2 class="mb-2 flex items-center text-base font-semibold">
			Every 30 minutes<Info align="left"
				>Each row is the change since the previous snapshot. "Rest needs" is the margin the rest of
				Election Day needed at that time for your target, using the turnout you selected.</Info
			>
		</h2>
		<div class="overflow-x-auto">
			<table class="num w-full text-sm" style:min-width="560px">
				<thead>
					<tr class="text-muted text-xs">
						<th class="pb-2 text-left font-medium">Time</th>
						<th class="pb-2 pl-3 text-right font-medium">New ED votes</th>
						<th class="pb-2 pl-3 text-right font-medium">Margin of new votes</th>
						<th class="pb-2 pl-3 text-right font-medium">ED so far</th>
						<th class="pb-2 pl-3 text-right font-medium">Total so far</th>
						<th class="pb-2 pl-3 text-right font-medium">Rest needs</th>
					</tr>
				</thead>
				<tbody>
					{#each showRows ? rows : rows.slice(0, 6) as r (r.minute)}
						<tr class="border-t" style:border-color="var(--border)">
							<td class="py-1.5">{fmtClock(r.minute)}</td>
							<td class="pl-3 text-right">{fmtInt(r.added.total)}</td>
							<td class="pl-3 text-right {marginClass(marginOf(r.added))}"
								>{r.added.total ? fmtMargin(marginOf(r.added)) : '-'}</td
							>
							<td class="pl-3 text-right {marginClass(marginOf(r.sofar))}"
								>{fmtMargin(marginOf(r.sofar), 2)}</td
							>
							<td class="pl-3 text-right {marginClass(r.totalMargin)}"
								>{fmtMargin(r.totalMargin, 2)}</td
							>
							<td class="pl-3 text-right {r.needed === null ? 'text-muted' : marginClass(r.needed)}"
								>{r.needed === null
									? '-'
									: Math.abs(r.needed) > 100
										? 'Out of reach'
										: fmtMargin(r.needed, 2)}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if rows.length > 6}
			<button class="btn mt-2" onclick={() => (showRows = !showRows)}>
				{showRows ? 'Show latest 6' : `Show all ${rows.length}`}
			</button>
		{/if}
	</section>
{/if}

<section class="card mt-6 p-4">
	<h2 class="mb-3 text-base font-semibold">By county</h2>
	<EdCountyMap counties={ed.counties} />
</section>

<details class="card mt-6 p-4">
	<summary class="cursor-pointer text-base font-semibold">Early voting recap</summary>
	<p class="text-muted mt-1 text-xs">Daily IPEV margins as reported. No projections.</p>
	<div class="mt-3">
		<EChart
			option={recapOption}
			height={300}
			mobileMinWidth={Math.max(640, evDays.length * 52 + 72)}
			label="Daily IPEV margins"
		/>
	</div>
</details>
