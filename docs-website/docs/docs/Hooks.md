# React Hooks

`withObservables` (see [Connecting Components](./Components.md)) is a higher-order component — a good fit if your components are plain functions of their props and you're happy wrapping them. If you'd rather subscribe from inside a hooks-based component, `nitromelondb/hooks` (or `nitromelondb/react`) ships three hooks that cover the same ground: `useModel`, `useQuery`, and `useObservable`.

```js
import { useModel, useQuery, useObservable } from 'nitromelondb/hooks'
```

## useQuery — a list of records, and useModel — a single record

These two are usually used together: fetch the list once, then let each row track its own record.

```jsx
import { Text } from 'react-native'

function PostComments({ post }) {
  const comments = useQuery(post.comments)
  return comments.map((comment) => <Comment key={comment.id} comment={comment} />)
}

function Comment({ comment }) {
  const liveComment = useModel(comment)
  return <Text>{liveComment.body}</Text>
}
```

`PostComments` passes a `Query` (or a `Relation`/`Collection` — anything with `.experimentalSubscribe()`) to `useQuery`, and gets back an array of matching records, re-rendering whenever the *set* changes (a comment is added, removed, or no longer matches). It does **not** re-render when an existing comment's fields change — that's `useModel`'s job.

Each `Comment` passes its one record to `useModel`; you get the same record back, and *that* component re-renders every time it changes (or is deleted). This is the point of splitting the two: if only `PostComments` observed the data, editing one comment's `body` would do nothing at all (a plain query doesn't watch fields). Passing `columnNames` to `useQuery` instead (see below) would fix that, but re-renders the *entire list* for a one-record edit. Tracking each record individually with `useModel` re-renders exactly the one `<Comment>` that changed.

`comment`/`query` may be `null`/`undefined` in either hook (e.g. an optional relation that hasn't loaded, or a query gated on something not ready yet) — it's passed straight through, no subscription is set up.

### useQuery and field-level changes

If you'd rather have the whole list re-render together on a field change — e.g. because the list itself is sorted by that field — pass `columnNames` to `useQuery` instead of using per-record `useModel`:

```js
const comments = useQuery(post.comments, ['body'])
```

This mirrors `query.observeWithColumns(['body'])` — now `PostComments` also re-renders if an existing comment's `body` changes, not just when comments are added or removed.

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
