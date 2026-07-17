/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { detectUsageSupport, fetchPooledUsage, type PooledUsage } from "./usage.js"

type OpenTUIIntrinsicElements = import("@opentui/solid/jsx-runtime").JSX.IntrinsicElements

declare global {
  namespace JSX {
    type Element = import("@opentui/solid/jsx-runtime").JSX.Element
    interface IntrinsicElements extends OpenTUIIntrinsicElements {}
    interface ElementChildrenAttribute {
      children: {}
    }
  }
}

const SUPPORT_SUCCESS_TTL_MS = 5 * 60_000
const SUPPORT_FAILURE_TTL_MS = 60_000
const MAX_USAGE_SUPPORT_CACHE_ENTRIES = 8

type UsageSupportCacheEntry = {
  promise: Promise<boolean | undefined>
  expiresAt: number
  signal: AbortSignal
  settled: boolean
  evictionTimer: ReturnType<typeof setTimeout> | undefined
}

const usageSupportCache = new Map<string, UsageSupportCacheEntry>()

type ActiveProviderContext = {
  model?: { providerID: string }
  agent?: string
}

type MessageContext = {
  role: "assistant" | "user"
  agent?: string
  providerID?: string
  model?: { providerID?: string }
}

function providerIDFromModel(model: string | undefined): string | undefined {
  if (typeof model !== "string") {
    return undefined
  }

  const value = model.trim()
  if (!value) {
    return undefined
  }

  return value.split("/", 1)[0] || undefined
}

export function resolveActiveProviderID(
  session: ActiveProviderContext,
  config: { model?: string; agent?: Record<string, { model?: string } | undefined> },
): string | undefined {
  const sessionProviderID = session.model?.providerID
  if (sessionProviderID) {
    return sessionProviderID
  }

  const agentModel = session.agent ? config.agent?.[session.agent]?.model : undefined
  return providerIDFromModel(agentModel) ?? providerIDFromModel(config.model)
}

export function resolveProviderCredentials(
  provider: {
    key?: string
    env: string[]
    options: Record<string, unknown>
  },
): { baseURL: string; apiKey: string } | undefined {
  const baseURL = typeof provider.options.baseURL === "string" ? provider.options.baseURL.trim() : ""
  if (!baseURL) {
    return undefined
  }

  const candidates = [
    provider.key,
    typeof provider.options.apiKey === "string" ? provider.options.apiKey : undefined,
    ...provider.env.map((name) => process.env[name]),
  ]
  const apiKey = candidates.find((value) => typeof value === "string" && value.trim())

  if (typeof apiKey !== "string") {
    return undefined
  }

  return { baseURL, apiKey: apiKey.trim() }
}

export function resolveLatestMessageContext(messages: ReadonlyArray<MessageContext>): ActiveProviderContext {
  let agent: string | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (agent === undefined && message.agent) {
      agent = message.agent
    }

    const providerID = message.role === "assistant" ? message.providerID : message.model?.providerID
    if (providerID) {
      return { model: { providerID }, agent }
    }
  }

  return agent === undefined ? {} : { agent }
}

export function isUsageSupportCacheFresh(expiresAt: number, now: number): boolean {
  return expiresAt > now
}

export function sessionIDFromUpdatedEvent(event: { properties: { info: { id: string } } }): string {
  return event.properties.info.id
}

const tui: TuiPlugin = async (api) => {
  const [usageBySession, setUsageBySession] = createStore<Record<string, UsageState>>({})
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_context, props) {
        return (
          <UsageView
            api={api}
            sessionID={props.session_id}
            state={usageBySession}
            setState={(state) => setUsageBySession(props.session_id, state)}
          />
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-codex-lb",
  tui,
}

export default plugin

type UsageState = {
  identity: string | undefined
  usage: PooledUsage | undefined
}

type UsageViewProps = {
  api: TuiPluginApi
  sessionID: string
  state: Record<string, UsageState>
  setState: (state: UsageState) => void
}

function UsageView(props: UsageViewProps) {
  const [refresh, setRefresh] = createSignal(0)
  let requestVersion = 0

  const refreshSession = (sessionID: string) => {
    if (sessionID === props.sessionID) {
      setRefresh((value) => value + 1)
    }
  }
  const stopRefresh = [
    props.api.event.on("session.updated", (event) => refreshSession(sessionIDFromUpdatedEvent(event))),
    props.api.event.on("message.updated", (event) => refreshSession(event.properties.sessionID)),
    props.api.event.on("message.removed", (event) => refreshSession(event.properties.sessionID)),
    props.api.event.on("tui.session.select", (event) => refreshSession(event.properties.sessionID)),
  ]
  onCleanup(() => stopRefresh.forEach((stop) => stop()))

  createEffect(() => {
    refresh()
    const messageContext = resolveLatestMessageContext(props.api.state.session.messages(props.sessionID))
    const session = (
      props.api.state.session as TuiPluginApi["state"]["session"] & {
        get?: (sessionID: string) => ActiveProviderContext | undefined
      }
    ).get?.(props.sessionID)
    const providerID = resolveActiveProviderID(
      {
        model: messageContext.model ?? session?.model,
        agent: messageContext.agent ?? session?.agent,
      },
      props.api.state.config,
    )
    const provider = providerID ? props.api.state.provider.find((item) => item.id === providerID) : undefined
    const credentials = providerID?.startsWith("codex-lb-") && provider
      ? resolveProviderCredentials(provider)
      : undefined
    const identity = providerID && credentials
      ? `${providerID}\n${credentials.baseURL}\n${credentials.apiKey}`
      : undefined
    const previousState = untrack(() => props.state[props.sessionID])
    const changed = identity !== previousState?.identity
    const version = ++requestVersion

    if (changed) {
      props.setState({ identity, usage: undefined })
    }

    if (!credentials || !identity) {
      return
    }

    const controller = new AbortController()

    const isCurrent = () => version === requestVersion && !controller.signal.aborted
    const fetchUsage = async () => {
      try {
        if (!isCurrent()) {
          return
        }

        const supported = await getUsageSupport(credentials.baseURL, credentials.apiKey, controller.signal)
        if (!isCurrent()) {
          return
        }

        if (supported === undefined) {
          return
        }

        if (supported === false) {
          props.setState({ identity, usage: undefined })
          return
        }

        const usage = await fetchPooledUsage(credentials.baseURL, credentials.apiKey, {
          signal: controller.signal,
        })
        if (usage && isCurrent()) {
          props.setState({ identity, usage })
        }
      } catch {
        // Usage must never affect TUI startup or rendering.
      }
    }

    if (shouldFetchUsage(identity, previousState)) {
      void fetchUsage()
    }
    const interval = setInterval(() => void fetchUsage(), 60_000)
    onCleanup(() => {
      controller.abort()
      clearInterval(interval)
      evictUsageSupportForSignal(controller.signal)
    })
  })

  const usage = () => props.state[props.sessionID]?.usage

  return (
    <Show
      when={hasUsageValue(usage()?.primary) || hasUsageValue(usage()?.secondary)}
    >
      <box flexDirection="column">
        <text fg={props.api.theme.current.text}>
          <b>Codex LB</b>
        </text>
        <Show when={hasUsageValue(usage()?.primary)}>
          <UsageRow api={props.api} label="Primary" value={() => usage()?.primary ?? 0} />
        </Show>
        <Show when={hasUsageValue(usage()?.secondary)}>
          <UsageRow api={props.api} label="Secondary" value={() => usage()?.secondary ?? 0} />
        </Show>
      </box>
    </Show>
  )
}

export function shouldFetchUsage(identity: string, previous: UsageState | undefined): boolean {
  return previous?.identity !== identity || previous.usage === undefined
}

export function getUsageSupport(baseURL: string, apiKey: string, signal: AbortSignal): Promise<boolean | undefined> {
  const key = `${baseURL}\n${apiKey}`
  const now = Date.now()
  for (const [cachedKey, entry] of usageSupportCache) {
    if (!isUsageSupportCacheFresh(entry.expiresAt, now)) {
      removeUsageSupportCacheEntry(cachedKey, entry)
    }
  }

  const cached = usageSupportCache.get(key)
  if (cached) {
    usageSupportCache.delete(key)
    usageSupportCache.set(key, cached)
    return cached.promise
  }

  const probe = detectUsageSupport(baseURL, apiKey, { signal })
  const entry: UsageSupportCacheEntry = {
    promise: Promise.resolve(undefined),
    expiresAt: now + SUPPORT_FAILURE_TTL_MS,
    signal,
    settled: false,
    evictionTimer: undefined,
  }
  entry.promise = probe.then(
    (supported) => {
      entry.settled = true
      entry.expiresAt = Date.now() + (supported === true ? SUPPORT_SUCCESS_TTL_MS : SUPPORT_FAILURE_TTL_MS)
      scheduleUsageSupportEviction(key, entry)
      return supported
    },
    () => {
      entry.settled = true
      entry.expiresAt = Date.now() + SUPPORT_FAILURE_TTL_MS
      scheduleUsageSupportEviction(key, entry)
      return undefined
    },
  )
  usageSupportCache.set(key, entry)
  while (usageSupportCache.size > MAX_USAGE_SUPPORT_CACHE_ENTRIES) {
    const oldest = usageSupportCache.entries().next().value
    if (!oldest) {
      break
    }
    removeUsageSupportCacheEntry(oldest[0], oldest[1])
  }
  scheduleUsageSupportEviction(key, entry)
  return entry.promise
}

function clearUsageSupportTimer(entry: UsageSupportCacheEntry) {
  if (entry.evictionTimer !== undefined) {
    clearTimeout(entry.evictionTimer)
    entry.evictionTimer = undefined
  }
}

function removeUsageSupportCacheEntry(key: string, entry: UsageSupportCacheEntry) {
  if (usageSupportCache.get(key) !== entry) {
    return
  }

  usageSupportCache.delete(key)
  clearUsageSupportTimer(entry)
}

function scheduleUsageSupportEviction(key: string, entry: UsageSupportCacheEntry) {
  clearUsageSupportTimer(entry)
  if (usageSupportCache.get(key) !== entry) {
    return
  }

  entry.evictionTimer = setTimeout(() => {
    entry.evictionTimer = undefined
    if (usageSupportCache.get(key) !== entry) {
      return
    }

    const remaining = entry.expiresAt - Date.now()
    if (remaining > 0) {
      scheduleUsageSupportEviction(key, entry)
      return
    }

    removeUsageSupportCacheEntry(key, entry)
  }, Math.max(0, entry.expiresAt - Date.now()))
}

function evictUsageSupportForSignal(signal: AbortSignal) {
  for (const [key, entry] of usageSupportCache) {
    if (entry.signal === signal && !entry.settled && usageSupportCache.get(key) === entry) {
      removeUsageSupportCacheEntry(key, entry)
    }
  }
}

function UsageRow(props: {
  api: TuiPluginApi
  label: string
  value: () => number
}) {
  return (
    <text fg={usageColor(props.api, props.value())}>
      {props.label}: {usageTrack(props.value())} {formatUsagePercentage(props.value())}%
    </text>
  )
}

function usageColor(api: TuiPluginApi, value: number) {
  if (value > 50) {
    return api.theme.current.success
  }
  if (value >= 20) {
    return api.theme.current.warning
  }
  return api.theme.current.error
}

export function hasUsageValue(value: number | null | undefined): value is number {
  return typeof value === "number"
}

export function usageTrack(percentage: number): string {
  const value = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0
  const filled = Math.round((value / 100) * 20)
  return "#".repeat(filled) + "-".repeat(20 - filled)
}

export function formatUsagePercentage(percentage: number): string {
  const rounded = Math.round((percentage + Number.EPSILON) * 10) / 10
  return rounded.toFixed(1)
}
