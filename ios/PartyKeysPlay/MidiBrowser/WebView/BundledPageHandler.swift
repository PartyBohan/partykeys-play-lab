import Foundation
import WebKit

final class BundledPageHandler: NSObject, WKURLSchemeHandler {
    func webView(_ wv: WKWebView, start task: WKURLSchemeTask) {
        let host = task.request.url?.host ?? ""
        let resource = host.isEmpty ? "midi-checker" : host
        guard let url = Bundle.main.url(forResource: resource, withExtension: "html"),
              let data = try? Data(contentsOf: url) else {
            task.didFailWithError(NSError(domain: "Bundled", code: 404))
            return
        }
        let response = HTTPURLResponse(url: task.request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "text/html"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ wv: WKWebView, stop task: WKURLSchemeTask) {}
}
