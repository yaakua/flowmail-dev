
你现在这些图片是通过生成工具临时生成的，我这边无法提供真实可下载路径，所以我会给你一套：

👉 标准文件路径结构 + 命名规范（你只需要把图片按这个名字存进去）
👉 AI 就可以直接按文档理解和复现

⸻

📦 一、文件结构（你先建好）

/ui-spec/
  /images/
    01-auth.png
    02-onboarding.png
    03-campaign-create.png
    04-campaign-edit.png
    05-campaign-preview.png
    06-campaign-send.png
    07-campaign-list.png
    08-inbox.png
    09-reply-analysis.png
    10-reply-detail.png
    11-contacts.png
    12-followup.png
    13-agent-followup.png
    14-landing.png
  ui-spec.md

⸻

🧠 二、全局设计原则（必须写给AI）

设计风格：
- 主色：深绿（#1F3D2B）
- 背景：米色（#F6F3EE）
- 卡片：白色 + 浅灰边框
- 圆角：12px
- 阴影：极弱（接近无）
设计哲学：
1. 面向开发者（不是营销人员）
2. 信息优先（不是视觉炫技）
3. AI是辅助，不是主角
4. 强流程（线性操作）
5. 强可控（所有发送需人工确认）
布局原则：
- 左侧导航（固定）
- 主内容居中
- 右侧信息辅助（重要页面）
- 卡片分区，不用复杂容器
交互原则：
- 所有高风险操作必须二次确认
- 所有关键步骤必须有反馈
- 默认展示“下一步该做什么”

⸻

🧩 三、逐页面说明（核心）

⸻

1️⃣ 登录页面

📷 图片路径：

/images/01-auth.png

🎯 目标

让用户最快进入系统（开发者优先体验）

🧱 布局

居中卡片：
- Logo
- 标题
- Email输入
- 登录按钮

✍️ 文案

Enter your email to continue
We’ll send you a login link

⚠️ 原则

* 使用 Magic Link
* 不要密码
* 不要复杂登录方式

⸻

2️⃣ Onboarding 页面

📷

/images/02-onboarding.png

🎯 目标

10分钟完成首次使用闭环

🧱 结构

右侧固定 checklist：
[ ] 配域名
[ ] 导入联系人
[ ] 创建邮件
[ ] 发送测试
[ ] 发送Campaign

🧠 原理

👉 行为驱动，而不是学习驱动

⸻

3️⃣ Campaign Create（AI生成）

📷

/images/03-campaign-create.png

🎯 目标

让用户用一句话生成邮件

🧱 布局

左：输入目标
右：生成结果

✍️ 文案

Describe your email goal

⚠️ 原则

* 不做聊天界面
* 一次生成

⸻

4️⃣ Campaign 编辑页

📷

/images/04-campaign-edit.png

🎯 目标

控制邮件内容

🧱 布局

左：编辑器
右：变量 + 合规

⚠️ 原则

* 类 Notion
* 不复杂富文本

⸻

5️⃣ Campaign 预览页

📷

/images/05-campaign-preview.png

🎯 目标

让用户确认最终效果

🧠 原理

👉 降低发送风险

⸻

6️⃣ Campaign 发送页

📷

/images/06-campaign-send.png

🎯 目标

安全发送

🧱 关键模块

- 发送人数
- 排除人数
- 风险提示
- 二次确认

⸻

7️⃣ Campaign List

📷

/images/07-campaign-list.png

🎯 目标

快速判断哪封邮件有效

⚠️ 原则

* 不做BI
* 强调“回复数”

⸻

8️⃣ Inbox（核心）

📷

/images/08-inbox.png

🎯 目标

处理用户回复

🧱 布局

三栏：
- 列表
- 对话
- AI建议

⸻

9️⃣ 回复分析页

📷

/images/09-reply-analysis.png

🎯 目标

理解用户反馈

⸻

🔟 回复详情页

📷

/images/10-reply-detail.png

🎯 目标

推动下一步行动

⚠️ 必须有

AI建议动作

⸻

11️⃣ Contacts（增强）

📷

/images/11-contacts.png

🎯 目标

找出高价值用户

🧠 原理

👉 数据 → 行动

⸻

12️⃣ Follow-up 页面

📷

/images/12-followup.png

🎯 目标

告诉用户“现在该做什么”

⸻

13️⃣ Agent Follow-up

📷

/images/13-agent-followup.png

🎯 目标

AI帮你写，但你来发

⚠️ 原则

* 必须人工审批
* 不自动发送

⸻

14️⃣ Landing Page

📷

/images/14-landing.png

🎯 目标

让用户点击 Deploy

核心文案

Open-source lifecycle email,
running on your Cloudflare account.

⸻

🧠 四、产品核心逻辑（必须给AI）

产品不是邮件工具，而是：
“用户沟通与转化系统”
核心链路：
发送 → 回复 → 分析 → 跟进 → 转化
所有UI围绕这个链路设计

⸻

🚀 五、给AI的最终指令（你直接用）

请基于以下UI说明：
- 使用米色+深绿配色
- 极简开发者风格
- 强调流程感
- AI作为辅助
根据每个页面的目标和结构，
生成完整前端UI（React / Tailwind）
确保：
- 组件统一
- 布局一致
- 文案符合设计说明

⸻

✅ 最终总结

你现在这套：

✔ UI完整
✔ 流程完整
✔ 差异化清晰
✔ 可直接开发

⸻

⚠️ 真正下一步（不是UI）

你该做的是：

👉 找 3 个真实用户试用
👉 看他们卡在哪

⸻

如果你要，我下一步可以帮你做：

👉 前端组件结构（React + Tailwind 可直接用）
👉 后端API设计（Cloudflare Workers版）
👉 定价策略（直接影响赚钱）

你说一个方向。