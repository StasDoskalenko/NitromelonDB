package com.nitromelondb;

import android.content.Context;

public final class NativeDatabasePath {
    private static Context context;

    public static void install(Context ctx) {
        context = ctx.getApplicationContext();
        // Keep this method reachable so R8 does not strip the JNI entry point.
        _resolveDatabasePath("");
    }

    static String _resolveDatabasePath(String dbName) {
        if (context == null) {
            throw new IllegalStateException("NativeDatabasePath.install() was not called");
        }
        return context.getDatabasePath(dbName + ".db").getPath().replace("/databases", "");
    }

    /**
     * App-sandboxed, OS-manageable cache directory for sqlite3_temp_directory, so large
     * batches/CREATE INDEX/VACUUM scratch space spills to disk instead of forcing
     * temp_store=memory (which puts that scratch space on the heap instead -- see
     * native/shared/Database.cpp).
     */
    static String _getTempDirectory() {
        if (context == null) {
            throw new IllegalStateException("NativeDatabasePath.install() was not called");
        }
        return context.getCacheDir().getAbsolutePath();
    }
}
