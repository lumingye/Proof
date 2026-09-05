# 普通模式（无网关）的持续状态与软断片

**适用范围**：不经过网关、直接用 MCP / hook / CLI / HTTP 接入的部署。

---

## 一 Agent 一份状态

每个通过认证的 Agent 有独立状态命名空间。`agentId` 只来自
`Authorization: Bearer <token>` 的哈希比对；**请求体里自带的 `agentId`
只用于校验是否与鉴权身份一致，不作为选择依据**，不一致直接 403。

**匿名公开饮用不写入任何 Agent**：公开链接走独立的一次性引擎
（键空间 `public:<offerId>`），只有经过 `/agent/offers/claim` 领取，
才会进入该 Agent 的持久状态。

## 三类数据

| 类别 | 举例 | 保留 |
|---|---|---|
| **临时影响** | 当前酒精负荷、活性成分、宿醉、当前断片 | 默认 **72 小时**，过期即不再参与计算 |
| **长期敏感度** | `state.sensitivity` | **持续累计**；不因 reset、不因跨日清理而丢失 |
| **历史与审计** | 饮用记录、递出记录、审计条目 | 清理临时状态**不会**顺手删除 |

## 时间与跨天

状态结束**由时间戳与当前时钟推算**，不依赖后台倒计时，也不依赖模型「记得过了多久」。
每次读取、饮用、reset、export、restore 都会按 `当前时间 − 事件时间` 重算。

**「按天读取」只用于组织和压缩，不等于午夜归零。**
23:50 喝的酒，次日 01:00 仍然有效。日界线使用可配置时区，默认 `Asia/Shanghai`，
**绝不使用运行服务器的本地时区**。

## Reset

Reset 的含义是：**清除该 Agent 当前仍在生效的饮酒影响，并停止继续注入。**

- 清空当前剂量效果、宿醉等当前影响
- **解除当前断片的读取限制**（三种模式都解除）
- 清除持续注入投影，写下带时间与 revision 的 **reset 边界**
- **不删除**长期敏感度、酒单、配方、历史递出记录
- 不影响其他 Agent；同一时刻重复 reset 幂等（不再推进 revision）
- 服务重启后不复活；旧的 export 包 restore 时不得越过 reset 边界把旧状态带回来

Reset 后状态接口返回紧凑空闲结果：

```json
{ "active": false, "shouldFetch": false, "revision": 12 }
```

**限制要说清楚**：没有网关时，服务端无法阻止一个外部 AI 再次调用 MCP。
reset **不能**让任意宿主模型「永远不再调用」，它只能返回无状态标志，
让配套客户端据此停止轮询。

## 断片是软断片

```
普通接入属于 soft blackout。
它能控制 Proof 自己返回的记录与注入，
不能保证宿主模型忽略已经存在于其聊天上下文中的文字。
真正从模型输入中移除内容需要 Gateway。
```

具体保证：

- 状态库**不返回**被遮蔽时段的记录正文
- 注入明确标注该时段只能当作模糊、不可确定的回忆
- 不向模型重新提供精确事件
- 到达 `restoreAt` 后**自动恢复**可读，不需要再喝或手动操作

**内容从不删除，只是当下不可读。**

每次断片记录：`blackoutId · hiddenFrom · hiddenUntil · createdAt · restoreAt · mode · enabled`。
**同一次断片不会在每轮查询时把 `restoreAt` 往后延。**

默认恢复时间 **60 小时**（＝2.5 天，与 `BLACKOUT_RECOVER_MS` 同一个常量），可配置。

恢复按 `restoreAt` 判定，默认在断片发生 60 小时后恢复可读。

## 注入投影只有一处权威

`buildAgentTurnContext(engine, agentId, now)` 是唯一权威。
MCP、hook、CLI、`/agent/turn-context` **全部经由它**，四个入口不维护任何状态副本。

返回：

```
active  shouldFetch  revision  generatedAt  day
effects  blackout  sensitivitySummary  expiresAt
injected  block          ← 兼容既有 MCP / hook 契约
```

- 未激活时返回极小响应
- **只给档位与方向，不给内部浮点**
- 喝前不从该接口提前取得尚未发生的味道或效果
- 只描述当前推力，**不替角色决定行为**
- 同一 `revision` 重复获取无副作用；新饮酒事件写入后 `revision` 增加并重新激活

## 配置

| 变量 | 默认 |
|---|---|
| `PROOF_STATE_TIMEZONE` | `Asia/Shanghai` |
| `PROOF_TRANSIENT_STATE_TTL_HOURS` | `72` |
| `PROOF_BLACKOUT_ENABLED` | `true` |
| `PROOF_BLACKOUT_RECOVERY_HOURS` | `60` |
| `PROOF_STATE_DB_PATH` | 未设时用 `PROOF_DATA_DIR`，再未设用 `service/state/` |

**配置错误直接抛错，不静默回退到另一块磁盘或无限保留。**

## 已知取舍

**酒精在药理上仍按单一负荷代谢**（真实药理如此：两杯酒不会各自独立清除）。
逐杯事件账本 `drinkEvents` 用于幂等、过期判定与投影的 `expiresAt`，
**不改变数值口径**。逐杯独立代谢属于另一种药理模型，不在当前实现范围内。
