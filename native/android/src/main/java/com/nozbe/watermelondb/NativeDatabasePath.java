package com.nozbe.watermelondb;

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
}
