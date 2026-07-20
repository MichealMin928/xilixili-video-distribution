# Four-platform gallery rules

Apply these rules to Xilixili hotel-projector gallery posts.

## Tags

Keep commercial relevance ahead of broad traffic. Order base tags so truncation preserves the strongest terms:

1. `酒店投影`
2. `江西酒店`
3. The post's buyer-intent term, such as `宾馆经营` or `酒店筹建`
4. The post's problem term, such as `投射距离`
5. The supporting design or product term

Use these preferred counts unless the platform rejects one:

| Platform | Count | Format |
| --- | ---: | --- |
| Douyin | 5 | `#标签` |
| Xiaohongshu | 5 | `#标签#` |
| Kuaishou | 4 | `#标签` |
| WeChat Channels | 3 | `#标签` |

Do not pad with unrelated trending tags. If a platform rejects a tag, remove only that tag and keep the remaining order.

## Music

- For Kuaishou galleries, prefer `秋恋（钢琴版纯音乐）`.
- If it is unavailable, use a calm instrumental result returned by the `轻音乐` search. Avoid vocals, sentimental breakup songs, aggressive rhythms, and unrelated trending audio.
- Treat music as unresolved if the approved track cannot be visibly selected. Stop before publishing and report the manual check.
- Close the music drawer after selection and verify that it no longer blocks the publish button.
- Preserve an already approved WeChat Channels track. Do not replace it during scheduling unless the user asks.
- Do not force music on Xiaohongshu. Do not add unapproved music on Douyin.

## Native scheduling

- Prefer each platform's built-in scheduling control. After the user approves the task and platforms, choose the valid same-day time and submit the native schedule during the same working session.
- Use `xilixili-daily schedule <job-id> <platform>`. Run all approved platforms one by one; do not create a later Codex wake-up or stay online until the publish time.
- Accept only a time more than five minutes in the future and on the workflow date. Douyin currently enforces at least two hours and up to fourteen days.
- Treat the task as submitted only after an explicit success state, a content/works-management redirect, or Xiaohongshu's `published=true` marker.
- Record the time selected by the platform. Never retry an ambiguous submit because it can create a duplicate.
- Use `xilixili-daily publish` only for an explicitly requested immediate release.

## Final check

Before each platform submit:

1. Verify the intended tag count in the filled copy.
2. Verify the cover is the first image and all pages are present.
3. Verify approved music: Kuaishou instrumental and any already approved WeChat Channels track.
4. Verify the native scheduled time is valid and belongs to the workflow date.
5. Submit only the named platform and record the result before moving to the next platform.
