// Type tests for standard (TC39 2023-11) decorators. Compiled with tsconfig.standard.json, which
// turns `experimentalDecorators` off, so TypeScript checks the `(value, context)` signatures.
import { Model, Query, Relation } from 'nitromelondb'
import {
  action,
  children,
  date,
  field,
  immutableRelation,
  json,
  lazy,
  nochange,
  reader,
  readonly,
  relation,
  text,
  writer,
} from 'nitromelondb/decorators'
import { Associations } from 'nitromelondb/Model'

const sanitizeTags = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map(String) : [])

class Blog extends Model {
  static table = 'blogs'

  static associations: Associations = {
    posts: { type: 'has_many', foreignKey: 'blog_id' },
  }

  @field('name') accessor name!: string

  @children('posts') accessor posts!: Query<Post>

  @lazy get nastyPosts(): Query<Post> {
    return this.posts.extend()
  }

  @writer async rename(name: string): Promise<void> {
    await this.update((blog) => {
      blog.name = name
    })
  }

  @reader async countPosts(): Promise<number> {
    return this.posts.fetchCount()
  }

  @action async legacyRename(name: string): Promise<void> {
    await this.rename(name)
  }
}

class Post extends Model {
  static table = 'posts'

  @text('body') accessor body!: string

  @json('tags', sanitizeTags) accessor tags!: string[]

  @nochange @field('blog_id') accessor blogId!: string

  @readonly @date('created_at') accessor createdAt!: Date

  @relation('blogs', 'blog_id') accessor blog!: Relation<Blog>

  @immutableRelation('blogs', 'origin_blog_id') accessor originBlog!: Relation<Blog>
}

// Plain fields: the migration fallback, still type-checks
class LegacyStylePost extends Model {
  static table = 'posts'

  @text('body') body!: string

  @readonly @date('created_at') createdAt!: Date

  @nochange() @field('blog_id') blogId!: string
}

export const models = [Blog, Post, LegacyStylePost]

class MissingColumn extends Model {
  // @ts-expect-error decorators that take a column name need it
  @field accessor name!: string
}

class WriterOnField extends Model {
  // @ts-expect-error @writer is for methods
  @writer accessor name!: string
}

export const misuse = [MissingColumn, WriterOnField]
