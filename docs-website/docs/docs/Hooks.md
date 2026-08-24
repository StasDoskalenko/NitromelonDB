# React Hooks

`withObservables` (see [Connecting Components](./Components.md)) is a higher-order component — a good fit if your components are plain functions of their props and you're happy wrapping them. If you'd rather subscribe from inside a hooks-based component, `nitromelondb/hooks` (or `nitromelondb/react`) ships three hooks that cover the same ground: `useModel`, `useQuery`, and `useObservable`.

```js
import { useModel, useQuery, useObservable } from 'nitromelondb/hooks'
```

## useModel — a single record

```jsx
function Comment({ comment }) {
  const liveComment = useModel(comment)
  return <p>{liveComment.body}</p>
}
```

Pass in a record; you get the same record back, and the component re-renders every time it changes (or is deleted). `comment` may be `null`/`undefined` (e.g. an optional relation that hasn't loaded) — it's passed straight through, no subscription is set up.

### Why this doesn't need cloning

Records are mutated in place: `comment.observe()` / `comment.experimentalSubscribe()` always hand you back the exact same object — that's fine for reading fields, but it means the object's *reference* never changes. If you've seen the suggestion to clone the record on every emission just so React sees a "new" value and re-renders — that works, but it's solving the wrong layer of the problem: the record was never the thing that needed to change.

`useModel` doesn't try to make the record look different. It forces a re-render on every notification (the same mechanism `withObservables` already uses internally — a component that re-renders on every emission rather than diffing the record for changes), and lets you read `liveComment.body` fresh during that render. No new object, no cloning, no risk of the clone silently drifting from the real record.

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
