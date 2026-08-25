package com.nozbe.watermelondb;

import android.content.ComponentCallbacks2;
import android.content.res.Configuration;

import androidx.annotation.NonNull;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.uimanager.ViewManager;

import java.util.Collections;
import java.util.List;
import java.util.logging.Logger;

public class WatermelonDBPackage implements ReactPackage {
    static {
        com.margelo.nitro.watermelondb.NitromelonDBOnLoad.initializeNative();
    }

    @NonNull
    @Override
    public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext reactAppContext) {
        NativeDatabasePath.install(reactAppContext);
        registerMemoryAlertCallbacks(reactAppContext);
        return Collections.singletonList(new HostModule(reactAppContext));
    }

    /**
     * Registers globally on the process Application instance -- no cooperation needed from the
     * consuming app (e.g. a custom Application subclass), since createNativeModules is already
     * called automatically by RN's package-loading machinery.
     *
     * Only forwards "critical" levels: onTrimMemory fires routinely (e.g. on every backgrounding),
     * not just under real memory pressure, and JS-side cache trimming is meant for the latter.
     */
    private static void registerMemoryAlertCallbacks(ReactApplicationContext reactAppContext) {
        reactAppContext.getApplicationContext().registerComponentCallbacks(new ComponentCallbacks2() {
            @Override
            public void onTrimMemory(int level) {
                if (level == TRIM_MEMORY_RUNNING_CRITICAL || level >= TRIM_MEMORY_COMPLETE) {
                    NitromelonNative.onMemoryAlert(level);
                }
            }

            @Override
            public void onConfigurationChanged(@NonNull Configuration newConfig) {
            }

            @Override
            public void onLowMemory() {
            }
        });
    }

    @NonNull
    @Override
    public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext reactAppContext) {
        return Collections.emptyList();
    }

    /**
     * RN calls {@link #invalidate()} when the JS runtime is torn down (reload). SQLite must be
     * closed on that thread before C++ destructors run against a dead runtime.
     */
    private static final class HostModule extends ReactContextBaseJavaModule {
        private final ReactApplicationContext reactContext;

        HostModule(ReactApplicationContext reactContext) {
            super(reactContext);
            this.reactContext = reactContext;
        }

        @NonNull
        @Override
        public String getName() {
            return "NitromelonHost";
        }

        @Override
        public void invalidate() {
            super.invalidate();
            reactContext.runOnJSQueueThread(HostModule::notifyDestroy);
        }

        @Deprecated
        @Override
        public void onCatalystInstanceDestroy() {
            super.onCatalystInstanceDestroy();
            reactContext.getCatalystInstance().getReactQueueConfiguration().getJSQueueThread().runOnQueue(
                    HostModule::notifyDestroy);
        }

        private static void notifyDestroy() {
            try {
                NitromelonNative.onCatalystInstanceDestroy();
            } catch (Exception e) {
                if (BuildConfig.DEBUG) {
                    Logger.getLogger("NitromelonHost").info("Could not notify Nitromelon of Catalyst destroy");
                }
            }
        }
    }
}
