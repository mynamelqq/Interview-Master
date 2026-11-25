# Interview Master

AI 技术面试知识库的首条垂直链路：注册登录与邮箱确认 → 输入专题标题 → 后台分阶段生成目录和知识点 → 保存为草稿 → 阅读、编辑和发布。页面适配桌面浏览器与 iPhone 浏览器。

## 本地启动

1. 在 Supabase 创建项目，打开 SQL Editor，按顺序执行 [`202611240001_init.sql`](supabase/migrations/202611240001_init.sql)、[`202611240002_default_categories.sql`](supabase/migrations/202611240002_default_categories.sql) 和 [`202611250001_point_activity.sql`](supabase/migrations/202611250001_point_activity.sql)。已有项目只需执行第三份迁移。迁移包含阅读行为表、原子批量写入函数与 RLS 用户隔离策略。
2. 复制 `.env.example` 为 `.env.local`，填写 Supabase Project URL、publishable/anon key，以及支持 OpenAI Chat Completions JSON mode 的 AI 服务地址、模型名和密钥。`AI_API_KEY` 只在服务端使用。
3. 运行 `npm install` 和 `npm run dev`，打开 `http://localhost:3000`。在 Supabase Auth 设置中配置邮件确认与站点 URL。

## 部署到 Vercel

在 Vercel 导入仓库并设置与 `.env.local` 相同的五个环境变量。先执行数据库迁移，再部署。生成接口创建任务后立即返回，Next.js `after()` 在响应后继续按目录和章节调用模型。它仍受部署平台的函数运行时长限制；当前路由配置为 300 秒，超过六分钟未完成的任务会在用户刷新任务状态时标记失败。将 `http://localhost:3000` 和正式域名加入 Supabase Auth URL 配置，确保确认邮件能返回正确地址。

## 当前范围

- 已实现：邮箱注册登录与邮件确认、已发布知识库列表、只收纳生成完成内容的草稿箱、手动创建、AI 后台分段生成、顶部任务入口与任务抽屉、失败任务重试、草稿阅读、Markdown 编辑、知识点卡片预览、检查后发布、响应式布局。失败和生成中的任务在任务中心处理；重试会清理失败任务留下的知识点并重新生成。
- AI 目录接受常见的 `sections` / `chapters` 与 `points` / `knowledge_points` 字段，不再按固定章节数量拒绝结果。校验失败时，任务的 `error_message` 指出具体字段，`raw_output.model_output` 保存模型原始返回，供排查。任务抽屉显示进度、失败重试和可展开的技术错误详情。
- 已建模并启用 RLS：分类、复习进度、复习记录、个人笔记和内容版本表。
- 知识点卡片先展示回忆提示，揭示后再展示按需组织的参考内容、示例、易错点与追问。四档掌握度分别安排 6 小时、1 天、3 天、7 天后的复习；评分后自动前进，可撤销上次评分。跳过不计分，稍后复习会移到本轮末尾。个人笔记独立保存。
- 首页按未读、较少接触和随机探索推荐知识点；「换一批」避开刚展示的内容。随便看看模式可无评分翻卡片，原有四档评分保留在「认真复习」。阅读知识点持续可见 8 秒后记为有效阅读，阅读秒数合并上报；知识库显示已浏览数量，不把阅读次数当成掌握度。
- 下一阶段：自定义分类管理、到期复习、版本恢复等交互。卡片模式已支持主动回忆和掌握度记录。

当前仓库没有 Supabase 项目凭据或 AI API Key，因此数据库迁移和真实生成链路需要在配置后验证。
