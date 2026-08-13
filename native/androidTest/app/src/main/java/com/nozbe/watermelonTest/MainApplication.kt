package com.nozbe.watermelonTest

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.nozbe.watermelondb.WatermelonDBPackage
import com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage

class MainApplication : Application(), ReactApplication {

    override val reactHost: ReactHost by lazy {
        val packages = PackageList(this).packages.apply {
            add(NativeModulesPackage())
            add(WatermelonDBPackage())
            add(WatermelonDBJSIPackage())
        }
        getDefaultReactHost(
            context = applicationContext,
            packageList = packages,
            jsMainModulePath = "src/index.integrationTests.native",
        )
    }

    override fun onCreate() {
        super.onCreate()
        loadReactNative(this)
    }
}
