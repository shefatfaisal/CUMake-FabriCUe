import Capacitor
import DeviceCheck
import FirebaseCore
import FirebaseAppCheck

// Only this bridge talks to native Firebase. Database sync remains in the web SDK.
@objc(SmartLaundryAppCheckPlugin)
public class SmartLaundryAppCheckPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SmartLaundryAppCheckPlugin"
    public let jsName = "SmartLaundryAppCheck"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configuration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "limitedUseToken", returnType: CAPPluginReturnPromise)
    ]

    private func configuredApp(_ call: CAPPluginCall) -> FirebaseApp? {
        if let app = FirebaseApp.app() { return app }
        guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
              let options = FirebaseOptions(contentsOfFile: path),
              options.projectID == "lightlink-cbe74",
              options.bundleID == Bundle.main.bundleIdentifier else {
            call.reject("Native Firebase configuration is missing or does not match this app's bundle ID.")
            return nil
        }
        #if DEBUG
        AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
        #else
        AppCheck.setAppCheckProviderFactory(SmartLaundryAttestationFactory())
        #endif
        FirebaseApp.configure(options: options)
        return FirebaseApp.app()
    }

    @objc func configuration(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let app = self.configuredApp(call) else { return }
            guard let apiKey = app.options.apiKey,
                  let projectID = app.options.projectID else {
                call.reject("The iOS Firebase plist is missing its API key or project ID.")
                return
            }
            call.resolve([
                "apiKey": apiKey,
                "appId": app.options.googleAppID,
                "projectId": projectID,
                "messagingSenderId": app.options.gcmSenderID
            ])
        }
    }

    @objc func limitedUseToken(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.configuredApp(call) != nil else { return }
            AppCheck.appCheck().limitedUseToken { token, error in
                if let error = error {
                    call.reject("iOS App Check failed. For a Debug build, register the device token from Xcode in Firebase App Check for the iOS app. " + error.localizedDescription)
                    return
                }
                guard let token = token else {
                    call.reject("iOS App Check returned no token.")
                    return
                }
                call.resolve(["token": token.token, "expireTimeMillis": token.expirationDate.timeIntervalSince1970 * 1000])
            }
        }
    }
}

private class SmartLaundryAttestationFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        if DCAppAttestService.shared.isSupported { return AppAttestProvider(app: app) }
        return DeviceCheckProvider(app: app)
    }
}

@objc(SmartLaundryBridgeViewController)
public class SmartLaundryBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SmartLaundryAppCheckPlugin())
    }
}
