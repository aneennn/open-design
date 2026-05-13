# Agent Runtime 统一抽象现状

## 结论

当前代码中已经有统一的 **agent runtime 定义抽象**，主要用于描述 agent 的元数据、CLI 参数构造、模型发现、bin 解析和协议类型；但还没有完整的 **AgentRuntime 执行抽象**。daemon 的 run 主流程仍然直接感知不同 runtime 的协议族，并在 `server.ts` 中按 `streamFormat` 分支接入不同 parser/session handler。

## 已有统一抽象

核心类型是 `RuntimeAgentDef`：

- 位置：`apps/daemon/src/runtimes/types.ts`
- 作用：统一描述一个 agent runtime 的静态能力和启动方式
- 主要字段：
  - `id`
  - `name`
  - `bin`
  - `versionArgs`
  - `fallbackModels`
  - `buildArgs`
  - `streamFormat`
  - `eventParser`
  - `promptViaStdin`
  - `listModels`
  - `fetchModels`
  - `reasoningOptions`
  - `fallbackBins`

每个 agent 的定义放在：

```txt
apps/daemon/src/runtimes/defs/*.ts
```

注册入口在：

```txt
apps/daemon/src/runtimes/registry.ts
```

相关通用能力包括：

- `apps/daemon/src/runtimes/detection.ts`：统一 agent detection
- `apps/daemon/src/runtimes/executables.ts`：统一 bin resolution，包括 `CODEX_BIN`、`OPENCODE_BIN` 等 override
- `apps/daemon/src/runtimes/env.ts`：统一 spawn env 组装
- `apps/daemon/src/runtimes/launch.ts`：统一 launch path/env 处理

这一层已经把“某个 agent 的 bin 名称、参数、模型发现、fallback bin、协议声明”等差异集中到了 runtime definition 体系里。

## 尚未完全收敛的部分

daemon 的执行主流程仍然在 `apps/daemon/src/server.ts` 中直接处理不同协议族。

当前主流程大致是：

```txt
agentId
  -> getAgentDef(agentId)
  -> resolveAgentLaunch(def, configuredEnv)
  -> def.buildArgs(...)
  -> spawn(...)
  -> 根据 def.streamFormat 接不同 parser/session handler
  -> 输出 daemon SSE / run state / artifact persistence
```

`server.ts` 中仍然显式感知这些协议类型：

- `claude-stream-json`
- `qoder-stream-json`
- `copilot-stream-json`
- `pi-rpc`
- `acp-json-rpc`
- `json-event-stream`
- plain stdout

例如 Codex 和 OpenCode 都使用 `json-event-stream`，再通过 `eventParser` 区分具体 parser；Claude、Qoder、Copilot、Pi、ACP 则仍由 `server.ts` 分支选择对应 handler。

因此当前架构已经降低了上层对“具体 agent”的感知，但上层仍然感知“具体协议族”。

## fake agent harness 的位置

e2e 的 fake agent harness 位于：

```txt
e2e/lib/fake-agents.ts
e2e/lib/playwright/fake-agents.ts
```

它通过 `createFakeAgentRuntimes()` 在临时目录里生成假的 CLI 脚本，例如：

```txt
/tmp/open-design-fake-agents-<pid>/codex-e2e.js
```

测试再通过 daemon config 注入 bin override：

```ts
agentCliEnv: {
  codex: {
    CODEX_BIN: '/tmp/.../codex-e2e.js',
  },
}
```

这个 fake CLI 会输出真实 runtime 的 stdout 协议形状，使 daemon 继续走真实的 bin resolution、spawn、stdout parser、run state、artifact persistence 和 UI preview 链路。

所以它是协议级 mock：mock 掉外部 agent CLI 进程本身，保留 daemon 内部真实执行路径。

## 架构判断

当前状态可以概括为：

```txt
已有：RuntimeAgentDef 统一定义抽象
已有：runtime defs / detection / executable resolution 的集中管理
已有：parser/session handler 模块
缺少：AgentRuntime.run() 级别的统一执行抽象
仍暴露：server.ts 对 streamFormat / protocol handler 的分支感知
```

更完整的抽象可以是：

```ts
interface AgentRuntime {
  detect(input: AgentDetectInput): Promise<DetectedAgent>;
  run(input: AgentRunInput): AsyncIterable<NormalizedAgentEvent>;
}
```

这样 daemon 主流程可以只依赖 normalized event stream：

```ts
const runtime = agentRuntimeRegistry.get(agentId);
for await (const event of runtime.run(input)) {
  handleNormalizedAgentEvent(event);
}
```

差异则进一步收敛到 runtime adapter 层：

```txt
apps/daemon/src/runtimes/
  defs/
  adapters/
    codex.ts
    claude.ts
    opencode.ts
    acp.ts
    pi.ts
  registry.ts
  run.ts
```

## 建议

保留当前 fake CLI harness 作为 e2e 协议回归手段；如果要继续演进架构，可以新增 `AgentRuntime` 执行抽象，把 spawn、parser/session attachment、normalized event 输出封装到 runtime 层，让 daemon 的 run orchestration 只处理统一事件和状态转换。
