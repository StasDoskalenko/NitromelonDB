# Test fixtures

Read by `SqliteEncryptionTest.cpp` (and, for the first two, by
`src/adapters/sqlite/sqlite-node/__tests__/encryption.test.js`). None of them is in the npm package.

| File | Written by | Passphrase | Contents |
| --- | --- | --- | --- |
| `sqlcipher-4.0-testkey.db` | SQLCipher 4.0 itself: `sqlcipher-resources/sqlcipher-4.0-testkey.db` from [sqlcipher/sqlcipher](https://github.com/sqlcipher/sqlcipher), the file SQLCipher's own `sqlcipher-compatibility.test` opens | `testkey` | table `t1`, 78536 rows |
| `sqlcipher-3.0-testkey.db` | SQLCipher 3.0: `sqlcipher-resources/sqlcipher-3.0-testkey.db` from [sqlcipher/sqlcipher](https://github.com/sqlcipher/sqlcipher), which SQLCipher's compatibility test opens with SQLCipher 3's settings and converts with `PRAGMA cipher_migrate` | `testkey` | table `t1`, 78536 rows (SQLCipher 3's defaults: NitromelonDB refuses it, see `refusesSqlcipher3Database`) |
| `node-encrypted-k1.db` | the Node adapter (better-sqlite3-multiple-ciphers, `sqlite-node/encryption.ts`) | `k1` | table `t`, one row `'from node'` |

`sqlcipher-4.0-testkey.db` and `sqlcipher-3.0-testkey.db` are copyright Zetetic LLC, redistributed under SQLCipher's license:

```
Copyright (c) 2025, ZETETIC LLC
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the ZETETIC LLC nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY ZETETIC LLC ''AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL ZETETIC LLC BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
