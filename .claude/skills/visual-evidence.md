# Visual Evidence Skill

A change to what people see ships with before and after pictures, taken by the agent that does the work and added to the pull request and the issue. A person judges the pictures; the factory only makes sure they are real, repeatable and in front of the reviewer.

## Rules

1. **The plan names the screens.** A phase that changes the interface has `visual_checks` on it: `name`, `path`, `widths` (375, 768, 1280) and `state` in words, at most 8 screens. A person approves them with the plan. Choose the screens the change can affect, including the error and empty states it touches.
2. **A script takes the pictures, not the model.** Chromium through the project's Playwright, with a fixed viewport, reduced motion, no animation, light colour scheme, English and UTC. The same app gives the same bytes, so a difference between two pictures is a difference in the app. Never edit, crop or draw on a picture.
3. **Before comes first.** Take "before" at the base commit, before touching code; take "after" when the change is done and its tests pass.
4. **Pictures live on the `evidence` branch**, never on main or the PR branch. They are linked by commit, so a link never moves.
5. **Say so when there is nothing to show.** A change that touches interface files and cannot be photographed writes `Not applicable: <reason>` under an Evidence heading. The reason is read by the reviewer.

## Steps

`project.config.json` needs `"preview": { "command": "npm run dev", "url": "http://localhost:3000" }` (`ready_path` and `timeout_s` are optional), and the project needs `npm install -D playwright` and `npx playwright install chromium`. `npm run verify` shows both under `project.preview` and `offline.evidence`.

```bash
# the approved plan, or a JSON list of screens, saved as visual-checks.json
npm run evidence:capture -- --label before        # at the base commit
# ... make the change, run its tests ...
npm run evidence:capture -- --label after
npm run evidence:publish -- --issue 12 --commit "$(git rev-parse HEAD)"    # needs the commit the PR will show
```

`evidence:publish` pushes the pictures to the `evidence` branch (a plain push, never forced) and writes `evidence/evidence.md`, an `## Evidence` section with a table of before, after and whether each screen changed. Paste it into the PR body and into a comment on the issue.

## What the factory checks

- `parsePlan` rejects a malformed `visual_checks` and shows the screens in the plan summary a person approves.
- `pr-text` finds interface files in the diff (components, pages, styles, `.tsx`, `.css`, `.html`, images under `public`; never the factory's own files, docs or tests). With no Evidence section holding pictures, or a stated reason, it is an error for R2 and R3 and a warning for R1.
- The reviewer is shown which screens changed; "unchanged" is stated, never hidden.

## What it does not check

Whether the change looks good. A picture proves what rendered, not that it serves the mission or follows `LOOKFEEL.md`; `/lookfeel-check` and a person decide that. Screens behind a login or seeded data need the app to start in that state, which is the project's `preview.command`.
