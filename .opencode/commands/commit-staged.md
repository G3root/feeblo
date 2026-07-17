---
description: git commit staged
model: opencode/deepseek-v4-flash-free
---

commit staged

write the commit message in conventional commit format (e.g. feat:, fix:, chore:, refactor:, docs:, style:, test:, perf:, ci:, build:, revert:).

prefer to explain WHY something was done from an end user perspective instead of
WHAT was done.

do not do generic messages like "improved agent experience" be very specific
about what user facing changes were made

if there are conflicts DO NOT FIX THEM. notify me and I will fix them

## GIT DIFF

!`git diff`

## GIT DIFF --cached

!`git diff --cached`

## GIT STATUS --short

!`git status --short`

after reviewing all changes, craft a conventional commit message and stage all
files, then commit using: `git commit -m <message>`