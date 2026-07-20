# 自动发布批准队列

每条可自动发布的内容放在独立子目录，并命名为 `manifest.json`。只有同时满足下列条件才会进入每周任务：

1. 清单位于 `content/approved/` 下。
2. 清单包含 `"approvedForAutoPublish": true`。
3. 素材文件可读，且该内容从未发布。

移除字段或改为 `false` 即可立即撤销自动发布授权。
