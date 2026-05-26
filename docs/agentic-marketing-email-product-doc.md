# OpenAgent Email 产品与技术文档

版本：v0.2  
日期：2026-04-25  
作者：Codex  
适用阶段：开源立项、MVP 范围确认、Cloudflare 一键部署方案评审

> 本文将原方案从“多租户 SaaS 营销邮件平台”调整为“开源、Cloudflare-native、自托管、可一键部署的 agentic lifecycle email stack”。核心判断：第一版不复制 Mailchimp、Customer.io、Mautic 或 listmonk，而是服务已经在 Cloudflare 上管理域名和产品基础设施的开发者、小 SaaS 团队与独立开发者。

参考：

- Cloudflare Email Service: https://developers.cloudflare.com/email-service/
- Cloudflare Deploy to Cloudflare: https://developers.cloudflare.com/workers/ci-cd/builds/deploy-to-cloudflare/
- Cloudflare Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Cloudflare Email Service limits: https://developers.cloudflare.com/email-service/platform/limits/
- FTC CAN-SPAM Guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- Cloudflare agentic-inbox: https://github.com/cloudflare/agentic-inbox

## 1. 产品定位

### 1.1 一句话

OpenAgent Email 是一个开源的 Cloudflare-native lifecycle email 平台：开发者一键部署到自己的 Cloudflare 账号后，可以用自己的域名发送合规产品邮件，追踪点击、退订和回复，并让 Agent 基于产品知识库生成回复草稿。

### 1.2 第一屏价值主张

> Open-source lifecycle email for SaaS founders, powered by your own Cloudflare account.

用户部署后 10 分钟内应该完成：

1. 绑定一个 Cloudflare zone 和发送域名。
2. 导入一份 CSV 联系人名单。
3. 让 Agent 生成一封激活邮件。
4. 审批后限速发送。
5. 看到点击、退订和用户回复。
6. 对用户回复生成 AI 草稿。

### 1.3 为什么先做开源

邮件增长工具有三个天然信任问题：

1. 联系人名单敏感。
2. 发信权限高风险。
3. Agent 能生成和发送邮件，一旦越权就是事故。

开源能把阻力降下来。用户可以自己部署、自己审计、自己保管 Cloudflare 权限和数据。项目的传播路径也更自然：GitHub、Cloudflare 社区、self-hosted 社区、indie hacker 和开发者内容。

### 1.4 不是做什么

第一版不是：

- 开源 Mailchimp。
- 完整 marketing automation suite。
- 多租户 SaaS 控制面。
- 高吞吐群发基础设施。
- CRM 替代品。
- BI 平台。
- 冷邮件滥发工具。

第一版只做一个具体场景：

> 给 SaaS 产品的未激活用户发一封合规 lifecycle email，追踪点击和退订，收集用户回复，并让 Agent 生成回复草稿。

这就是主线。

## 2. 目标用户

### 2.1 首要用户：SaaS founder / indie hacker

特征：

- 有一个正在运营的 SaaS、工具站或开源项目。
- 域名已经在 Cloudflare 上。
- 现在用手工脚本、Resend、Loops、Mailchimp、Customer.io 或没有系统地发 lifecycle email。
- 不想把用户名单、回复和发信权限完全交给闭源平台。
- 愿意部署开源项目，能处理基本配置。

他们最痛的不是“缺一个营销平台”，而是：

- 产品有用户，但激活邮件、回访邮件、功能发布邮件做得很散。
- 用户回复后没有结构化 inbox。
- 不知道哪封邮件真的带来点击或回复。
- 不想维护一套完整邮件基础设施。
- 想用 AI 生成内容和回复，但不想让 Agent 绕过人工审批。

### 2.2 次要用户：开源项目维护者

场景：

- 给 star 用户、newsletter 订阅者、beta tester 或 contributor 发项目更新。
- 收集回复和反馈。
- 基于 README、docs、release notes 生成回复草稿。

### 2.3 次要用户：小型 agency / product studio

场景：

- 为多个客户产品部署独立实例。
- 每个客户数据放在自己的 Cloudflare 账号里。
- 后续需要 managed hosting 或多实例管理。

### 2.4 暂不服务的用户

- 大型企业营销团队。
- 需要复杂 journey automation 的增长团队。
- 高吞吐 newsletter 发送方。
- 冷邮件销售团队。
- 需要成熟 CRM 深度集成的客户。

这些用户会把产品拉向平台化。太早。

## 3. 核心差异化

### 3.1 与 Mailchimp / Customer.io 的差异

Mailchimp 和 Customer.io 是成熟 SaaS。它们强在可视化 workflow、模板生态、CRM 集成、企业能力。

OpenAgent Email 不在这些方向硬碰。差异是：

- 自托管在自己的 Cloudflare 账号。
- 开源可审计。
- 发信、收信、追踪和 Agent 回复草稿在同一个 Cloudflare-native 栈里。
- 面向开发者和 SaaS founder，而不是传统营销组织。

### 3.2 与 listmonk / Mautic 的差异

listmonk 和 Mautic 是成熟开源营销工具。

OpenAgent Email 不追求完整营销自动化，而是更窄：

- Cloudflare-native 部署，不需要用户维护传统服务器。
- 默认支持入站回复和 reply intelligence。
- Agent 工作流是一等公民，但高风险动作必须人工确认。
- 更适合产品生命周期邮件，而不是大规模 newsletter 或传统营销漏斗。

### 3.3 与 Cloudflare agentic-inbox 的关系

Cloudflare agentic-inbox 是自托管邮箱客户端和 AI inbox 参考实现。

可复用方向：

- Email Sending / Email Routing 的使用方式。
- 邮箱线程 UI 思路。
- Agent 草稿生成流程。
- prompt injection 防护思路。
- MCP tools 结构。

OpenAgent Email 不应直接改造成 agentic-inbox 的 fork。推荐作为独立项目，复用思想和局部代码，新增 lifecycle email domain：

- contacts
- campaigns
- templates
- unsubscribe
- tracking
- reply attribution
- compliance guardrails

## 4. 产品原则

### 4.1 自托管优先

开源 core 默认跑在用户自己的 Cloudflare account 中。

不保存客户 Cloudflare token 到第三方平台。第一版没有 SaaS 控制面，也不做跨客户管理。

### 4.2 单实例单组织

第一版部署后就是一个组织的邮件增长栈。

支持多个 product 可以进入 P1，但不做多租户 RBAC。多租户是商业版和 managed cloud 的事情。

### 4.3 人工审批发送

Agent 可以生成 Campaign、模板、回复草稿和分析建议。

Agent 不可以未经确认直接批量发送邮件。发送 Campaign、删除数据、批量退订、自动回复高风险问题必须人工审批。

### 4.4 合规默认开启

营销邮件必须包含：

- 清晰发件身份。
- 退订链接。
- 组织联系信息。
- 联系人来源或同意状态。
- suppression list 检查。

产品默认拒绝：

- 购买名单。
- 无来源名单。
- 欺骗性主题。
- 规避限制。
- 批量冷邮件滥发。

### 4.5 极窄第一版

第一版要能被一个开发者在周末做出来，能被一个真实 SaaS founder 下周使用。

如果一个功能不能服务“未激活用户激活邮件 + 点击/退订/回复 + Agent 草稿”这条主线，就不进 MVP。

## 5. 一键部署体验

### 5.1 部署目标

用户从 GitHub README 点击 Deploy to Cloudflare 后，应进入 Cloudflare 的部署流程。

目标体验：

1. 用户点击 README 中的 Deploy to Cloudflare 按钮。
2. Cloudflare 读取公开仓库和 Wrangler 配置。
3. 用户选择 Cloudflare account。
4. Cloudflare 自动创建或绑定所需资源。
5. 用户填写必要 secrets。
6. 构建和部署完成。
7. 用户打开部署后的 setup wizard。
8. setup wizard 检查 Email Service、Routing、D1、R2、Queues 等状态。
9. 用户完成发送域名配置。
10. 进入产品。

### 5.2 推荐部署方式

#### 方式 A：Deploy to Cloudflare

用于大多数用户。

README 提供按钮：

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/{owner}/{repo})
```

仓库需要包含：

- `wrangler.jsonc` 或 `wrangler.toml`
- Workers app 代码
- D1 migrations
- 资源 binding 配置
- setup wizard
- post-deploy checklist

Cloudflare Workers Builds 当前支持从仓库配置中识别并 provision 常见资源，包括 D1、R2、KV、Durable Objects、Queues、Vectorize、Hyperdrive、Secrets Store 等。最终支持范围以 Cloudflare 当前文档为准。

#### 方式 B：Wrangler CLI

用于高级用户和贡献者。

流程：

```bash
git clone https://github.com/{owner}/openagent-email
cd openagent-email
pnpm install
pnpm db:migrate
pnpm deploy
```

#### 方式 C：Fork + GitHub Actions

用于想长期维护自己 fork 的用户。

流程：

1. fork 仓库。
2. 配置 Cloudflare API token 到 GitHub Actions secrets。
3. push 到 main 自动 deploy。
4. 每次升级通过 upstream merge 或 release tag。

### 5.3 部署前置要求

用户需要：

- Cloudflare account。
- 一个在 Cloudflare 管理的域名或子域名。
- 可用的 Cloudflare Email Service。
- 允许 Workers、D1、R2、Queues、Durable Objects 等资源。
- 一个 AI provider API key，或使用 Cloudflare Workers AI。

注意：

- Cloudflare Email Service 仍可能有 beta 限制、账号级发送限制和计划要求。
- setup wizard 必须检测实际账号能力，而不是假设所有账号都可用。
- 如果账号不可用，UI 应明确提示缺什么和下一步。

### 5.4 Setup Wizard

部署完成后第一屏不是 dashboard，而是 setup wizard。

步骤：

1. 检查 bindings：D1、R2、Queues、Durable Objects、Email Service。
2. 初始化数据库 migration。
3. 创建第一个 product。
4. 选择发送域名或子域名。
5. 检查 DNS、SPF、DKIM、DMARC、bounce domain。
6. 配置 from name 和 from email。
7. 配置组织联系信息和退订页。
8. 发送测试邮件。
9. 导入测试联系人。
10. 创建第一封 lifecycle email。

## 6. 产品功能

### 6.1 Product

第一版只需要一个 product。

字段：

- product name
- product URL
- default from name
- default from email
- sending domain
- reply-to address
- brand voice
- support docs URL
- organization address

P1 可支持多个 product。

### 6.2 Contacts

MVP 支持 CSV 导入。

字段：

- email
- first_name
- last_name
- company
- source
- consent_status
- consent_source
- tags
- custom_fields_json
- unsubscribed_at
- bounced_at

导入流程：

1. 上传 CSV。
2. 字段映射。
3. 邮箱格式校验。
4. 去重。
5. suppression list 检查。
6. 导入报告。

暂不做：

- 动态 segment。
- CRM 双向同步。
- 大文件复杂清洗。
- 联系人评分。

### 6.3 Templates

MVP 支持：

- AI 生成 subject。
- AI 生成 HTML + plain text。
- 变量：`{{first_name}}`、`{{company}}`、`{{unsubscribe_url}}`。
- 预览真实联系人渲染结果。
- 合规检查。

暂不做：

- 模板 marketplace。
- 可视化拖拽编辑器。
- 多品牌模板系统。
- 复杂 A/B 版本管理。

### 6.4 Campaign

MVP 只做 one-off campaign。

流程：

1. 用户选择联系人列表。
2. 用户输入目标，例如“给 30 天未激活用户发激活邮件”。
3. Agent 生成 Campaign 草稿。
4. 用户编辑 subject 和 body。
5. 系统插入退订链接和追踪链接。
6. 系统预估发送数量和时长。
7. 合规检查。
8. 用户审批。
9. Queue 限速发送。
10. 报表显示发送、点击、退订、回复。

暂不做：

- 多步骤 journey。
- visual automation builder。
- send-time optimization。
- A/B testing。
- 多渠道消息。

### 6.5 Tracking

点击追踪：

```text
GET /click/:token
  -> verify token
  -> write click event
  -> redirect original URL
```

退订：

```text
GET /unsubscribe/:token
  -> show confirmation page
POST /unsubscribe/:token
  -> create suppression
  -> write unsubscribe event
```

打开追踪：

MVP 可选，默认不作为核心指标。

原因：

- Apple Mail Privacy Protection 和安全扫描会污染打开率。
- 点击、回复、退订更可靠。

### 6.6 Reply Inbox

入站回复是差异化核心。

流程：

1. 用户回复邮件。
2. Cloudflare Email Routing 送到 Inbound Worker。
3. 系统解析 headers、thread、reply token。
4. 关联 contact、campaign、product。
5. 存储 inbound message。
6. 分类为 unsubscribe、support_question、sales_intent、complaint、privacy_request、auto_reply 或 unknown。
7. Agent 生成草稿。
8. 用户审批后发送。

MVP 必须支持：

- 回复列表。
- 回复详情。
- 分类标签。
- Agent 草稿。
- 人工发送。
- 一键退订。

### 6.7 Agent

Agent 能力：

- 生成 lifecycle email。
- 改写 subject 和 body。
- 解释 Campaign 表现。
- 分类用户回复。
- 基于产品知识库生成回复草稿。
- 建议下一封邮件。

工具分级：

- Read-only：查询 contacts、campaigns、events、inbound messages。
- Draft：生成模板、生成回复草稿。
- Low-risk write：保存草稿、创建联系人列表。
- High-risk write：发送 campaign、发送回复、删除联系人、批量退订。

规则：

- High-risk write 必须人工确认。
- Agent 不能绕过 suppression list。
- Agent 不能使用未验证域名。
- Agent 不能向无来源联系人直接发送。
- 入站邮件和网页内容进入 Agent 前必须做 prompt injection 防护。

## 7. 技术架构

### 7.1 总体架构

```text
Browser
  |
  v
OpenAgent Email Worker
  |
  +-- Setup Wizard
  +-- Auth / Admin Session
  +-- Product API
  +-- Contact API
  +-- Campaign API
  +-- Inbox API
  +-- Agent API
  |
  +-- D1: relational data
  +-- R2: uploads, raw inbound emails, knowledge files
  +-- Queues: send jobs, event ingestion, analytics sync
  +-- Durable Objects: campaign coordinator, agent sessions
  +-- Analytics Engine: high-volume click/open events, optional
  +-- Vectorize: product knowledge search, optional
  +-- Email Service: outbound sending
  +-- Email Routing: inbound replies
```

### 7.2 资源建议

MVP 必需：

- Workers
- D1
- Queues
- Durable Objects
- R2
- Email Service
- Email Routing

MVP 可选：

- Analytics Engine
- Vectorize
- Workers AI
- Secrets Store

### 7.3 单实例数据模型

#### products

- id
- name
- url
- default_from_name
- default_from_email
- sending_domain
- reply_to_email
- brand_voice
- organization_address
- created_at
- updated_at

#### contacts

- id
- email
- first_name
- last_name
- company
- source
- consent_status
- consent_source
- tags_json
- custom_fields_json
- unsubscribed_at
- bounced_at
- created_at
- updated_at

#### contact_imports

- id
- filename
- status
- total_rows
- imported_count
- skipped_count
- error_count
- report_json
- created_at

#### suppressions

- id
- email
- reason
- source
- campaign_id
- created_at

#### templates

- id
- name
- type
- subject
- html_body
- text_body
- variables_json
- compliance_status
- created_at
- updated_at

#### campaigns

- id
- name
- status
- goal
- template_id
- audience_filter_json
- scheduled_at
- started_at
- completed_at
- approved_at
- created_at
- updated_at

#### campaign_recipients

- id
- campaign_id
- contact_id
- email
- status
- message_id
- sent_at
- failed_at
- failure_reason
- unsubscribed_at

#### tracking_links

- id
- campaign_id
- original_url
- normalized_url
- label
- created_at

#### email_events

- id
- campaign_id
- recipient_id
- contact_id
- event_type
- event_time
- metadata_json

#### inbound_messages

- id
- campaign_id
- contact_id
- sender
- subject
- body_text
- body_html_ref
- raw_email_ref
- thread_key
- classification
- created_at

#### agent_actions

- id
- action_type
- input_json
- output_json
- status
- approved_at
- created_at

### 7.4 发送链路

```text
Campaign approved
  -> CampaignCoordinator creates recipient jobs
  -> Queue receives send jobs
  -> Send Worker renders template
  -> Check suppression and consent
  -> Rewrite links
  -> Insert unsubscribe URL
  -> Call Cloudflare Email Service
  -> Save message id
  -> Write sent event
```

幂等策略：

- `campaign_recipient_id` 只能成功发送一次。
- retry 前检查 recipient status。
- API timeout 后不能盲目重发，必须标记 uncertain 并进入 reconciliation。

失败策略：

- 临时失败进入 retry。
- 永久失败写入 failure reason。
- hard bounce 写入 suppression。
- 超过重试进入 dead letter。

### 7.5 入站链路

```text
Email Routing
  -> Inbound Worker
  -> Parse email
  -> Resolve reply token / thread key
  -> Store raw email in R2
  -> Store message metadata in D1
  -> Classify reply
  -> Generate Agent draft
  -> Human review
```

安全注意：

- HTML 邮件必须 sanitize。
- 附件默认不让 Agent 直接读取。
- 入站内容可能包含 prompt injection。
- 自动回复默认关闭。

### 7.6 知识库

MVP 支持三种来源：

- 手动粘贴产品说明。
- 上传 Markdown。
- 输入 docs URL 后抓取静态页面。

存储：

- R2 存原文。
- D1 存元数据。
- Vectorize 可选，用于 embedding 检索。

P0 可以不用 Vectorize，先用短文档全文上下文。不要为了 RAG 把 MVP 拖重。

## 8. 安全与合规

### 8.1 权限

开源 core 第一版是单组织部署。

最小权限：

- 只允许部署者或管理员访问后台。
- 发送前必须审批。
- 删除联系人必须确认。
- secrets 不落入 D1。

### 8.2 合规检查

发送前检查：

- 发送域名 ready。
- from email 属于授权域名。
- 模板包含 unsubscribe URL。
- 模板包含组织身份信息。
- 联系人未退订。
- 联系人不在 suppression list。
- 联系人有来源字段。
- campaign 没有明显欺骗性主题。

### 8.3 风控

MVP 风控：

- 默认低速发送。
- 新部署实例每日发送上限可配置。
- 失败率异常暂停 campaign。
- 退订率异常暂停 campaign。
- Cloudflare 返回限制错误时暂停 queue。

暂不承诺：

- 完整 deliverability consulting。
- 自动 warm-up 万能方案。
- 投诉处理自动化。

### 8.4 隐私

原则：

- IP 默认哈希或不保存。
- 原始邮件存 R2，可配置保留期。
- 删除联系人时删除或匿名化相关 PII。
- 导出数据应包含 contacts、campaign events、suppressions。

## 9. 开源项目结构建议

```text
openagent-email/
  README.md
  LICENSE
  CONTRIBUTING.md
  SECURITY.md
  wrangler.jsonc
  package.json
  apps/
    web/
      src/
        worker/
        ui/
        routes/
        components/
  packages/
    email-core/
    agent-tools/
    compliance/
  migrations/
  docs/
    deploy.md
    cloudflare-email-service.md
    security.md
    architecture.md
```

README 第一屏必须回答：

1. 这是什么。
2. 谁应该部署。
3. 10 分钟后能做什么。
4. 为什么不用 Mailchimp/listmonk/Mautic。
5. 如何 Deploy to Cloudflare。
6. 当前限制。

## 10. 开源治理与发布

### 10.1 License 建议

推荐第一版使用 Apache-2.0。

原因：

- 对开发者和公司采用友好。
- 明确专利授权。
- 更适合基础设施类项目。
- 有利于 Cloudflare 生态传播。

不建议第一版使用 AGPL。

AGPL 能防止别人直接拿去做闭源托管版，但也会显著降低企业和开发者采用意愿。早期最重要的是让人部署、试用、提 issue、提 PR。先要活下来。

如果后续商业化压力变大，可以考虑：

- Apache-2.0 core。
- Enterprise features 放在商业仓库。
- Managed cloud 收托管费。
- 商标和品牌控制。

### 10.2 Repo 必备文件

必须有：

- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `docs/deploy.md`
- `docs/troubleshooting.md`
- `docs/architecture.md`
- `docs/compliance.md`

### 10.3 Release 策略

版本建议：

- `v0.1.0`: 一键部署 + 单 product + 测试邮件。
- `v0.2.0`: CSV contacts + campaign send + unsubscribe + click tracking。
- `v0.3.0`: reply inbox + Agent draft。
- `v0.4.0`: 多 product + export + webhook。

每个 release 必须包含：

- migration 说明。
- Cloudflare resource 变更。
- breaking changes。
- upgrade steps。
- known limitations。

### 10.4 贡献边界

接受贡献：

- Cloudflare 部署稳定性。
- Email provider adapter。
- compliance checks。
- reply parser。
- setup wizard。
- docs。
- examples。

谨慎接受：

- 大型 UI 重构。
- 多租户。
- CRM 集成。
- 复杂 automation builder。
- 高级 BI。

这些功能容易把项目拖回“开源 Mailchimp”。需要先证明用户真的在用主线。

### 10.5 安全披露

`SECURITY.md` 必须明确：

- 如何报告安全问题。
- 不要公开提交包含 token、联系人名单或真实邮件内容的 issue。
- Agent prompt injection 和发信越权属于安全问题。
- XSS、HTML 邮件解析、unsubscribe token 泄露、R2 原始邮件访问都属于高优先级。

## 11. MVP 范围

### 11.1 v0.1 必须做

- Deploy to Cloudflare 按钮。
- setup wizard。
- 单 product 配置。
- 发送域名检查。
- CSV contacts 导入。
- suppression list。
- AI 生成一封 lifecycle email。
- 手动编辑模板。
- 人工审批发送。
- Queue 限速发送。
- 点击追踪。
- 退订链接和退订页。
- Reply Inbox。
- Agent 回复草稿。
- 基础 campaign 报表。
- 文档：部署、限制、安全、合规。

### 11.2 v0.1 明确不做

- 多租户 SaaS。
- 团队 RBAC。
- A/B testing。
- journey automation。
- CRM 集成。
- Stripe/PostHog/Segment 集成。
- 完整 BI。
- marketplace。
- 企业 SSO。
- 自动 warm-up。
- 自动批量回复。

### 11.3 v0.2

- 多 product。
- 简单 segment。
- webhook。
- 数据导出。
- Vectorize 知识库。
- 更完整 analytics。
- template versioning。
- GitHub Actions 部署模板。

### 11.4 v0.3

- A/B testing。
- warm-up assistant。
- deliverability dashboard。
- PostHog / Stripe / Segment integration。
- MCP server。
- managed cloud beta。

## 12. 商业化路线

开源 core 免费。

可商业化方向：

### 12.1 Managed Cloud

面向不想自己维护部署的人。

收费点：

- 托管部署。
- 自动升级。
- 更长日志保留。
- 备份。
- SLA。

### 12.2 Team / Multi-product

收费点：

- 团队权限。
- 多产品管理。
- 多域名健康监控。
- 审计日志。

### 12.3 Deliverability & Compliance

收费点：

- 发送健康报告。
- 风险阈值建议。
- suppression 管理。
- 合规扫描。

### 12.4 Agency Console

面向 product studio 和 agency。

收费点：

- 管理多个客户实例。
- 版本升级编排。
- 统一健康看板。
- 客户隔离。

不要第一天做商业版。先让开源 core 有人部署。

## 13. 成功指标

### 13.1 开源指标

- GitHub stars。
- deploy button 点击数。
- successful deploy 数。
- issue 中真实使用反馈数。
- 外部 PR 数。
- Discord/社区活跃用户数。

### 13.2 产品激活指标

- 部署完成率。
- setup wizard 完成率。
- 发送域名 ready 率。
- 首个 CSV 导入成功率。
- 首封测试邮件成功率。
- 首个 campaign 发送成功率。

### 13.3 使用指标

- 每实例 campaign 数。
- 每实例发送量。
- click event 数。
- reply event 数。
- Agent 草稿采纳率。
- 退订处理成功率。

### 13.4 商业信号

- 用户主动要求 managed hosting。
- 用户主动要求多产品和团队权限。
- agency 想为客户批量部署。
- 企业用户要求安全审计或 SLA。

## 14. 风险与应对

### 14.1 Cloudflare Email Service beta 风险

风险：API、限制、计费和可用性可能变化。

应对：

- 封装 EmailProvider adapter。
- 文档明确 beta 风险。
- setup wizard 检测实际可用性。
- 保留未来接入 Resend、Postmark、SES 的接口。

### 14.2 Deploy to Cloudflare 资源创建不稳定

风险：不同账号权限、计划和区域导致资源 provision 失败。

应对：

- README 提供 Wrangler fallback。
- setup wizard 提供明确错误信息。
- `docs/troubleshooting.md` 收集常见部署失败。

### 14.3 被滥用于垃圾邮件

风险：开源项目可能被用于低质量群发。

应对：

- 产品定位明确不支持 spam。
- 默认低速发送。
- 强制退订。
- 强制 suppression。
- 文档写明合规边界。
- 不提供绕过 Cloudflare 限制的功能。

### 14.4 与成熟开源工具比较

风险：用户问为什么不用 listmonk 或 Mautic。

回答：

- 如果你需要成熟 newsletter 或完整 marketing automation，用 listmonk/Mautic。
- 如果你想在 Cloudflare 上自托管 lifecycle email、收集回复并使用 Agent 草稿，OpenAgent Email 更贴近。

### 14.5 Agent 风险

风险：Agent 生成错误内容或执行错误动作。

应对：

- 默认 draft-only。
- 高风险动作人工审批。
- 工具调用审计。
- prompt injection 防护。
- 回复草稿展示引用来源。

## 15. 推荐执行路线

### Phase 0：开源验证，1 周

目标：证明 Cloudflare 一键部署主链路可跑。

任务：

- 建立 GitHub repo。
- 写 README 第一屏。
- 配置 Deploy to Cloudflare。
- 部署最小 Worker。
- provision D1 / R2 / Queue。
- setup wizard 检测资源。
- 发送测试邮件。

成功标准：

- 新用户从 README 点击 deploy，10 分钟内进入 setup wizard。
- 至少 3 个外部用户完成部署。

### Phase 1：Lifecycle Email MVP，2-3 周

目标：跑通第一封产品激活邮件。

任务：

- product setup。
- CSV contacts。
- AI template draft。
- approval。
- queue sending。
- click tracking。
- unsubscribe。
- basic report。

成功标准：

- 至少 3 个真实 SaaS/工具项目用它发送第一封 lifecycle email。
- 至少 1 个用户愿意继续用第二次。

### Phase 2：Reply Intelligence，2 周

目标：把回复变成差异化。

任务：

- Email Routing inbound。
- reply attribution。
- reply inbox。
- classification。
- Agent draft reply。
- one-click unsubscribe from reply。

成功标准：

- 用户能看到“哪些邮件带来了真实回复”。
- Agent 草稿采纳率超过 30%。

### Phase 3：开源增长，持续

目标：让项目自己传播。

任务：

- 示例 demo video。
- Cloudflare community post。
- listmonk/Mautic comparison doc。
- self-hosting guide。
- example lifecycle campaigns。
- public roadmap。

成功标准：

- GitHub star 持续增长。
- 有外部 issue 和 PR。
- 有用户主动请求 managed cloud。

## 16. 第一版产品边界

第一版只做：

> 一个开发者把 OpenAgent Email 一键部署到自己的 Cloudflare 账号，配置一个产品域名，导入一份名单，让 Agent 生成一封合规 lifecycle email，审批后限速发送，并在同一个界面看到点击、退订、回复和 Agent 回复草稿。

其他都不要。

这是开源项目能活下来的最小主线。

如果这条主线不能让真实用户部署和复用，继续扩展多租户、BI、journey、CRM 都是形式主义。
