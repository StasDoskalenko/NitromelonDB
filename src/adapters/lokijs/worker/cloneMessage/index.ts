// shallow-clones objects (without checking their contents), but copies arrays
export function shallowCloneDeepObjects(value: unknown): unknown {
  if (Array.isArray(value)) {
    const returned = new Array(value.length)
    for (let i = 0, len = value.length; i < len; i += 1) {
      returned[i] = shallowCloneDeepObjects(value[i])
    }
    return returned
  } else if (value && typeof value === 'object') {
    return Object.assign({}, value)
  }

  return value
}

type CloneableMessage = {
  cloneMethod?: unknown
  payload?: unknown
  [key: string]: unknown
}

export default function cloneMessage(data: unknown): unknown {
  // TODO: Even better, it would be great if we had zero-copy architecture (COW RawRecords?) and we didn't have to clone
  const message = data as CloneableMessage
  const method = message.cloneMethod
  if (method === 'shallowCloneDeepObjects') {
    const clonedData = message
    clonedData.payload = shallowCloneDeepObjects(clonedData.payload)
    return clonedData
  } else if (method === 'immutable') {
    // we get a pinky promise that the payload is immutable so we don't need to copy
    return data
  }

  throw new Error('Unknown data.clone method for cloneMessage')
}
