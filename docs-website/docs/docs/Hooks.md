# React Hooks

`withObservables` (see [Connecting Components](./Components.md)) is a higher-order component — a good fit if your components are plain functions of their props and you're happy wrapping them. If you'd rather subscribe from inside a hooks-based component, `nitromelondb/hooks` (or `nitromelondb/react`) ships hooks that cover the same ground for reads (`useRecord`, `useQuery`, `useObservable`), plus `useWriter` for writes.

```js
import { useRecord, useQuery, useObservable, useWriter } from 'nitromelondb/hooks'
```

## useQuery — a list of records, and useRecord — a single record

These two are usually used together: fetch the list once, then let each row track its own record.

```jsx
import { Text } from 'react-native'

function PostComments({ post }) {
  const comments = useQuery(post.comments)
  return comments.map((comment) => <Comment key={comment.id} comment={comment} />)
}

function Comment({ comment }) {
  const liveComment = useRecord(comment)
  return <Text>{liveComment.body}</Text>
}
```

`PostComments` passes a `Query` (or a `Relation`/`Collection` — anything with `.experimentalSubscribe()`) to `useQuery`, and gets back an array of matching records, re-rendering whenever the *set* changes (a comment is added, removed, or no longer matches). It does **not** re-render when an existing comment's fields change — that's `useRecord`'s job.

Each `Comment` passes its one record to `useRecord`; you get the same record back, and *that* component re-renders every time it changes (or is deleted). This is the point of splitting the two: if only `PostComments` observed the data, editing one comment's `body` would do nothing at all (a plain query doesn't watch fields). Passing `columnNames` to `useQuery` instead (see below) would fix that, but re-renders the *entire list* for a one-record edit. Tracking each record individually with `useRecord` re-renders exactly the one `<Comment>` that changed.

`comment`/`query` may be `null`/`undefined` in either hook (e.g. an optional relation that hasn't loaded, or a query gated on something not ready yet) — it's passed straight through, no subscription is set up.

### useQuery and field-level changes

If you'd rather have the whole list re-render together on a field change — e.g. because the list itself is sorted by that field — pass `columnNames` to `useQuery` instead of using per-record `useRecord`:

```js
const comments = useQuery(post.comments, ['body'])
```

This mirrors `query.observeWithColumns(['body'])` — now `PostComments` also re-renders if an existing comment's `body` changes, not just when comments are added or removed.

Calling `useQuery(query, columnNames)` from several components with the same query and columns (in any order) shares one underlying subscription rather than each component running its own — see [`Query#observeWithColumns`](./Query.md#advanced-observing).

## useWriter — writing, anchored to a record

`useRecord`/`useQuery`/`useObservable` only cover reads. For writes, `useWriter(model, writer)` gives you back a stable callback that runs `writer` inside `model.database.write()` — the hook-friendly equivalent of a `@writer` method:

```jsx
import Comment from '../models/Comment'

function useAddComment(post) {
  return useWriter(post, async (post, body) => {
    await post.database.get(Comment).create((comment) => {
      comment.post.set(post)
      comment.body = body
    })
  })
}
```

`database.get(Comment)` — passing the Model class, not a `'comments'` table-name string — is the preferred form: `TableName<T>` is just `string` underneath, so a raw string infers nothing (you'd get back an untyped `Collection<Model>`, and a typo'd table name would only surface at runtime, as `null`). The class is a real, checked value, so `database.get(Comment)` gives you `Collection<Comment>` for real, with no risk of stringly-typed drift.

`writer`'s first argument is `post`, typed as whatever concrete `Model` subclass you passed in (not a generic `Model`) — and it isn't limited to writing `post` itself; it runs inside one Writer, so it can freely touch other records/tables too, as above.

That's the whole point of `useWriter`: it's a building block for your *own* purpose-built hooks like `useAddComment`, not something you're expected to inline directly into a component with the relation-setting/table-name details spelled out at every call site. The component itself only ever sees the small, domain-shaped surface:

```jsx
import { useState } from 'react'
import { TextInput, Button, Text } from 'react-native'

function AddComment({ post }) {
  const [body, setBody] = useState('')
  const [addComment, { isPending, error }] = useAddComment(post)

  return (
    <>
      <TextInput value={body} onChangeText={setBody} />
      <Button
        title="Add comment"
        disabled={isPending}
        onPress={() => addComment(body).then(() => setBody(''))}
      />
      {error ? <Text>Couldn't add comment</Text> : null}
    </>
  )
}
```

`PostComments` from the read example is already watching `post.comments` with `useQuery`, so it picks up the new comment as soon as the write commits — nothing needs to be wired between the two.

A few mistakes this sidesteps on purpose:

- You can't forget to wrap the mutation in `database.write()` — that's built in.
- `writer` doesn't need to be memoized and has no dependency array to get wrong: the latest one you passed is always the one that runs (read via a ref internally).
- `isPending` is tracked for you, so it's there to disable the button instead of risking a double-submit.
- Errors are caught, exposed as `error`, and still re-thrown if you want to `catch` them locally too, instead of becoming an unhandled rejection.
- If the component unmounts while a write is still in flight, the write itself is **not** cancelled (a real database mutation shouldn't be abandoned mid-flight just because the component asking for it went away) — only the `isPending`/`error` state tracking is skipped once there's nothing left to update, so nothing lingers trying to schedule a render for a component that's gone.

`model` may be `null`/`undefined` (e.g. a relation that hasn't loaded yet) — the returned callback rejects if called while it's still nullish, so guard with something like `disabled={!post || isPending}`.

For a write with no natural "anchor" record (nothing in particular it's scoped to), call `database.write()` directly instead — `useWriter` is a convenience for the common "this write is about one record" case, not a replacement for `database.write()` itself.

## useObservable — the escape hatch

For anything that isn't a plain record or query — your own RxJS observables, or ones built from `.observe()` with `switchMap`/`combineLatest`/etc.:

```js
import { map } from 'rxjs/operators'

const [isEmpty, { hasEmitted, error }] = useObservable(
  post.comments.observeCount().pipe(map((n) => n === 0)),
  true, // default value, returned (with hasEmitted: false) until the first emission
)
```

`useRecord`/`useQuery` are built on this library's Rx-free `experimentalSubscribe*` methods, so prefer them for plain records and queries — no RxJS pulled in just to observe one record or list, and `useQuery`'s `columnNames` is a plain parameter instead of a `.pipe()` composition. Reach for `useObservable` when you actually have (or want to compose) an `Observable`.

Unlike `useRecord`/`useQuery`, an arbitrary Observable genuinely can take a while to emit (network-derived, debounced, ...) or error, which is why this one returns a `[value, status]` pair instead of a bare value: `status.hasEmitted` tells you whether `value` is real data or still the default, and `status.error` is set if the observable errored (`value` then keeps whatever was last emitted, if anything).

`observable` may be `null`/`undefined`; `defaultValue` is returned (`hasEmitted: false`, `error: undefined`) and no subscription is set up.

## Which one should I use?

- Observing one record → `useRecord`
- Observing a list (a `Query`, `Relation`, or `Collection`) → `useQuery`
- Everything else — a raw `Observable`, or a composition of several → `useObservable`
- Writing, scoped to one record → `useWriter`
- Writing with no natural record to anchor it to → `database.write()` directly
- Prefer subscribing from outside your render tree, or component classes → [`withObservables`](./Components.md)
