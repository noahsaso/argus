export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, Keys>
> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>
  }[Keys]

export type Block = {
  height: bigint
  timeUnixMs: bigint
}

export type SerializedBlock = {
  height: string
  timeUnixMs: string
  timestamp: string
}

export type NestedMap<T> = {
  [key: string]: T | NestedMap<T> | undefined
}
