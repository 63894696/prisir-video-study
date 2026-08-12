# Prisir 视频学习

> 在任何能播的 HTML5 视频上,**一键同时开两件事**:双语字幕(纯翻译)+ AI 帧笔记(多模态,带时间戳)。
> 不依赖任何平台的字幕接口,也不需要逐站适配。密钥仅存本机。

Chrome MV3 扩展。与 [Prisir 翻译](https://github.com/63894696/custom-hover-translate) 同源互补——翻译插件管整页,本插件专管视频学习场景。

---

## 为什么是「双模」

HoverNotes 开笔记模式就**看不到字幕**;我们把两条管线并行,笔记和外语字幕**同屏**:

```
            <video>(任何 HTML5 视频)
                │
   ┌────────────┴────────────┐
   │                         │
字幕轨(CT_SUBTITLES)      帧笔记(CT_VNOTES)
纯翻译提示词               笔记提示词(结构化)
   │                         │
通用 TextTrack             定时 canvas 抽帧
cuechange → 双语 overlay   → dataURL(jpeg)
   │                         │
   └──── 翻译引擎(背景)─────┴── 多模态引擎(背景 vision-note)
        translate-batch            image_url 消息
```

## 核心特性

- **统一入口**:悬停视频 → 右上角浮出「✎ 视频学习」按钮(HoverNotes 同款触发)→ 一键开双模
- **双语字幕**:YouTube(timedtext)+ 通用 HTML5 TextTrack 兜底;`cuechange` 驱动双语 overlay
- **AI 帧笔记**:定时抽帧 → 多模态 → 右侧笔记面板。HoverNotes 风格结构化输出:`### 分段标题` + bullet 要点 + **加粗关键词** + 术语中英对照
- **状态交通灯**:面板头 + 悬浮按钮双灯同步。灰=待机 / 黄(脉动)=接指令·请求在飞 / 绿=工作 / 红=出错。网络延迟一眼看懂卡在哪
- **内容感知去重(省 token)**:32×32 采样 + RGB 三通道均差 ≥ 8 才发请求。静止帧自动跳过(`已省 N 次`),相同内容不重复发、不重复记
- **时间戳跳转 + Markdown 导出**:点笔记时间戳跳回该帧;导出带 YAML frontmatter(`tags: hover-notes`)的 `.md`
- **手动截图**:📷 把当前帧(板书/图示)钉进笔记

## 安装(开发者模式)

1. `chrome://extensions` → 打开「开发者模式」
2. 「加载已解压的扩展程序」→ 选 `extension/` 目录
3. 打开任意视频页,悬停视频,点「✎ 视频学习」

## 配置

帧笔记需要**多模态(能看图)**的 OpenAI 兼容端点。点扩展图标 → 端点配置:

| 项 | 说明 |
|---|---|
| API Base URL | 如 `https://apihub.agnes-ai.com/v1` |
| 模型名 | 字幕翻译用 |
| 多模态模型 | 帧笔记用(留空复用上面),如 `agnes-2.5-flash` / `kimi-k2.5` / `MiniMax-M3` |
| API Key | 仅存 `chrome.storage.local`,不上传 |

实测可用的多模态端点见 [docs/video-study.md](docs/video-study.md)。

## 隐私红线

- 帧图仅经**用户自己配置**的端点,不经过任何我们的服务器
- 抽帧在页面内存完成,**不落盘**;笔记存于页面,导出由用户主动触发
- 密钥存于浏览器 `chrome.storage.local`,不上传
- `fetch-text` 代取仅白名单 `youtube.com/api/timedtext`,不作通用代理

## 技术文档

完整架构、状态机、去重算法、多模态接入、E2E 验证:[docs/video-study.md](docs/video-study.md)

## 仓库关系

- [custom-hover-translate](https://github.com/63894696/custom-hover-translate) — 整页翻译(同源,引擎/提示词/字幕轨共用)
- **prisir-video-study(本仓)** — 视频学习场景独立产品,聚焦双模笔记体验

## License

[MIT](LICENSE)
