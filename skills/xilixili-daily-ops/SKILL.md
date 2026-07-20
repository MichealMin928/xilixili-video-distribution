---
name: xilixili-daily-ops
description: Create content and operate the local Xilixili four-platform publishing system. Use when Codex needs to build or revise hotel-projector articles and platform copy, manage content evidence and approval, diagnose a migrated installation, verify Douyin/Xiaohongshu/Kuaishou/WeChat Channels accounts, plan or prepare daily content, manage the approved auto-publishing queue, explicitly publish, or perform a user-requested one-time read-only interaction check.
---

# Xilixili Daily Ops

Operate the local publishing system through its installed commands. Keep account verification manual, and submit content only within explicit approval or the standing approved queue.

## Establish system readiness

1. Run `xilixili-service status`.
2. Start the service with `xilixili-service start` when it is installed but stopped.
3. Run `xilixili doctor` and report every warning or error.
4. Use the project fallback only when the system commands are unavailable. Work from the directory whose `package.json` name is `xilixili-publisher`:

```bash
npm run doctor
```

Install or restart the system service only when the user's request includes setup, repair, or system installation. Uninstall it only after an explicit uninstall request.

## Initialize accounts

Run `xilixili setup` to open all four creator platforms in the dedicated Chrome profile. Tell the user to complete QR code, SMS, CAPTCHA, or security verification directly in Chrome. Do not request, read, or print credentials, cookies, tokens, or files under `.local/chrome-profile/`.

After the user finishes, run `xilixili check all`. Treat only `logged_in` as ready. Keep `logged_out`, `unknown`, and `needs_verification` as manual-action states.

This installation uses the normal Douyin creator account. Do not open, require, or report the enterprise lead edition as a dependency.

## Inspect comments, messages, and organic inquiries

Use the read-only engagement commands:

```bash
xilixili-engagement status
xilixili-engagement scan [all|douyin,xiaohongshu,kuaishou,wechat_channels]
```

- Comments, comment replies, and private messages belong to the user to inspect and answer. Do not run `status` or `scan` during content preparation, scheduling, publishing, routine operations, or recurring tasks.
- Run `status` or `scan` only when the user explicitly asks Codex in the current conversation to check interactions. Treat that as one-time read-only permission, not standing authorization. Report new high- and medium-priority items first, then every `manual_required`, `logged_out`, `needs_verification`, or `failed` surface.
- Treat the first scan as a baseline, but still surface older visible high-intent items as possible missed leads.
- Never interpret an unavailable web inbox as zero messages. Xiaohongshu and Kuaishou private messages may require their mobile apps; WeChat Channels interaction management may require account certification.
- Do not reply, delete comments, export contacts, send lead forms, or click contact details. The user has chosen to handle all interaction responses personally.
- Keep `.local/engagement.json` and `output/engagement/` local. Do not print cookies, tokens, phone numbers beyond what the user explicitly asks to review, or files under `.local/chrome-profile/`.

## Plan and prepare content

Read [references/content-production.md](references/content-production.md) before creating, revising, or evaluating an article, gallery, four-platform copy set, or content queue. Assign a content ID, preserve evidence and claim boundaries, create native platform cards, render and inspect the gallery, and keep new manifests unapproved by default.

Use the least consequential command that satisfies the request:

```bash
xilixili-daily status
xilixili-daily plan [content/.../manifest.json]
xilixili-daily start [content/.../manifest.json]
```

- Use `status` to inspect today's jobs.
- Use `plan` for validation and scheduling without opening platform pages.
- Use `start` only when the user asks to prepare, prefill, start, or run today's content workflow. It checks all target accounts, creates or reuses the daily job, uploads media, fills copy, and stops before publishing.
- Use `--force` only when the user explicitly requests a deliberate repost after the duplicate warning is explained.
- Read [references/manifest.md](references/manifest.md) before creating or editing a content manifest.
- Read [references/platform-publishing.md](references/platform-publishing.md) before preparing or scheduling a four-platform gallery.

## Publish safely

Publish only after the user explicitly names or approves the task and target platform. Never infer permission to publish from a request to plan, prepare, review, open, or check.

1. Run `xilixili-daily status`.
2. Verify that the platform is in the task, has a successful prepare result, and has not already been submitted.
3. Prefer the platform's native scheduler and run one platform at a time:

```bash
xilixili-daily schedule <job-id> <douyin|xiaohongshu|kuaishou|wechat_channels>
```

When the user approves all four platforms, run the four `schedule` commands in the same session. The platform-selected time must be on the workflow date and more than five minutes in the future. Do not create one-time Codex tasks to click later, and do not stay online until the publish time.

Use immediate publishing only when the user explicitly requests an immediate release and the planned time has arrived:

```bash
xilixili-daily publish <job-id> <douyin|xiaohongshu|kuaishou|wechat_channels>
```

Report `needs_verification` as unresolved even if the publish button was clicked. Do not retry a publish automatically because a retry can create duplicates.
Apply the tag, music, native-time, and success-marker rules in [references/platform-publishing.md](references/platform-publishing.md).

## Manage the weekly schedule

Use `xilixili-weekly status` to inspect the Tuesday/Friday schedule and approved queue. At 18:30 China Standard Time, the recurring task prepares the approved item and immediately submits all four platform-native schedules. The platforms publish later at the valid times they return; no separate at-time Codex task is used.

Treat `content/approved/` as the only automatic publishing boundary. Require each eligible `manifest.json` to contain `"approvedForAutoPublish": true`. Removing the field or setting it to `false` revokes authorization immediately.

Use only these restricted commands inside recurring tasks:

```bash
xilixili-weekly prepare
xilixili-daily schedule <job-id> <platform>
```

Do not use the general immediate publish command, use `--force`, generate replacement content, or retry an ambiguous submit. An empty approved queue means skip the slot and report the missing content.

## Recover failures

Read [references/troubleshooting.md](references/troubleshooting.md) when diagnostics fail, media is missing, an engagement surface becomes unavailable, a selector no longer matches, or a publish result is ambiguous. Preserve `.local/state.json`, `.local/engagement.json`, `.local/chrome-profile/`, content, screenshots, and logs unless the user explicitly requests their removal.
