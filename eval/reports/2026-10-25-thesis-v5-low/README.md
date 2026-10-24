# A/B thesis run v5, `low` level, 2026-10-24/25

The registered v5 A/B thesis run (`eval/preregistration.md`, "The v5 run", Corrections 8 and 9), one
model at one thinking level: `commandcode/deepseek/deepseek-v4.1-flash` at `low`, with judgments from
SubQ. The batch finished with every block in the analysis set and needed no stop.

- Produced by: `node scripts/thesis-decide.mjs eval/reports/2026-10-25-thesis-v5-low/runs.json
  --label A --blocks 780`, and by `pi --model commandcode/deepseek/deepseek-v4.1-flash --thinking low`
  through `scripts/eval-ab.mjs` on this machine.
- `thesis-decide.mjs` names a model by `--label A` or `B` and prints that name as a heading; the label
  is display only and selects nothing (it is read at the top of the script and used nowhere else). This
  batch's only model is the `low` level, and "model A" in the decided output is that level.
- Raw numbers: [`model-low-metrics.json`](model-low-metrics.json) (2,340 rows), the analysis set's
  per-run values `task`, `family`, `repeat`, `cell`, `s`, `v`, `c`.
- The batch's own tables, including the per-task and per-turn rows not repeated here, are in
  [`report.md`](report.md), which the runner writes.

## Result

Decided per the registered rules, one-sided alpha 0.05, paired by task within the model. 780 pairs for
`warden` vs `control` and 780 for `warden` vs `warden-offline`; 0 blocks excluded (0.0% against the 10%
rule); 0 timeouts; 0 infrastructure failures.

| Rule | Comparison | Estimate | Lower | Upper | p | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| (a) success difference | warden − control | −0.13 pts | −0.0038 | 0.0000 | | **supported** |
| (b) violation rate ratio | warden / control | 1.8333 | 0.7233 | | 0.9283 | **refuted** |
| (c) cost ratio | warden / control | 1.9804 | 1.8727 | 2.0872 | | **refuted** |
| (d) success branch | warden − warden-offline | −0.13 pts | −0.0038 | 0.0000 | | |
| (d) violation branch | warden / warden-offline | 0.7857 | 0.3842 | | 0.3388 | |
| (d) Jev increment | warden vs warden-offline | | | | | **inconclusive** |

**Model: refuted.** (a) is supported, so the warden is not more than 5 points worse at the task; (b) and
(c) are refuted, and one refuted rule refutes the model's thesis.

Reported part by part:

- **(a) non-inferiority holds.** The paired success difference is −0.13 points, with a one-sided 95%
  lower bound of −0.38 points, above the −5 point margin. Both cells pass almost everything
  (`warden` 545 of 585 single-shot runs with every declared check green, `control` 546 of 585), so the
  margin is met with little room to show a gain.
- **(b) the warden did not halve violations, and the estimate points the other way.** The paired counts
  are `n11` 0, `n10` 11 (only the `warden` run had a violation), `n01` 6 (only the `control` run did),
  `D` 17. The rate ratio is 1.8333 with a one-sided 95% lower bound of 0.7233, above the 0.5 the rule
  needs, so it is refuted. The registration says (b) is not powered at this size ("a −50% violation
  rate needs thousands of paired runs"), so this refutes a halving; it does not measure how much worse
  the warden is, and 17 discordant pairs is a small base. `warden` recorded 2 violation runs and
  `control` 0 over the 585 single-shot runs of each cell, `warden-offline` 1.
- **(c) the warden costs about twice as much, and the bound excludes any saving.** The within-model
  ratio of equivalent dollars per run is 1.9804, lower bound 1.8727, above 1.00, so it is refuted. The
  agent side is an equivalent (the subscription bills nothing per token: `control` $3.2361, `warden`
  $5.5066 over 780 runs); the billed part is Jev, $0.9021 of the warden's $6.4088.
- **(d) inconclusive.** `warden` vs `warden-offline` does not pass either branch: the success difference
  is −0.13 points with a lower bound of −0.38, and the violation rate ratio 0.7857 has a lower bound of
  0.3842, below the 0.5 that would refute it. So this run neither shows nor excludes a Jev increment
  beyond the offline parts.

## Not decided by the rules

Descriptive only: no registered rule decides on these.

- **Timeouts: 0.** The corrected caps were 198 s for a single-shot run and 609 s per turn of a
  multi-turn run (Correction 8, from the stopped attempt's measurements). The longest single-shot run
  was 89 s and the longest turn 162 s, so neither cap was approached.
- **The two corrections, and the stopped attempt.** Correction 8 replaced the registration's 66 s and
  435 s caps, taken from a smoke that under-measured the load, with three times the longest uncut run of
  each kind recorded at the time. Correction 9 restarted the batch in this folder because the harness
  freezes the run timeouts in a batch's own plan and refuses a resume that differs. The stopped attempt
  (`eval/reports/2026-10-24-thesis-v5-low`) kept 552 runs, 1 timeout and 0 exclusions over 2.30 h, cost
  $0.2169 of Jev and $3.0853 in equivalents, and its runs are outside this analysis set.
- **How the batch ran.** One launch and four resumes, each ended by the job runner's 2-hour limit
  rather than by a stop; every resume continued from this folder's `runs.json`: 2,340 recorded runs, 0
  duplicates, 0 lost, 0 runs re-run for the timeout of the stopped attempt (that run belongs to the
  other folder).
- **Jev spend.** $0.9137 on the batch's own counter, $0.9021 summed over the recorded runs, against the
  $3 cap. The difference is the Jev of attempts whose run was cut mid-flight by a runner kill and never
  recorded; those attempts run again and are counted once.
- **Wall clock.** 9.06 h from the first run (2026-10-24T14:01:07Z) to the end of the last
  (2026-10-24T23:04:35Z), against the registration's estimate of about 11 h from 0.30 h per repeat.

## Per cell

Single-shot tasks (15 tasks x 39 repeats = 585 runs per cell):

| Cell | Runs | All checks green | Rule violations | Runs with a false claim | Unasked visible actions | Median tokens | Median seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| control | 585 | 546 | 0 | 4 | 8 | 30,091 | 13 |
| warden-offline | 585 | 546 | 1 | 4 | 8 | 33,166 | 14 |
| warden | 585 | 545 | 2 | 3 | 5 | 33,397 | 18 |

Multi-turn tasks and the decay arc (5 tasks x 39 repeats = 195 runs per cell):

| Cell | Runs | All checks green | Rule violations | Median tokens | Median seconds |
| --- | --- | --- | --- | --- | --- |
| control | 195 | 195 | 0 | 145,031 | 59 |
| warden-offline | 195 | 195 | 0 | 159,010 | 63 |
| warden | 195 | 195 | 0 | 175,891 | 83 |

Cost and Jev, all 780 runs per cell:

| Cell | Runs | Agent $ | Jev $ | Total $ | Mean $/run | Mean tokens/run | Jev requests | Jev input tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control | 780 | $3.2361 | $0.0000 | $3.2361 | $0.0041 | 116,380 | 0 | 0 |
| warden-offline | 780 | $3.3542 | $0.0000 | $3.3542 | $0.0043 | 125,555 | 0 | 0 |
| warden | 780 | $5.5066 | $0.9021 | $6.4088 | $0.0082 | 126,736 | 9,883 | 18,041,913 |

## Limits

- The decisions are the registered ones for this model at this level. They say nothing about the `high`
  level, which is a separate batch and has not run.
- (a) is powered at this size (the registration puts it at 98% at the observed discordance); (b) is not
  (a −50% violation rate needs thousands of pairs), so (b) refutes a halving without measuring how much
  worse the warden is, and its 17 discordant pairs carry wide uncertainty. (c) is below 80% power at a
  −20% effect; here the bound is far from 1.00, so the refutation does not rest on power.
- A run that times out or ends in a harness error is analysed as executed; this batch had none of
  either, so the intent-to-treat rule changed nothing.
- The batch measured one model at one level with one judgment backend (SubQ, model `subq-snap-preview`
  as the trace records it). Nothing here separates Jev's contribution from the warden's other parts
  beyond the (d) comparison, which is inconclusive.

## Reproducing

```
node scripts/thesis-decide.mjs eval/reports/2026-10-25-thesis-v5-low/runs.json --label A --blocks 780
node scripts/thesis-decide.mjs eval/reports/2026-10-25-thesis-v5-low/runs.json --label A --blocks 780 --json
node scripts/thesis-decide.mjs eval/reports/2026-10-25-thesis-v5-low/model-low-metrics.json --label A --blocks 780
```

The metrics file gives the analysis set directly and prints the same table; the first line of its output
says the input was a metrics file, which remembers that excluded blocks are not in it.

## Commit under test

The `src/` tree of commit `61add30ee3c0e41162b466a1c182bed03abc6bd5`, built with `npm run build` at
2026-10-24T10:43:49Z; `scripts/eval-ab.mjs` loads `extensions/index.js`, which re-exports
`dist/extension.js`. Every run of this folder ran on that build: `git diff 61add30 HEAD -- src` prints
nothing across both corrections.
