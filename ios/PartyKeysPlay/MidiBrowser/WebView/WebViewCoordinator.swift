import Foundation
import WebKit

final class WebViewCoordinator: NSObject, WKNavigationDelegate {
    let config: AppConfig
    let bridge: MIDIBridge
    let allowlist: OriginAllowlist
    let webView: WKWebView

    /// Fired on main-frame commits so the address bar can track the current URL.
    var onURLChange: ((URL) -> Void)?

    init(config: AppConfig, service: CoreMIDIService) {
        self.config = config
        self.bridge = MIDIBridge(service: service, enableSysex: config.enableSysex)
        self.allowlist = OriginAllowlist(patterns: config.allowedOrigins)

        let cc = WKUserContentController()
        let cfg = WKWebViewConfiguration()
        cfg.userContentController = cc
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = false
        cfg.setURLSchemeHandler(BundledPageHandler(), forURLScheme: "popumidi")
        self.webView = WKWebView(frame: .zero, configuration: cfg)
        super.init()

        cc.add(bridge, name: "midiBridge")
        bridge.webView = webView
        webView.navigationDelegate = self

        if allowlist.matches(config.homeURL) {
            injectPolyfill(into: cc)
        }
        if config.opensHomeOnLaunch {
            loadFresh(config.homeURL)
        }
    }

    func start() { bridge.start() }
    func stop() { bridge.stop() }

    /// Load an arbitrary URL (from the address bar).
    func load(_ url: URL) {
        loadFresh(url)
    }

    /// The product UI is web-delivered. Always validate the first navigation
    /// against production so an older WKWebView/Service Worker cache cannot
    /// keep a released native shell on a stale interface.
    private func loadFresh(_ url: URL) {
        let request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 30
        )
        webView.load(request)
    }

    func webView(_ wv: WKWebView, didCommit navigation: WKNavigation!) {
        if let url = wv.url { onURLChange?(url) }
    }

    private func injectPolyfill(into cc: WKUserContentController) {
        guard let url = Bundle.main.url(forResource: "webmidi-polyfill", withExtension: "js"),
              let src = try? String(contentsOf: url, encoding: .utf8) else { return }
        let script = WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        cc.addUserScript(script)
    }

    // In kiosk mode (no address bar) lock navigation to the allowlist. With the
    // address bar the user may go anywhere; the polyfill still injects everywhere.
    func webView(_ wv: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if !config.showsAddressBar,
           let url = navigationAction.request.url,
           !allowlist.matches(url) {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
