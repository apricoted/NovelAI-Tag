# tools 目录说明

这里放的是维护站点用的本地工具。它们不是前端运行时代码，主要用于转换法典、导入配图、同步 R2、检查 UI 和审计图片参数。

## 常用工具

| 文件 | 用途 | 默认是否改数据 |
| --- | --- | --- |
| `convert.py` | 把 `法典源/*.docx` 转成 `site/data/*.json`。支持 `--archive-sources` 在转换成功后归档源文件。 | 会改 JSON；带 `--archive-sources` 会移动源文件 |
| `import_excel_images.py` | 从 Excel 内嵌图片导入词条配图，生成缩略图和原图引用。 | 默认只预览；带 `--apply` 才写入 |
| `import_docx_codex.py` | 导入结构较特殊、带内嵌图片的 Word 法典。 | 默认只出报告；带 `--apply` 才写入 |
| `sync_r2.py` | 同步 `site/images/` 和 `originals/` 到 Cloudflare R2，并维护媒体配置。 | 默认会上传；`--dry-run` 只检查 |
| `preview_server.py` | 本地预览 `site/`，同时提供 `originals/` 原图缓存。 | 只读 |
| `verify_ui.py` | 启动浏览器做 UI 冒烟/回归检查。 | 只读，会写测试输出 |
| `sd_metadata_inspector.py` | 读取图片生成参数，并用原图参数审计法典 tag 覆盖率。 | 只读；审计会写 CSV 报告 |

## 辅助工具

| 文件 | 用途 | 默认是否改数据 |
| --- | --- | --- |
| `imgserver.py` + `pei.html` | `配图工具.bat` 背后的本地配图编辑器，默认端口 `8767`。 | 通过页面操作才会写入 |
| `strings_server.py` + `strings_editor.html` | 画师串/字符串编辑器，默认端口 `8768`。 | 通过页面操作才会写入 |
| `import_mengshen_pack.py` | 导入梦神整理图包。 | 默认只预览；带 `--apply` 才写入 |
| `__pycache__/` | Python 自动生成缓存。 | 可忽略 |

## sd_metadata_inspector.py

这个工具用于检查图片原始参数，尤其是“法典词条 tag 是否能在原图 prompt 中找到”。

示例：

```bat
python tools\sd_metadata_inspector.py inspect originals\suozhang\suozhang-0001.png --json
python tools\sd_metadata_inspector.py audit-codex --codex-id suozhang_r18 --max-coverage 0.35
```

目前支持的读取方式：

- PNG `tEXt` / `iTXt` / `zTXt`
- NovelAI `Description` / `Comment`
- NovelAI v4 `Comment.v4_prompt.caption`
- WebUI `parameters`
- JPG / WebP / AVIF 的 EXIF `UserComment`
- `stealth_pngcomp` 隐写参数：读取 alpha 通道最低位，识别 `stealth_pngcomp` magic，解 gzip JSON

`stealth_pngcomp` 是 Akegarasu/stable-diffusion-inspector 也支持的一类隐藏参数。它不在普通 PNG 文本块里，所以普通元数据读取会显示“没参数”，但 NovelAI 或 inspector 仍可能读得到。

## 安全建议

- 不确定时先跑 `--dry-run` 或不带 `--apply`。
- 跑 `sync_r2.py` 前确认 `r2_config.json` 存在且配置正确。
- 跑会写数据的工具前先看 `git status --short`，避免把自己的手工修改混进工具输出。
- 图片文件通常不进 git；上传到线上需要走 R2 同步流程。
