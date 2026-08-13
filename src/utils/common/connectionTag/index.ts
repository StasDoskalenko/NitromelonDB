export type ConnectionTag = number & { readonly __connectionTag: unique symbol }

let previousTag = 0

export default function connectionTag(): ConnectionTag {
  previousTag += 1
  return previousTag as ConnectionTag
}
