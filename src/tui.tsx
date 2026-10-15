/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui"
import type { Context as TuiPluginContext } from "@opencode/plugin/tui/context"
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js"
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

const SIDEBAR_MAX_WIDTH = 36
const MAX_PERCENT_LABEL = "100.0%"
const MIN_BAR_WIDTH = 10
const DEFAULT_BAR_WIDTH = 20
const BAR_FILLED_CHAR = "█"
const BAR_EMPTY_CHAR = "░"

function computeBarWidth(prefixLength: number): number {
  return Math.max(
    MIN_BAR_WIDTH,
    SIDEBAR_MAX_WIDTH - prefixLength - 1 - MAX_PERCENT_LABEL.length,
  )
}

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
}

type MessageContext = {
  type: string
  model?: { providerID?: string }
}

export function resolveActiveProviderID(
  session: ActiveProviderContext,
  messages: ReadonlyArray<MessageContext>,
): string | undefined {
  const latestModel = resolveLatestMessageContext(messages).model?.providerID
  return latestModel ?? session.model?.providerID
}

export function resolveProviderCredentials(
  provider: { settings?: Record<string, unknown> },
): { baseURL: string; apiKey: string } | undefined {
  const settings = provider.settings ?? {}
  const baseURL = typeof settings.baseURL === "string" ? settings.baseURL.trim() : ""
  const apiKey = typeof settings.apiKey === "string" ? settings.apiKey.trim() : ""
  if (!baseURL || !apiKey) return undefined
  return { baseURL, apiKey }
}

export function resolveLatestMessageContext(
  messages: ReadonlyArray<MessageContext>,
): ActiveProviderContext {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const providerID =
      message.type === "assistant" || message.type === "model-switched"
        ? message.model?.providerID
        : undefined
    if (providerID) return { model: { providerID } }
  }

  return {}
}

export function isUsageSupportCacheFresh(expiresAt: number, now: number): boolean {
  return expiresAt > now
}

type UsageState = {
  identity: string | undefined
  usage: PooledUsage | undefined
}

type UsageViewProps = {
  context: TuiPluginContext
  sessionID: string
  state: Record<string, UsageState>
  setState: (state: UsageState) => void
}

export default Plugin.define({
  id: "opencode-codex-lb",
  setup(context) {
    const [usageBySession, setUsageBySession] = context.storage.memory("usageBySession", {
      initial: {} as Record<string, UsageState>,
    })
    const location = context.location ?? context.data.location.default()
    void context.data.location.provider.sync(location).catch(() => {})

    return context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => (
        <UsageView
          context={context}
          sessionID={sessionID}
          state={usageBySession}
          setState={(state) => setUsageBySession((draft) => { draft[sessionID] = state })}
        />
      ),
    })
  },
})

function UsageView(props: UsageViewProps) {
  const [refresh, setRefresh] = createSignal(0)
  let requestVersion = 0

  const location = props.context.location ?? props.context.data.location.default()
  const refreshSession = (sessionID: string) => {
    if (sessionID === props.sessionID) setRefresh((value) => value + 1)
  }
  const stopRefresh = [
    props.context.data.on("session.model.selected", (event) => refreshSession(event.data.sessionID)),
    props.context.data.on("session.execution.succeeded", (event) => refreshSession(event.data.sessionID)),
    props.context.data.on("tui.session.select", (event) => refreshSession(event.data.sessionID)),
    props.context.data.on("provider.updated", () => {
      props.context.data.location.provider.invalidate(location)
      void props.context.data.location.provider.sync(location).then(() => {
        setRefresh((value) => value + 1)
      }).catch(() => {})
    }),
  ]
  onCleanup(() => stopRefresh.forEach((stop) => stop()))

  createEffect(() => {
    refresh()
    const messages = props.context.data.session.message.list(props.sessionID)
    const session = props.context.data.session.get(props.sessionID)
    const providerID = resolveActiveProviderID({ model: session?.model }, messages)
    const providers = props.context.data.location.provider.list(location) ?? []
    const provider = providers.find((item) => item.id === providerID)
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
        <text fg={props.context.theme.text.base}>
          <b>Codex LB</b>
        </text>
        <Show when={hasUsageValue(usage()?.primary)}>
          <UsageRow context={props.context} label="Primary" value={() => usage()?.primary ?? 0} />
        </Show>
        <Show when={hasUsageValue(usage()?.secondary)}>
          <UsageRow context={props.context} label="Secondary" value={() => usage()?.secondary ?? 0} />
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
  context: TuiPluginContext
  label: string
  value: () => number
}) {
  const prefix = `${props.label}: `
  const barWidth = computeBarWidth(prefix.length)
  return (
    <text fg={usageColor(props.context, props.value())}>
      {prefix}{usageTrack(props.value(), barWidth)} {formatUsagePercentage(props.value())}%
    </text>
  )
}

function usageColor(context: TuiPluginContext, value: number) {
  if (value > 50) return context.theme.text.feedback.success.base
  if (value >= 20) return context.theme.text.feedback.warning.base
  return context.theme.text.feedback.error.base
}

export function hasUsageValue(value: number | null | undefined): value is number {
  return typeof value === "number"
}

export function usageTrack(percentage: number, width: number = DEFAULT_BAR_WIDTH): string {
  const value = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0
  const filled = Math.round((value / 100) * width)
  const empty = width - filled
  return BAR_FILLED_CHAR.repeat(filled) + BAR_EMPTY_CHAR.repeat(empty)
}

export function formatUsagePercentage(percentage: number): string {
  const rounded = Math.round((percentage + Number.EPSILON) * 10) / 10
  return rounded.toFixed(1)
}
