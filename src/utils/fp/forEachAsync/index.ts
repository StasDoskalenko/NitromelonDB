// Executes async action sequentially for each element in list (same as async for-of)
export default function forEachAsync<T>(list: T[], action: (arg0: T) => Promise<void>): Promise<void> {
  return list.reduce((promiseChain, element) => promiseChain.then(() => action(element)), Promise.resolve());
}
