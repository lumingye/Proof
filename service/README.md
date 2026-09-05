# Proof service

Single-process transport for the Proof engine. Human mixing endpoints and Agent drinking endpoints are deliberately separate.

- Human: offer creation, emergency reset, and custom-menu save/rename/delete/change proposals under `/human/*`.
- Agent: authenticated home, offer view/drink/reject, public-link claim, own reset, and proposal accept/reject under `/agent/*`.
- Public drink links (`POST /human/offers`, no `targetId`): each offer settles in its own isolated one-shot engine. Anonymous drink responses are whitelisted to `projection` + `portableResult` (no host-only `stateInjection`). See the repository README for the two-mode contract.
- Agents claim public links into their own persistent engine via `POST /agent/offers/claim { "capabilityToken": "..." }` (agent bearer auth required; mutually exclusive with anonymous drinking).
- Each Agent owns a separate `ProofEngine`; offers and physiological state never share an engine instance.
- Intro/effect changes are applied only after the target Agent accepts the human-created proposal. Flavor and recipe are not editable through proposals.
- Credentials are stored only in root-readable `state/*.token` files (with a protected bootstrap record in `state/agents.json`); do not place them in URLs or browser code.
- Engine state is atomically persisted to `state/engine.json` (agents) plus `public:<offerId>` entries for isolated public-link results.
- State injection is **off by default**. Enabling it puts third-party mixer text into the drinker's model context (prompt-injection shaped). Toggle per agent: `POST /agent/injection` `{ "enabled": true }` or `POST /human/agents/:id/injection`. See the public README risk note.

Agent CLI example (the token itself is never printed):

```sh
PROOF_AGENT_ID=charb PROOF_AGENT_TOKEN_FILE=state/charb.token node agent-cli.mjs home
PROOF_AGENT_ID=charb PROOF_AGENT_TOKEN_FILE=state/charb.token node agent-cli.mjs claim CAPABILITY_TOKEN
```

## Agent registry（部署）

源码默认注册单个 generic Agent（`PROOF_AGENTS` 未设置时）：

```text
char : Char
```

任意部署通过 `PROOF_AGENTS` 配置任意 `N >= 1` 个 Agent（无需改代码）：

```text
# 多 Agent 示例（CharB/CharA/CharC 仅为通用 fixture）
PROOF_AGENTS=charb:CharB,chara:CharA,charc:CharC

# 其他部署例：单 Agent / 多 Agent
PROOF_AGENTS=agent:Agent
PROOF_AGENTS=alpha:Alpha,beta:Beta
```

身份、迁移、Gateway、引擎加载全部遍历该 registry；`charb/chara/charc`
名称仅作为测试 fixture 或部署配置出现，不进入领域逻辑。
