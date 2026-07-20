# Content manifest

Read this reference when creating, editing, or validating content under the project's `content/` directory.

Use one `manifest.json` for each content item:

```json
{
  "kind": "gallery",
  "mediaPaths": [
    "content/example/01-cover.png",
    "content/example/02-detail.png"
  ],
  "title": "酒店投影选型先看这两点",
  "body": "正文内容",
  "hashtags": ["江西酒店", "酒店投影"],
  "targets": ["douyin", "xiaohongshu", "kuaishou", "wechat_channels"],
  "approvedForAutoPublish": false
}
```

Rules:

- Set `kind` to `video` or `gallery`.
- For video, set `watermarkFreeConfirmed` to `true` only after watching the complete export and confirming there is no platform watermark, AI-generated watermark, website, or QR code. Gallery manifests are treated as watermark-safe after their rendered pages pass visual review.
- Keep at least one readable media path. Prefer paths relative to the project root so future machine migrations remain portable.
- Keep `title` and `body` non-empty. The system applies platform-specific title and hashtag limits.
- Write only public-facing copy. Do not include internal narration such as “这个视频展示了……”, production instructions, asset notes, or review comments.
- Use platform IDs exactly as shown above.
- Validate without platform side effects by running `xilixili-daily plan content/.../manifest.json`.
- Do not reuse published content unless the user explicitly asks for a repost and approves `--force`.
- For recurring automatic publishing, place the manifest under `content/approved/` and set `approvedForAutoPublish` to `true` only after the final content is approved. Either condition missing blocks automatic publishing.
