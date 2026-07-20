# Troubleshooting

## Service unavailable

Run `xilixili-service status`, then `xilixili-service start`. If it is not installed, work from the directory whose `package.json` name is `xilixili-publisher` and run `npm run system:install`. Inspect `.local/logs/service.err.log` without printing unrelated sensitive content.

## Account unavailable

Run `xilixili login <platform>` and let the user complete verification in Chrome. Then run `xilixili check <platform>`. Do not inspect the Chrome profile database or attempt to extract cookies.

## Missing media

Run `xilixili doctor`. Historical task paths are migrated automatically when matching files exist under the current project's `content/`, `tmp/`, `records/`, or `output/` directories. Create a new manifest or task when a source file was not copied to the new machine; do not rewrite a missing path to an unverified file.

## Prepare failure

Use `xilixili diagnose <platform>` only while the relevant creator page is open. Compare visible upload and editor controls with `src/platforms/config.ts`. Treat page-layout changes as adapter work and verify only the prepare phase before considering publishing.

## Ambiguous publish result

Do not retry automatically. Check the visible platform page and its content-management list. A `needs_verification` result means the system could not prove success, even if it clicked a button.

## Recurring slot skipped

Run `xilixili-weekly status`. Confirm that the approved queue contains an unused `manifest.json`, that it remains under `content/approved/`, and that `approvedForAutoPublish` is exactly `true`. A missing item must be reported rather than replaced with a draft or test asset.

## System removal

Run `xilixili-service uninstall` only on explicit request. It removes the LaunchAgent and installed commands while preserving `.local` account data, job state, and logs.
