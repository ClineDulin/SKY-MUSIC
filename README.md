# 光遇琴谱（SKY-MUSIC）

一个面向《光遇》（Sky: Children of the Light）玩家的乐谱资源浏览与分发网站。支持乐谱浏览、分类筛选、搜索、热门排序与投稿，并可安装为 PWA 在手机上离线使用。

## 在线访问

- 正式站点：https://clinedulin.github.io/SKY-MUSIC/

## 功能特性

- 乐谱浏览：卡片式展示，点击查看详情并跳转飞书文档
- 分类筛选：按「导入谱 / 图谱」分类
- 搜索：按标题或作者实时搜索
- 排序：热门优先 / 最近上传 / 字母排序
- 投稿入口：一键跳转飞书投稿问卷
- PWA：可安装到手机桌面，支持离线访问
- 浏览量统计：自动同步飞书知识库页面的浏览数据

## 数据来源

所有乐谱数据来自飞书多维表格（Bitable）「玩家投稿」表，由 GitHub Actions 每日自动同步生成 `scores.json`，网站静态读取该文件展示。管理员只需在飞书表格中维护数据，网站自动更新。

状态字段与分类的对应关系：

| 状态 | 分类 | 是否展示 |
|------|------|----------|
| S1 | 导入谱 | 是 |
| S2 | 图谱 | 是 |
| S3 | 待处理 | 否 |
| 异常/特殊 | — | 否 |

## 技术栈

- 前端：原生 HTML / CSS / JavaScript（零构建，无框架）
- PWA：Service Worker + Web App Manifest
- 数据同步：Node.js 脚本 + 飞书开放平台 API
- 部署：GitHub Pages + GitHub Actions

## 项目结构

```
.
├── index.html              # 页面结构
├── styles.css              # 样式
├── app.js                  # 前端逻辑（渲染、筛选、搜索、排序）
├── sw.js                   # Service Worker（离线缓存）
├── manifest.webmanifest    # PWA 清单
├── icon.svg                # 站点图标
├── scores.json             # 乐谱数据（同步脚本生成）
├── scripts/
│   └── sync.js             # 飞书数据同步脚本
├── .github/
│   └── workflows/
│       └── sync.yml        # 每日自动同步工作流
├── .env.example            # 环境变量模板
├── package.json            # npm 脚本
└── 运营SOP.md              # 运营操作手册
```

## 本地运行

需要 Node.js（>= 18）。

```bash
npm install -g http-server   # 或使用其他静态服务器
npm run serve                # 启动本地服务器，访问 http://localhost:8080
```

## 数据同步

### 自动同步

GitHub Actions 每天北京时间凌晨 0:00 自动运行同步脚本：

1. 从飞书多维表格读取乐谱记录
2. 调用飞书 API 拉取知识库页面浏览量（PV）
3. 写回「浏览次数」字段
4. 生成 `scores.json` 并提交回仓库

### 手动同步

在 GitHub 仓库 → Actions → 每日同步乐谱数据 → Run workflow。

### 环境变量（GitHub Secrets）

需要在仓库 Settings → Secrets → Actions 中配置：

| Secret 名 | 说明 |
|-----------|------|
| FEISHU_APP_ID | 飞书自建应用的 App ID |
| FEISHU_APP_SECRET | 飞书自建应用的 App Secret |
| FEISHU_BITABLE_APP_TOKEN | 多维表格 app_token |
| FEISHU_BITABLE_TABLE_ID | 多维表格 table_id |

配置模板见 `.env.example`。

### 飞书应用权限

自建应用需开通以下 API 权限，并添加为多维表格协作者：

- `bitable:app` — 多维表格读写
- `drive:drive:readonly` — 云文档只读
- `wiki:wiki:readonly` — 知识库只读

## 投稿乐谱

点击网站右上角「投稿乐谱」按钮，或直接访问飞书投稿问卷提交。

## 维护

本项目由 LightAndSky 维护，详细运营流程见 [运营SOP.md](./运营SOP.md)。

## 许可证

暂未指定开源许可证（UNLICENSED），保留所有权利。
