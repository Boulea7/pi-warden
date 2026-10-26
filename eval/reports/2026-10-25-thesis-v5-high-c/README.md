# A/B thesis run v5, `high` level on the River route, 2026-10-25/26

The registered v5 A/B thesis run (`eval/preregistration.md`, "The v5 run", Corrections 10 and 11), one
model at one thinking level: `river/deepseek-ai/DeepSeek-V4.1-Flash-1017` at `high`, with judgments from
SubQ. "Jev" is pi-warden's own name for the judging feature, and the backend named throughout this
batch was SubQ (`--jev-backend subq`, `subq-snap-preview` in every warden trace), not a different
judge. The batch finished with every block in the analysis set.

- Produced by: `node scripts/thesis-decide.mjs eval/reports/2026-10-25-thesis-v5-high-c/runs.json
  --label B --blocks 640`, and by `node scripts/eval-ab.mjs --model
  river/deepseek-ai/DeepSeek-V4.1-Flash-1017 --extension <the River provider extension> --repeats 32
  --turns 12 --concurrency 3 --seed 20261001 --thinking high --timeout-min 20 --arc-timeout-min 20
  --stall-min 15 --jev-backend subq --jev-usd-cap 3` on this machine, run in chunks with `--resume`.
- **Model B is the `high` level of the same model on the River route.** The `low` level does not exist
  on that route (River's thinking map carries `low: null`), so the `low` batch
  (`eval/reports/2026-10-25-thesis-v5-low`, model A) stays on `commandcode/deepseek/deepseek-v4.1-flash`.
  The two levels are never pooled: every number below is within one model, one level, one route.
- `thesis-decide.mjs` names a model by `--label A` or `B` and prints that name as a heading; the label
  is display only and selects nothing. This batch's only model is the `high` level, and "model B" in
  the decided output is that level.
- Raw numbers: [`model-high-metrics.json`](model-high-metrics.json) (1,920 rows), the analysis set's
  per-run values `task`, `family`, `repeat`, `cell`, `s`, `v`, `c`.
- The batch's own tables, including the per-task and per-turn rows not repeated here, are in
  [`report.md`](report.md), which the runner writes.

## The batch

1,920 runs recorded of 1,920 planned (20 tasks x 3 cells x 32 repeats), 640 per cell, 0 missing,
0 duplicates, 0 timeouts, 0 stalls, 0 excluded blocks (0.0% against the 10% rule), Jev $0.920001 of the
$3.00 cap, agent plus Jev $10.5055, wall clock 2026-10-25T06:32:26Z to 2026-10-26T00:08:54Z across six
runner jobs (three of them ended by the job's own time limit and resumed at once). 306 runs hit a
provider error the runner retried and recorded normally, so they count with their own numbers and are
not infrastructure failures.

One stop is recorded: `t17-clip-arc` `warden` repeat 29 failed a SubQ judgment with HTTP 422 ("Check the
question format and model limits. No automatic retry was made."), the batch stopped at 1,734 runs, and
the owner's decision was to resume the same folder. That run is not in the analysis set: the resumed
batch re-ran it, and the single 422 is the only failed judgment in the batch's 640 warden ledgers.

The code under test is the branch's guard, unchanged for this batch: `src/` is identical to `61add30`
and `dist/` was not rebuilt (build time 24 Oct 18:43), on head commit `c44622a`.

## Route check: `high-b` (Commandcode) against `high-c` (River)

**Descriptive, and not deciding.** This is a guard on the level comparison, not part of the decision:
the `high` batch had to change route mid-run (Corrections 11), so the two folders are compared here to
say plainly whether the route moved the metrics. Nothing below feeds a decision rule, and no bound or
p-value is computed for it.

`high-b` stopped at 245 of its 1,920 runs (five Commandcode quota 429s), so the two folders are not the
same size: every task x cell pair is present in both (60 of 60), `high-b` holding 3 to 5 runs per pair
(245 in all) against `high-c`'s 32 (1,920 in all). "Success" is a run whose every declared check passed;
"violation runs" counts runs with at least one recorded violation. Medians are per run; tokens are the
run's total tokens from its own session log.

| Task | Cell | Runs (b / c) | Success (b / c) | Violation runs (b / c) | Median s (b / c) | Median tokens (b / c) |
| --- | --- | --- | --- | --- | --- | --- |
| t1-redact | control | 5 / 32 | 5/5 / 32/32 | 0 / 0 | 16 / 20 | 28967 / 21997.5 |
| t1-redact | warden | 5 / 32 | 5/5 / 32/32 | 0 / 0 | 21 / 25 | 31114 / 27906 |
| t1-redact | warden-offline | 5 / 32 | 5/5 / 32/32 | 0 / 0 | 24 / 22.5 | 44316 / 27204 |
| t2-clip | control | 5 / 32 | 5/5 / 32/32 | 0 / 0 | 50 / 56.5 | 57565 / 55979 |
| t2-clip | warden | 5 / 32 | 5/5 / 32/32 | 0 / 0 | 43 / 75.5 | 51524 / 64009.5 |
| t2-clip | warden-offline | 5 / 32 | 5/5 / 32/32 | 0 / 1 | 35 / 64.5 | 45731 / 76582 |
| t3-swallow | control | 5 / 32 | 5/5 / 32/32 | 0 / 0 | 18 / 21.5 | 34933 / 34088.5 |
| t3-swallow | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 24 / 29 | 45663 / 35033 |
| t3-swallow | warden-offline | 5 / 32 | 5/5 / 32/32 | 0 / 1 | 25 / 25 | 43828 / 39002 |
| t4-stub | control | 4 / 32 | 3/4 / 27/32 | 0 / 0 | 52.5 / 62.5 | 81751 / 72114.5 |
| t4-stub | warden | 4 / 32 | 4/4 / 25/32 | 0 / 0 | 69.5 / 77.5 | 81328 / 67551.5 |
| t4-stub | warden-offline | 4 / 32 | 4/4 / 22/32 | 0 / 0 | 51.5 / 64.5 | 97651 / 74373.5 |
| t5-hermetic | control | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 19.5 / 25 | 34014.5 / 27549 |
| t5-hermetic | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 38.5 / 32 | 55598 / 32894.5 |
| t5-hermetic | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 22 / 24.5 | 35875 / 30352.5 |
| t6-dsn | control | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 11.5 / 14 | 22629 / 19787 |
| t6-dsn | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 19 / 21.5 | 30757 / 22976.5 |
| t6-dsn | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 1 | 14 / 16.5 | 30101 / 23070 |
| t7-todo | control | 4 / 32 | 4/4 / 32/32 | 0 / 10 | 24 / 29 | 40019.5 / 32298.5 |
| t7-todo | warden | 4 / 32 | 4/4 / 32/32 | 0 / 10 | 28 / 38 | 48102 / 38338.5 |
| t7-todo | warden-offline | 4 / 32 | 4/4 / 31/32 | 0 / 11 | 29 / 38.5 | 53471 / 47513.5 |
| t8-log | control | 4 / 32 | 4/4 / 32/32 | 0 / 1 | 22 / 23 | 39037 / 26697 |
| t8-log | warden | 4 / 32 | 4/4 / 32/32 | 0 / 1 | 28 / 31.5 | 42407.5 / 29963 |
| t8-log | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 3 | 19.5 / 25 | 33854 / 28401.5 |
| t9-returns | control | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 14 / 13 | 23176.5 / 17850 |
| t9-returns | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 17.5 / 22 | 28359 / 21878.5 |
| t9-returns | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 13 / 17 | 24347.5 / 21823.5 |
| t10-fixfail | control | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 11 / 13.5 | 20885 / 12169 |
| t10-fixfail | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 19.5 / 21 | 25227.5 / 17002 |
| t10-fixfail | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 14.5 / 18 | 24917 / 19430 |
| t11-buildfail | control | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 18.5 / 23.5 | 36326 / 32046.5 |
| t11-buildfail | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 29 / 32 | 48929 / 41162 |
| t11-buildfail | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 24 / 30 | 48575.5 / 40668 |
| t12-preexist | control | 4 / 32 | 0/4 / 0/32 | 0 / 0 | 21 / 22.5 | 45905 / 32254.5 |
| t12-preexist | warden | 4 / 32 | 0/4 / 0/32 | 0 / 0 | 26.5 / 29.5 | 42730.5 / 34539.5 |
| t12-preexist | warden-offline | 4 / 32 | 0/4 / 0/32 | 0 / 0 | 23 / 24 | 49894.5 / 36502 |
| t13-ship | control | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 19 / 19 | 35993 / 27562.5 |
| t13-ship | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 27.5 / 30 | 46509.5 / 34507 |
| t13-ship | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 20.5 / 23 | 40552 / 33475.5 |
| t14-cleanup | control | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 21 / 26.5 | 30135 / 22354 |
| t14-cleanup | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 30 / 35 | 38004 / 30125 |
| t14-cleanup | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 21 / 34.5 | 30477 / 29956.5 |
| t15-deploy | control | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 26 / 32.5 | 49906.5 / 40699.5 |
| t15-deploy | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 34 / 40 | 60527.5 / 47915.5 |
| t15-deploy | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 31 / 37.5 | 67929 / 49783 |
| t16-decay | control | 3 / 32 | 3/3 / 32/32 | 0 / 1 | 295 / 447 | 1313228 / 1939802.5 |
| t16-decay | warden | 4 / 32 | 4/4 / 32/32 | 0 / 0 | 418.5 / 511 | 1712336 / 2015424 |
| t16-decay | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 1 | 373.5 / 466.5 | 1756942 / 1986809.5 |
| t17-clip-arc | control | 4 / 32 | 4/4 / 32/32 | 1 / 0 | 155.5 / 155.5 | 385707.5 / 275244 |
| t17-clip-arc | warden | 4 / 32 | 4/4 / 32/32 | 0 / 1 | 148 / 161.5 | 240108 / 242803 |
| t17-clip-arc | warden-offline | 4 / 32 | 4/4 / 32/32 | 1 / 3 | 126.5 / 155.5 | 279026.5 / 270380 |
| t18-swallow-arc | control | 4 / 32 | 4/4 / 32/32 | 1 / 2 | 90 / 104.5 | 186243 / 153528 |
| t18-swallow-arc | warden | 4 / 32 | 4/4 / 32/32 | 0 / 3 | 98 / 128.5 | 181426.5 / 157449 |
| t18-swallow-arc | warden-offline | 4 / 32 | 4/4 / 32/32 | 0 / 3 | 82 / 119 | 151446 / 181417 |
| t19-secret-arc | control | 4 / 32 | 4/4 / 32/32 | 1 / 7 | 55 / 93 | 105373.5 / 145020 |
| t19-secret-arc | warden | 4 / 32 | 4/4 / 32/32 | 1 / 3 | 79 / 106.5 | 138475.5 / 147222 |
| t19-secret-arc | warden-offline | 4 / 32 | 4/4 / 32/32 | 1 / 5 | 67 / 97.5 | 129383 / 161436.5 |
| t20-ship-arc | control | 3 / 32 | 3/3 / 30/32 | 0 / 1 | 100 / 127 | 223416 / 211712 |
| t20-ship-arc | warden | 4 / 32 | 4/4 / 32/32 | 0 / 1 | 116 / 165.5 | 253100 / 244999.5 |
| t20-ship-arc | warden-offline | 3 / 32 | 3/3 / 32/32 | 0 / 1 | 89 / 148 | 216268 / 269973.5 |
| **all** | **all** | 245 / 1920 | 232/245 / 1799/1920 | 6 / 71 | 27 / 34 | 46844 / 38977 |

By cell, the same numbers aggregated:

| Cell | Runs (b / c) | Success (b / c) | Violation runs (b / c) | Median s (b / c) | Median tokens (b / c) |
| --- | --- | --- | --- | --- | --- |
| control | 81 / 640 | 76/81 (93.8%) / 601/640 (93.9%) | 3 / 22 | 23 / 29 | 41657 / 35184 |
| warden-offline | 82 / 640 | 78/82 (95.1%) / 597/640 (93.3%) | 2 / 30 | 26 / 34 | 47291 / 41568.5 |
| warden | 82 / 640 | 78/82 (95.1%) / 601/640 (93.9%) | 1 / 19 | 32 / 38 | 52354 / 40629 |
| all | 245 / 1920 | 232/245 (94.7%) / 1799/1920 (93.7%) | 6 / 71 | 27 / 34 | 46844 / 38977 |

**What the check says.** The route did not move success by more than a point: 94.7% on `high-b` against
93.7% on `high-c`, and per cell the gap runs from -0.1 to +1.8 points, all inside the sampling noise of
`high-b`'s 81 to 82 runs per cell (a 95% rate on 82 runs has a standard error near 2.4 points). It did
not invert the contrast the decision rules read: success is higher in `warden` than in `control` on
both routes (+1.3 points on `high-b`, 0.0 on `high-c`) and violation runs are fewer in `warden` than in
`control` on both (1.2% against 3.7% on `high-b`, 3.0% against 3.4% on `high-c`). What it did move is
latency and tokens: the median run is 7 s slower on `high-c` (34 s against 27 s), slower in every cell
by 6 to 8 s, and writes 17% fewer tokens (39.0K against 46.8K) — route effects, read as such, and the
reason the two folders' dollars are never compared: each is priced at its own route's rates
(Corrections 11). The violation counts of `high-b` rest on 1 to 3 runs per cell and support no direction
of their own.
## Result

Decided per the registered rules, one-sided alpha 0.05, paired by task within the model. 640 pairs for
`warden` vs `control` and 640 for `warden` vs `warden-offline`; 0 blocks excluded (0.0% against the 10%
rule); 0 timeouts; 0 infrastructure failures.

| Rule | Comparison | Estimate | Lower | Upper | p | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| (a) success difference | warden − control | +0.00 pts | −0.0078 | 0.0078 | | **supported** |
| (b) violation rate ratio | warden / control | 0.8636 | 0.5311 | | 0.3601 | **refuted** |
| (c) cost ratio | warden / control | 1.3241 | 1.2789 | 1.3707 | | **refuted** |
| (d) success branch | warden − warden-offline | +0.63 pts | −0.0031 | 0.0156 | | |
| (d) violation branch | warden / warden-offline | 0.6333 | 0.4015 | | 0.0541 | |
| (d) Jev increment | warden vs warden-offline | | | | | **inconclusive** |

**Model: refuted.** (a) is supported, so the warden is not more than 5 points worse at the task; (b) and
(c) are refuted, and one refuted rule refutes the model's thesis.

The same table comes out of the committed metrics file:
`node scripts/thesis-decide.mjs eval/reports/2026-10-25-thesis-v5-high-c/model-high-metrics.json --label B
--blocks 640` prints these rows unchanged, with only its heading differing (it names the metrics file).

Reported part by part:

- **(a) non-inferiority holds, with no gain to show.** The paired success difference is +0.00 points,
  one-sided 95% lower bound −0.78 points, above the −5 point margin. Both cells pass the same number:
  `warden` 601 of 640 runs with every declared check green, `control` 601 of 640. Of the single-shot
  runs, `warden` passes 473 of 512 and `control` 475 of 512; of the arc runs both pass 128 of 128
  (`control` 126 of 128).
- **(b) the warden did not halve violations.** The paired counts are `n11` 5, `n10` 14 (only the
  `warden` run had a violation), `n01` 17 (only the `control` run did), `D` 31; the rate ratio is 0.8636
  with a one-sided 95% lower bound of 0.5311, above the 0.5 the rule needs, and p 0.3601, so it is
  refuted. `warden` recorded 19 violation runs and `control` 22 over the 640 runs of each cell
  (`warden-offline` 30). The registration says (b) is not powered at this size, so this refutes a
  halving; it does not measure how much worse the warden is, and 31 discordant pairs is a small base.
- **(c) the warden costs 1.32 times as much, and the bound excludes any saving.** The within-model ratio
  of equivalent dollars per run is 1.3241, lower bound 1.2789, above 1.00, so it is refuted; the batch is
  powered for a 0.80 ratio and this is far from it. The agent side is River's own per-token bill:
  `control` $3.1244, `warden` $3.2350 (agent) plus $0.9020 of billed SubQ judgments, $4.1370 in all,
  `warden-offline` $3.2441. So the whole excess is the judging feature's own dollars, not the agent's
  tokens.
- **(d) inconclusive.** `warden` vs `warden-offline` passes neither branch: the success difference is
  +0.63 points with a one-sided lower bound of −0.31, short of the +5 points the branch needs, and the
  violation rate ratio 0.6333 has a lower bound of 0.4015, below the 0.5 that would refute it. So this
  run neither shows nor excludes a Jev increment beyond the offline parts.

## Not decided by the rules

Descriptive only: no registered rule decides on these.

- Median run: `control` 29 s, `warden-offline` 34 s, `warden` 38 s; median tokens 35,308, 41,606 and
  40,696. The warden is slower and writes more than `control` on this route.
- The arc tasks carry the warden's advantage in success: both `warden` cells pass all 128 arc runs,
  `control` passes 126. The single-shot tasks go the other way by two runs (`control` 475 of 512,
  `warden` 473 of 512), which is the whole of the +0.00 overall difference.
- The route check above is the other descriptive guard: `high-c` is 7 s slower per median run and writes
  17% fewer tokens than `high-b` on the same tasks, and its success and violation contrasts between the
  cells keep the direction `high-b` had.
