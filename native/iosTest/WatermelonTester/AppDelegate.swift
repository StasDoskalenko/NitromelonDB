import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    var reactNativeDelegate: ReactNativeDelegate?
    var reactNativeFactory: RCTReactNativeFactory?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        if NSClassFromString("XCTest") != nil {
            NSLog("%@", "WARN: WatermelonTester should be ran in Test mode, not ran directly to work in CI")
        }

        let delegate = ReactNativeDelegate()
        let factory = RCTReactNativeFactory(delegate: delegate)
        delegate.dependencyProvider = RCTAppDependencyProvider()

        reactNativeDelegate = delegate
        reactNativeFactory = factory

        window = UIWindow(frame: UIScreen.main.bounds)

        factory.startReactNative(
            withModuleName: "watermelonTest",
            in: window,
            launchOptions: launchOptions
        )

        return true
    }

    func unusedFunction() {
        // It's here to ensure this compiles correctly
        var error: NSError?
        watermelondbProvideSyncJson(0, Data(), &error)
    }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
    override func sourceURL(for bridge: RCTBridge) -> URL? {
        self.bundleURL()
    }

    override func bundleURL() -> URL? {
        RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "src/index.integrationTests.native")
    }
}
