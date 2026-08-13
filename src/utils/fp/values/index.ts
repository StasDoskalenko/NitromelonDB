export default function values<T>(obj: Record<string, T>): T[] {
  return Object.values(obj)
}
