#pragma once

// Header-only (no JSI, only sqlite3.h) so it can be unit-tested on its own -- see
// native/tests/StatementCacheTest.cpp.

#include <sqlite3.h>

#include <algorithm>
#include <cstddef>
#include <list>
#include <string>
#include <unordered_map>

namespace watermelondb {

// Bounds the number of cached prepared statements. `Collection#query()`'s dynamic `where()`
// conditions embed values directly as SQL literals rather than `?` placeholders (see
// plans/native-statement-cache-and-temp-store.md), so every distinct filter value combination a
// query has ever been run with produces a distinct SQL string, and caching one sqlite3_stmt* per
// string forever would grow without bound over an app's lifetime. An LRU cap keeps the hot
// statements prepared without leaking, evicting the least-recently-used entry when full.
//
// The cap scales with the schema. The library itself runs a handful of fixed statements per table
// (the local-changes queries, getDeletedRecords, find, insert, update, delete...), and a sync
// touches all of them for every table, in the same order, every time. An LRU smaller than that
// working set misses on every one of them: with a fixed cap of 50, an 80-table app re-prepared
// nearly every statement of every sync, which made sync ~45% slower than upstream WatermelonDB
// (discussion #109). Hence kBaseCapacity plus kPerTableCapacity per table, up to kMaxCapacity.
class StatementCache {
public:
    // Before the schema is known, and headroom for app queries on top of the per-table share
    static constexpr size_t kBaseCapacity = 100;
    // The library's own statements per table, with room to spare
    static constexpr size_t kPerTableCapacity = 10;
    // A prepared statement is a few KB; this keeps the worst case in the low megabytes
    static constexpr size_t kMaxCapacity = 2000;

    static size_t capacityForTables(size_t tableCount) {
        return std::min(kMaxCapacity, kBaseCapacity + kPerTableCapacity * tableCount);
    }

    // Tables in the database's schema (including local_storage). Prepared directly rather than
    // through a cache: it's a one-off. Returns 0 if the count can't be read.
    static size_t countTables(sqlite3 *db) {
        sqlite3_stmt *statement = nullptr;
        if (sqlite3_prepare_v2(db, "select count(*) from sqlite_master where type = 'table'", -1, &statement,
                               nullptr) != SQLITE_OK) {
            sqlite3_finalize(statement);
            return 0;
        }
        size_t count = 0;
        if (sqlite3_step(statement) == SQLITE_ROW) {
            count = static_cast<size_t>(sqlite3_column_int64(statement, 0));
        }
        sqlite3_finalize(statement);
        return count;
    }

    StatementCache() = default;
    StatementCache(const StatementCache &) = delete;
    StatementCache &operator=(const StatementCache &) = delete;
    ~StatementCache() { clear(); }

    // Returns the cached statement for `sql`, or nullptr if not cached. Marks the entry
    // most-recently-used on a hit.
    sqlite3_stmt *get(const std::string &sql) {
        auto it = map_.find(sql);
        if (it == map_.end()) {
            return nullptr;
        }
        lru_.splice(lru_.begin(), lru_, it->second.position);
        return it->second.statement;
    }

    // Inserts `sql` -> `statement`. The caller must have checked that get() returned nullptr for
    // `sql`. Evicts (and finalizes) least-recently-used entries if this exceeds the capacity -- the
    // new entry is most-recently-used, so it's never the one evicted by its own insertion.
    void insert(const std::string &sql, sqlite3_stmt *statement) {
        lru_.push_front(sql);
        map_[sql] = Entry{statement, lru_.begin()};
        evictDownTo(capacity_);
    }

    // Shrinking evicts least-recently-used entries right away
    void setCapacity(size_t capacity) {
        capacity_ = std::max<size_t>(1, capacity);
        evictDownTo(capacity_);
    }

    size_t capacity() const { return capacity_; }
    size_t size() const { return map_.size(); }

    // Finalizes every cached statement and empties the cache. The capacity stays.
    void clear() {
        for (auto const &entry : map_) {
            sqlite3_finalize(entry.second.statement);
        }
        map_.clear();
        lru_.clear();
    }

private:
    struct Entry {
        sqlite3_stmt *statement;
        std::list<std::string>::iterator position;
    };

    void evictDownTo(size_t size) {
        while (map_.size() > size) {
            auto it = map_.find(lru_.back());
            sqlite3_finalize(it->second.statement);
            map_.erase(it);
            lru_.pop_back();
        }
    }

    size_t capacity_ = kBaseCapacity;
    std::unordered_map<std::string, Entry> map_;
    std::list<std::string> lru_; // front = most recently used
};

} // namespace watermelondb
