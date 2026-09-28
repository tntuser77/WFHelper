# Upstream sync

`.github/workflows/upstream-sync.yml` checks [WFHelper/WFHelper](https://github.com/WFHelper/WFHelper) every Monday at 14:00 UTC. When upstream `main` has commits this fork's `main` does not, it:

1. force-pushes upstream `main` to the `sync/upstream` branch,
2. opens (or refreshes) one PR, `sync/upstream` -> `main`, labelled `upstream-sync`,
3. lists the new upstream commits in the PR, and flags any files that conflict (label `sync-conflicts`).

It never merges anything. You review, let CI run, and merge.

## One-time setup

### 1. Create a token

The default Actions token cannot push commits that change `.github/workflows/`, and PRs it opens do not start CI, so the workflow needs a personal token.

1. GitHub -> your avatar -> **Settings** -> **Developer settings** -> **Personal access tokens** -> **Fine-grained tokens** -> **Generate new token**.
2. **Token name:** `WFHelper upstream sync`. **Expiration:** 1 year (set a reminder to renew it).
3. **Resource owner:** `tntuser77`. **Repository access:** *Only select repositories* -> `tntuser77/WFHelper`.
4. **Repository permissions** (leave everything else at *No access*):
   - **Contents:** Read and write
   - **Pull requests:** Read and write
   - **Issues:** Read and write (for the labels)
   - **Workflows:** Read and write
5. **Generate token** and copy it. GitHub only shows it once.

### 2. Save it as a repo secret

1. `https://github.com/tntuser77/WFHelper/settings/secrets/actions` -> **New repository secret**.
2. **Name:** `UPSTREAM_SYNC_TOKEN`. **Secret:** the token. **Add secret**.

### 3. Get the workflow onto `main`

Scheduled and manual workflows only run from the default branch, so merge the PR that adds this file.

### 4. First run

**Actions** tab -> **Upstream sync** (left list) -> **Run workflow** -> **Run workflow**. After about 30 seconds a PR titled *Upstream sync: N new commit(s) from WFHelper/WFHelper* appears. From then on it runs by itself every Monday.

## Each week

- **No PR / nothing new:** nothing to do.
- **PR, green check "Merges cleanly":** wait for CI, then **Merge pull request** using **Create a merge commit**. Do not squash or rebase: that rewrites upstream's history in your fork, and every later sync conflicts again.
- **PR labelled `sync-conflicts`:** see below.

After merging, update your local copy and optionally your feature branches:

```sh
git switch main
git pull
git switch my-feature-branch
git merge main
```

## Fixing conflicts

The PR body lists the conflicting files. In your WFHelper folder:

```sh
git fetch origin
git switch -C sync/upstream origin/sync/upstream
git merge origin/main
```

Git stops and marks each conflict in the files with `<<<<<<<`, `=======`, `>>>>>>>`. For each file, keep what both sides need (VS Code shows *Accept Current / Incoming / Both* buttons above each conflict). Because the branch you are on is upstream's code, *Current* / top half is upstream and *Incoming* / bottom half is your `main`. Then:

```sh
git add <each fixed file>
git commit --no-edit
git push origin sync/upstream
```

The push runs the full pre-push check (about 15 minutes). Once it is pushed, the PR updates, CI runs on the merged result, and you merge it as above.

Common spots in this fork:

- `src/i18n/*.json`: usually both sides added keys. Keep both sets, and watch the commas.
- `preload.ts`, `src/types/ipc.ts`, `src/types/preload.ts`, `src/lib/ipc.ts`: both sides added IPC channels. Keep both.
- `*.png` snapshots: take upstream's (`git checkout --ours <file>`; "ours" is upstream here), then re-run the visual test if your change affects that screen.

While the branch has your fix commits on it, the weekly run leaves it alone (you will see a warning on the run) so it never overwrites your work. Once the PR is merged, the next run picks up anything newer.

## Troubleshooting

- **Run fails with "UPSTREAM_SYNC_TOKEN secret is not set":** redo setup step 2. The name must match exactly.
- **Run fails with `403` or "refusing to allow ... workflow":** the token is missing a permission from step 1, or it expired. Edit or regenerate it and update the secret.
- **No CI on the PR:** the PR was opened with the wrong token. Close it and re-run the workflow.
- **Change the day or time:** edit the `cron` line in the workflow (UTC; [crontab.guru](https://crontab.guru) helps).
