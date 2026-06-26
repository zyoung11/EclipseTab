# Monster Tab

> 基于 [Eclipse Tab](https://github.com/ENCRE0520/EclipseTab)

## 技术栈

| 技术 | 用途 |
|------|------|
| React 18 + TypeScript | 前端框架 |
| Vite 4 | 构建工具，esbuild 压缩 |
| CSS Modules | 样式方案 |
| colord | 颜色处理 |
| localStorage + IndexedDB | 数据持久化 |
| WebDAV | 云端同步协议 |

## 架构亮点

- **Feature-based 架构**：按功能模块（dock / shelf / spaces / sync / theme）组织代码
- **细粒度 Context 分离**：数据层、UI 层、操作层 Context 分离，减少不必要重渲染
- **懒加载**：Modal、FolderView 等非核心组件通过 `lazy` + `Suspense` 按需加载
- **RAF 节流**：鼠标悬停检测使用 `requestAnimationFrame` 限制更新频率
- **多级图标缓存**：内存 + IndexedDB 两级缓存，并发请求去重
- **Web Worker**：图片压缩在 Worker 线程执行，不阻塞主线程

## 修改记录

| 日期 | 改动 | 技术细节 |
|------|------|----------|
| 2026-06-26 | 移除原版发布签名文件及构建产物 | 删除 `dist.crx`（Chrome 签名扩展包）、`dist.pem`（私钥，安全风险）、`dist/`（构建产物，可重新生成）、`Author's Common Use.json`（原作者个人数据）。更新 `.gitignore` 防止误提交 |
| 2026-06-26 | 全面更名：Eclipse Tab → Monster Tab | 涉及 19 个文件：`manifest.json` 扩展元数据、`package.json` 项目名、所有 `localStorage` 键前缀（`EclipseTab_*` → `MonsterTab_*`）、IndexedDB 库名（`EclipseTabDB` → `MonsterTabDB`）、WebDAV 同步目录、导出/备份格式标识（`eclipse-space-export` → `monster-space-export`）等全部引用统一更新 |
| 2026-06-26 | 新标签页自动聚焦搜索框 | 在 `<input>` 上添加 `autoFocus` 原生 HTML 属性，配合已有的 `useEffect` `ref.focus()` 形成双重保障。`Searcher` 组件位于 `DockLayoutContainer` 中，非懒加载，页面打开即挂载 |
| 2026-06-26 | Tab 键切换搜索引擎 | 搜索框聚焦时按 Tab 弹出搜索引擎选择弹窗并切换到下一个引擎。弹窗位置使用引擎名元素 + 固定 80px 宽度保证稳定。选中样式改为背景高亮。750ms 无操作自动关闭，动画时长 150ms。关闭动画期间按 Tab 会被忽略（300ms 保护期）。选择引擎后自动聚焦回搜索框 |

## 数据存储

所有数据存储在本地浏览器中，不上传至任何服务器：

| 存储位置 | 内容 |
|---------|------|
| `localStorage` | 配置、空间、Dock 图标、贴纸元数据、搜索引擎设置（`MonsterTab_*` 前缀） |
| IndexedDB | 壁纸图片、贴纸图片、图标缓存（`MonsterTabDB` 库） |
