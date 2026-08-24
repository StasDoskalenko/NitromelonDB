# React Hooks

`withObservables` (see [Connecting Components](./Components.md)) is a higher-order component — a good fit if your components are plain functions of their props and you're happy wrapping them. If you'd rather subscribe from inside a hooks-based component, `nitromelondb/hooks` (or `nitromelondb/react`) ships three hooks that cover the same ground: `useModel`, `useQuery`, and `useObservable`.

```js
import { useModel, useQuery, useObservable } from 'nitromelondb/hooks'
```

## useModel — a single record

```jsx
import { Text } from 'react-native'

function Comment({ comment }) {
  const liveComment = useModel(comment)
  return <Text>{liveComment.body}</Text>
}
```

Pass in a record; you get the same record back, and the component re-renders every time it changes (or is deleted). `comment` may be `null`/`undefined` (e.g. an optional relation that hasn't loaded) — it's passed straight through, no subscription is set up.

## useQuery — a list of records

```jsx
function PostComments({ post }) {
  const comments = useQuery(post.comments)
  return comments.map((comment) => <Comment key={comment.id} comment={comment} />)
}
```

Pass in a `Query` (or a `Relation`/`Collection` — anything with `.experimentalSubscribe()`); you get back an array of matching records, re-rendering whenever the *set* changes (a record is created, deleted, or no longer matches). Like `Query#observe()`, field-level changes to records already in the list are **not** observed by default — pass `columnNames` for that:

```js
const comments = useQuery(post.comments, ['body'])
```

This mirrors `query.observeWithColumns(['body'])` — now the component also re-renders if an existing comment's `body` changes, not just when comments are added or removed.

`query` may be `null`/`undefined`; an empty array is returned and no subscription is set up.

Calling `useQuery(query, columnNames)` from several components with the same query and columns (in any order) shares one underlying subscription rather than each component running its own — see [`Query#observeWithColumns`](./Query.md#advanced-observing).

## useObservable — the escape hatch

For anything that isn't a plain record or query — your own RxJS observables, or ones built from `.observe()` with `switchMap`/`combineLatest`/etc.:

```js
import { map } from 'rxjs/operators'

const isEmpty = useObservable(
  post.comments.observeCount().pipe(map((n) => n === 0)),
  true, // default value, returned until the first emission
)
```

`useModel`/`useQuery` are built on this library's Rx-free `experimentalSubscribe*` methods, so prefer them for plain records and queries — no RxJS pulled in just to observe one record or list, and `useQuery`'s `columnNames` is a plain parameter instead of a `.pipe()` composition. Reach for `useObservable` when you actually have (or want to compose) an `Observable`.

`observable` may be `null`/`undefined`; `defaultValue` is returned and no subscription is set up.

## Which one should I use?

- Observing one record → `useModel`
- Observing a list (a `Query`, `Relation`, or `Collection`) → `useQuery`
- Everything else — a raw `Observable`, or a composition of several → `useObservable`
- Prefer subscribing from outside your render tree, or component classes → [`withObservables`](./Components.md)
