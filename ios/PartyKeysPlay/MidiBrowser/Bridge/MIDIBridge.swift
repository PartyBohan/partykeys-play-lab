import Foundation
import WebKit

final class MIDIBridge: NSObject, WKScriptMessageHandler {
    static let flushIntervalMillis: UInt64 = 5

    private let service: CoreMIDIService
    private let batcher = MIDIBatcher()
    private let enableSysex: Bool
    private var timer: DispatchSourceTimer?
    weak var webView: WKWebView?

    init(service: CoreMIDIService, enableSysex: Bool) {
        self.service = service
        self.enableSysex = enableSysex
        super.init()
    }

    func start() {
        service.onPacket = { [weak self] entry in self?.batcher.append(entry) }
        // Chain: also keep whatever the owner installed (e.g. status refresh).
        let prev = service.onDevicesChanged
        service.onDevicesChanged = { [weak self] in
            prev?()
            self?.emitStatechange()
        }

        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now(), repeating: .milliseconds(Int(MIDIBridge.flushIntervalMillis)))
        t.setEventHandler { [weak self] in self?.flush() }
        t.resume()
        timer = t
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    private func flush() {
        let entries = batcher.flush()
        guard !entries.isEmpty else { return }
        print("MIDIBridge deliver count=\(entries.count) first=\(entries.first?.portId ?? "?")")
        let payload = entries.map { entry -> [String: Any] in
            ["id": entry.portId, "data": entry.bytes.map(Int.init), "time": entry.timestamp]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__webMIDIBridge._deliverInput(\(json));")
    }

    private func emitStatechange() {
        let snap = service.snapshot()
        print("MIDIBridge emitStatechange in=\(snap.inputs.count) out=\(snap.outputs.count)")
        guard let data = try? JSONEncoder().encode(snap),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__webMIDIBridge._statechange(\(json));")
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ cc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: body),
              let msg = try? JSONDecoder().decode(BridgeMessage.self, from: data) else {
            return
        }
        switch msg.cmd {
        case "access":
            let requestedSysex = msg.payload.sysex ?? false
            let snap = service.snapshot()
            print("MIDIBridge access sysex=\(requestedSysex) enabled=\(enableSysex) in=\(snap.inputs.count) out=\(snap.outputs.count)")
            if requestedSysex && !enableSysex {
                resolve(msg.id, ok: false, payload: ["name": "SecurityError", "message": "sysex disabled"])
                return
            }
            resolve(msg.id, ok: true, payload: snap)
            // DIAG: after the page's access promise settles, log what the polyfill holds.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.webView?.evaluateJavaScript("window.__webMIDIBridge._debug()") { result, _ in
                    print("MIDIBridge post-access polyfill = \(result ?? "nil")")
                }
            }
        case "send":
            if let portId = msg.payload.portId, let bytes = msg.payload.data {
                service.send(portId: portId, data: bytes.map(UInt8.init))
            }
        case "open", "close":
            resolve(msg.id, ok: true, payload: ["ack": true])
        default:
            print("MIDIBridge unknown cmd=\(msg.cmd)")
        }
    }

    private func resolve(_ id: Int, ok: Bool, payload: Any) {
        var obj: [String: Any] = ["id": id, "ok": ok]
        if let dict = payload as? [String: Any] {
            obj["payload"] = dict
        } else if let encodable = payload as? Encodable {
            if let d = try? JSONEncoder().encode(encodable), let v = try? JSONSerialization.jsonObject(with: d) {
                obj["payload"] = v
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__webMIDIBridge._resolve(\(json));")
    }
}
