---
title: "PostgreSQL 架构设计与 SSO 实践指南"
description: "打造企业级统一用户中心：PostgreSQL 架构设计与 SSO 漫游指南"
pubDate: 2026-04-02
author: "Qiseer"
tags: ["数据库", "postgresql","SSO"]
subject: "database"
image: "none"
---

> 从一张臃肿的 `user` 表，到支持多端登录、灵活扩展、SSO 通行证的现代化用户体系——本文带你一步步完成这场架构升级。

---

## 引言：那张"万能"单表的宿命

几乎每个项目初期都有一张相似的 `user` 表：用户名、密码、手机号、邮箱、QQ号、微信 OpenID，甚至"连续签到天数"，全都塞在一起。

这样做的代价，往往在业务发展后才暴露出来：

- 新增 GitHub 登录？改表结构。
- 接入 Apple 登录？又改一次。
- 为旗下多个子系统提供统一登录入口？束手无策。

**一张臃肿的单表，会成为你扩展路上最沉的技术债。**

本文将基于 PostgreSQL，从零设计一套**高扩展、易维护、支持单点登录（SSO）**的企业级用户中心，并给出可直接落地的 SQL 与架构思路。

---

## 第一部分：告别单表，走向垂直拆分

健壮的用户系统核心原则只有一个字：**解耦**。

我们将传统单表拆分为四个职责清晰的核心表：**核心表、授权表、资料表、状态表**。

### 1. 核心用户表 `users`：万物之源

这张表不存任何业务数据，只做一件事——**生成和维护全局唯一的用户 ID（UID）**。它是整个用户系统的"锚"。

PostgreSQL 内置的 `gen_random_uuid()` 生成的 UUID，天然防撞库、对分布式友好，是主键的最佳选择。

```sql
CREATE TABLE users (
    id         UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
    status     SMALLINT   NOT NULL DEFAULT 1,  -- 1=正常, 0=封禁, -1=注销
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  users    IS '用户核心表';
COMMENT ON COLUMN users.id IS '全局唯一 UUID（UID）';
```

### 2. 用户授权表 `user_auths`：登录方式的"插拔"枢纽

**这是整个设计中最关键的一步。**

无论是账号密码、邮箱、手机号，还是微信、QQ、GitHub，本质上都是一种**授权凭证**。将它们抽离为独立记录，就意味着：未来新增任何登录方式，只需插入一条新记录，**无需改动一行表结构**。

```sql
CREATE TABLE user_auths (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    identity_type VARCHAR(32)  NOT NULL,   -- 类型：password / email / phone / wechat / github 等
    identifier    VARCHAR(128) NOT NULL,   -- 标识：用户名 / 邮箱 / OpenID / 学号 等
    credential    TEXT,                    -- 凭证：bcrypt 哈希 / access_token 等
    is_verified   BOOLEAN      DEFAULT false,  -- 是否已验证（邮箱、手机等）
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 核心约束：同一登录类型下，标识必须全局唯一（不能有两个相同的邮箱）
    CONSTRAINT uk_type_identifier UNIQUE (identity_type, identifier)
);

CREATE INDEX idx_user_auths_user_id ON user_auths(user_id);
COMMENT ON TABLE user_auths IS '用户授权登录表';
```

> **💡 工作原理示例**：用户微信扫码时，查询 `identity_type = 'wechat'` 且 `identifier = 微信OpenID` 的记录，即可立即定位对应的 `user_id`，完成登录。整个过程无需修改任何表结构。

### 3. 用户资料表 `user_profiles`：展示信息的家

存放用户公开展示的基础信息，职责清晰，不与业务状态混用。

```sql
CREATE TABLE user_profiles (
    user_id    UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nickname   VARCHAR(64)  DEFAULT '默认昵称',
    stuid      VARCHAR(32)  UNIQUE,              -- 学号（校园场景）
    avatar_url VARCHAR(255),                      -- 头像链接
    extra_info JSONB        DEFAULT '{}'::jsonb,  -- 扩展字段（见第二部分）
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE user_profiles IS '用户基础资料表';
```

### 4. 用户状态与业务表 `user_stats`：保护核心性能

签到、积分、等级这类数据**每天都在高频变动**。若与核心用户数据混用一张表，频繁的 `UPDATE` 会引发锁竞争，拖累登录等核心链路的性能。单独建表，是必须的。

```sql
CREATE TABLE user_stats (
    user_id            UUID  PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    level              INT   NOT NULL DEFAULT 1,
    check_in_days      INT   NOT NULL DEFAULT 0,   -- 累计签到天数
    max_check_in_days  INT   NOT NULL DEFAULT 0,   -- 最大连续签到天数
    last_check_in_date DATE,                        -- 最后签到日期（用于判断是否断签）
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE user_stats IS '用户状态与高频业务表';
```

---

## 第二部分：面向未来的扩展方案

系统上线半年后，产品经理跑过来说："我们要加黑夜模式！还要做个皮肤商城！"

怎么改数据库最优雅？针对不同复杂度，有三种标准应对方案。

### 方案一：核心高频属性 → 直接加字段

对于**头像**这种几乎每个页面都会展示的高频属性，直接在 `user_profiles` 里加一列，是性能最优的方式。上述建表语句中已预留了 `avatar_url`，如有遗漏，随时补上即可：

```sql
ALTER TABLE user_profiles ADD COLUMN avatar_url VARCHAR(255);
```

### 方案二：低频零碎配置 → 善用 PostgreSQL 的 `JSONB`

如果"皮肤"只是一个简单的 UI 设置项（比如"主题色：暗黑"），为这点东西专门改表结构，代价太高。

得益于 PostgreSQL 对 JSON 的原生支持，可以直接利用预留的 `extra_info` 字段存储这类零碎配置：

```json
{
  "theme": "dark_mode",
  "profile_skin_color": "#FFC0CB",
  "signature": "这个人很懒，什么都没留下"
}
```

更强大的是，PostgreSQL 支持直接通过 SQL 检索 JSON 内部字段：

```sql
-- 查询所有使用暗黑模式的用户
SELECT user_id, nickname
FROM user_profiles
WHERE extra_info ->> 'theme' = 'dark_mode';
```

### 方案三：复杂业务资产 → 果断新建关联表

如果产品要的是一个**皮肤商城**——用户可购买皮肤、管理背包、随时切换——这已经是**一对多 / 多对多**的复杂业务关系，绝不能塞进 JSON。

按照正规流程建表：

| 表名                  | 职责                                         |
| --------------------- | -------------------------------------------- |
| `skins`               | 皮肤字典表，记录系统提供哪些皮肤             |
| `user_skin_inventory` | 用户库存表，记录谁拥有哪些皮肤及当前装备状态 |

---

## 第三部分：实现企业级 SSO 统一登录

有了这套数据库基础，如何让旗下的"论坛"、"商城"、"OA 系统"在同一个地方登录，登一次、全通？

这需要 **OAuth 2.0 协议 + OIDC（OpenID Connect）**。以下是最常用的**授权码模式（Authorization Code Flow）**的完整交互流程。

---

**五个核心步骤拆解：**

1. **重定向到统一通行证**：用户在论坛点击登录，论坛将其跳转至用户中心：
   ```
   https://passport.yoursite.com/authorize?client_id=bbs&redirect_uri=https://bbs.yoursite.com/callback
   ```

2. **在用户中心完成认证**：用户在 Passport 页面输入账号密码，此时操作的正是 `user_auths` 表。

3. **颁发一次性授权码（Code）**：验证成功后，用户中心生成短时效 `code`，重定向回论坛：
   ```
   https://bbs.yoursite.com/callback?code=abc12345
   ```

4. **后端安全换取 Token**：论坛的**后端服务器**（非浏览器）携带 `code` 与应用密钥，向用户中心请求 Access Token。这一步在服务端完成，对用户完全透明。

5. **获取用户信息并建立会话**：论坛后端持 Token 调用 `/api/userinfo`，获取 UUID 和昵称，在本地建立 Session，登录完成。

> **🎯 为什么不直接传密码？**
> 核心是**安全隔离**。子系统永远拿不到用户的真实密码，只持有用户中心颁发的"临时通行令"。一旦用户在中心修改密码或撤销授权，所有子系统的 Token 立即失效——权限管理完全收归中心，子系统无需关心认证细节。

---

## 结语

一个优秀的用户中心，需要两个支柱共同支撑：

**数据库侧**，通过垂直拆分实现关注点分离——核心表管身份、授权表管凭证、资料表管展示、状态表管业务，各司其职，互不干扰。PostgreSQL 的 UUID、JSONB、外键约束等特性，让这一切变得优雅而高效。

**协议侧**，拥抱 OAuth 2.0 / OIDC 等行业标准，是走向企业级架构的必经之路。标准协议意味着可互操作、可审计、可扩展，也意味着你不再需要重复发明轮子。

从单表到分层架构，从手搓登录到 SSO 通行证，每一步升级的背后，都是对**扩展性**与**可维护性**的深思熟虑。希望本文的设计思路，能为你的下一个系统提供一些参考。