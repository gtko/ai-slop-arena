# Working on AI SLOP ARENA

Instructions for coding agents. Talk to the user in French; code, commits and docs stay in English.

## Workflow: commit, PR, review, merge, release

Every change goes through these five steps, in this order.

1. **Commit** after each step of the work, so the user can roll back any of them. Work on a branch
   (worktree branches are fine), never directly on `main`. Stage paths explicitly (`git add <files>`),
   never `git add -A`: other sessions may be working in the repo at the same time, and their files
   (untracked art, `steam/store/`, `.claude/launch.json`...) must not end up in your commits.
2. **PR**: rebase the branch on `origin/main` (`git fetch origin && git rebase origin/main`), run
   `npm test`, `npm run build` and `npx vite build --mode app`, push the branch and open a pull
   request to `main` with `gh pr create`: what changed, why, what was tested and what was not.
3. **Review**: review the PR diff (`/code-review` on the PR, or a reviewer agent) and fix what it
   finds with new commits on the branch; re-run the tests after the fixes.
4. **Merge** into `main` once the review is clean and the checks pass (`gh pr merge`, keeping the
   commit history: one commit per step is the point). Never force-push `main`.
5. **Release**: from the up-to-date `main`, follow `.claude/skills/release/SKILL.md` (tests, version
   bump, graphic notes, Cloudflare deploy, tag, GitHub release with every platform build, check).

Stop and tell the user when a step fails instead of pushing on.

## Useful commands

```bash
npm test                     # headless server rules, ranking, the 30 locales
npm run build                # site + game (dist/) and the server bundle
npx vite build --mode app    # mobile web bundle (dist-app/)
npm run dev                  # dev server (the browser pane: .claude/launch.json "brawl-arena")
```

Art pipeline (reference images, local 3D, portraits, promo media): `art-src/ai3d/README.md`.
