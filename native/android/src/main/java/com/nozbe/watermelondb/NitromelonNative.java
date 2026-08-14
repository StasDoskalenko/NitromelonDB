package com.nozbe.watermelondb;

public final class NitromelonNative {
    static {
        System.loadLibrary("NitromelonDB");
    }

    private NitromelonNative() {}

    public static native void onCatalystInstanceDestroy();
}
