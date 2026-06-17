# daily-notes

个人学习笔记与日常实用小脚本，仅供自用。内容随时更新，未必完整。

## 内容

- 学习笔记（前端、Node.js、自动化等）
- 一些日常使用的小脚本与定时任务

## 说明

本仓库主要作个人记录与备份用途。脚本所需的地址与令牌通过运行环境变量传入，
不写在代码里。

## 运行

```bash
npm install
npx playwright install chromium
SOURCE_URL=... SINK_URL=... SINK_TOKEN=... npm run sync
```
