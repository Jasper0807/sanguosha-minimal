# 极简三国杀网页版（Sanguosha Minimal Web）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Jasper0807/sanguosha-minimal)

一款**零美术负担、高操作效率、严格对齐三国杀 OL 现行规则**的极简网页版三国杀，支持**单机人机 AI** 与**房间链接线上实时 PvP**，完整内置 **161 张军争牌堆**与 **89 位三国杀 OL 武将**。

---

## 核心特性

- **161 张完整牌堆**：标准 104 + EX 4 + 军争篇 52 + ♦5 木牛流马 1；完整实现铁索连环 OL 3.0 传导、火攻、酒、藤甲、白银狮子、古锭刀、朱雀羽扇、丈八蛇矛、寒冰剑、无懈可击嵌套反制与快捷跳过。
- **89 位三国杀 OL 武将**（逐一核对官网文案，存档于 [rules-checklist.md](./docs/rules-checklist.md)）：
  - **标准包（27 位）**：魏 7 / 蜀 7 / 吴 8 / 群 5 + 3 主公技（护驾、激将、救援）。
  - **界限突破·标准包（30 位）**：全部 27 界将 + 李典、界徐庶、界公孙瓒，涵盖觉醒技、限定技、额外回合、回合外用牌、印牌与技能封印。
  - **神话再临·风林火山（32 位）**：风 8 / 火 8 / 林 8 / 山 8，完整实现拼点、翻面、场上移牌、蛊惑质疑与缠怨、天香转移、不屈“创”、屯田“田”、左慈化身/新生等高复杂度机制。
- **三大经典模式**：
  - **1v1（纯单挑）**：无主公技、无先手修正，纯粹单挑。
  - **2v2（欢乐成双）**：1/4 号位 vs 2/3 号位、1 号位首回合摸 1、队友阵亡摸 1、队友手牌明牌可见。
  - **五人身份场**：1 主 1 忠 2 反 1 内、主公血上限 +1、杀反摸 3、主公杀忠弃光手牌装备、明置主公技与暗置身份推理 AI。
- **房间链接线上实时 PvP**：
  - 一键创建 6 位房间码与 `?room=XXXXXX` 邀请链接；
  - 权威服务端运行同构 `@sgs/engine`，按玩家视角严格裁剪隐藏手牌与暗置身份（防作弊）；
  - 支持房主自由增删 AI 补位、实时回合倒计时与超时自动托管、断线重连 Token、实时聊天抽屉与轮到你音效提示。
- **确定性引擎与复盘录像**：
  - 同步生成器状态机 + 可注入 `SeededRng`；
  - 支持 `GameEngine.replay(config, actionLog)` 100% 确定性重放与 JSON 战局导出。
- **极简高效交互**：
  - 纯文字/几何色块卡片，支持亮/暗双主题、自由选将检索/势力/扩展包筛选、`田/创/谦逊/化身` 专属状态角标与完整快捷键。

---

## Monorepo 目录结构

```text
sanguosha-minimal/
├── packages/
│   ├── engine/          # 纯 TypeScript 规则引擎（零 DOM 依赖，前后端同构）
│   │   ├── src/
│   │   │   ├── core/    # 状态机、触发时机管道、修正器、距离、视角裁剪、拼点/移牌原语
│   │   │   ├── data/    # 161 张卡牌数据 + 89 位 OL 武将定义
│   │   │   ├── skills/  # standard / limitBreak / expansion 技能注册表
│   │   │   ├── modes/   # 1v1 / 2v2 / identity5 规则与胜负判定
│   │   │   └── ai/      # 零作弊公开信息身份推理与全 89 将规则 AI
│   │   └── tests/       # Phase 0 → Phase 6 单元测试与 500 局全池压测
│   ├── web/             # React 18 + Vite 6 + Tailwind CSS + Zustand 极简前端
│   └── server/          # Node.js + ws 线上实时 PvP 权威房间服务（同源托管前端）
├── docs/
│   ├── rules-checklist.md   # 161 张牌堆与全部 89 位 OL 武将核对基准
│   └── online-pvp-spec.md   # 线上房间链接 PvP 协议与防作弊架构设计
├── Dockerfile           # 一键构建前后端同源生产镜像
├── render.yaml          # Render 免费/标准云部署配置（Blueprint 一键部署）
├── railway.json         # Railway 云部署配置
└── fly.toml             # Fly.io 云部署配置
```

---

## 本地开发与运行

> 环境要求：Node.js 20+、`pnpm` 9+

```bash
# 安装依赖
pnpm install

# 1) 启动单机模式前端（Vite 开发服务器）
pnpm dev

# 2) 同时启动线上 PvP 权威服务端（WebSocket /ws + 房间 API）
pnpm server:dev
```

### 生产构建与一体化启动

```bash
# 全量类型检查、测试与构建
pnpm typecheck
pnpm test
pnpm build

# 启动一体化生产服务（同源托管 Web 静态资源 + WebSocket /ws）
PORT=8787 pnpm server:start
```

---

## 自动化测试与 500 局全池压测

```bash
# 运行全部引擎 + 服务端测试（含 Phase 0–6 与 500 局全 89 将 AI 压测）
pnpm test

# 仅运行 500 局全 89 将 + 161 牌堆 AI 压力测试
pnpm --filter @sgs/engine exec vitest run tests/phase6.stress.test.ts

# 查看规则引擎覆盖率报告
pnpm test:coverage
```

---

## 云端一键部署（邀请好友联机）

仓库已预置 **Docker / Render / Railway / Fly.io** 零配置部署模板，单容器同时提供 HTTPS 前端页面与同源 `wss://.../ws` 联机服务：

```bash
# Docker 本地或任意 VPS 部署
docker build -t sanguosha-minimal .
docker run -d -p 8787:8787 --name sgs sanguosha-minimal
```

部署完成后直接打开服务地址，点击「创建线上房间」并将生成的 `?room=XXXXXX` 链接发给好友即可实时开黑。

---

## 快捷键速查

| 按键 | 功能 |
| ---- | ---- |
| `1` ~ `9` | 快速选中手牌 / 快捷选择技能弹窗选项 |
| `双击手牌` | 直接打出无需指定目标的卡牌（桃、无中、装备等） |
| `Enter` | 确认出牌 / 确认响应 |
| `Esc` | 取消当前选中 / 放弃可选响应 |
| `Space` | 结束出牌阶段 |
| `右键 / 点击 i` | 查看卡牌完整三国杀 OL 规则说明 |
