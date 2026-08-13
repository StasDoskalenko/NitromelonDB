export default function groupBy<Val, Key extends string | number | symbol>(
  predicate: (value: Val) => Key,
): (list: Val[]) => Record<Key, Val[]> {
  return (list) => {
    const groupped = {} as Record<Key, Val[]>
    let item
    let key
    let group

    for (let i = 0, len = list.length; i < len; i++) {
      item = list[i]
      key = predicate(item)
      group = groupped[key]

      if (group) {
        group.push(item)
      } else {
        groupped[key] = [item]
      }
    }

    return groupped
  }
}
