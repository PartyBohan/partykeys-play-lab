import Foundation
import SwiftUI

@MainActor
final class BrowserViewModel: ObservableObject {
    @Published var statusText = "MIDI: 0 in / 0 out"
    @Published var address: String = ""
    let coordinator: WebViewCoordinator

    init() {
        let config = ConfigLoader.load()
        let service = CoreMIDIService()
        self.coordinator = WebViewCoordinator(config: config, service: service)
        address = config.homeURL.absoluteString
        coordinator.onURLChange = { [weak self] url in
            Task { @MainActor in self?.address = url.absoluteString }
        }
        service.onDevicesChanged = { [weak self] in
            Task { @MainActor in self?.refreshStatus(service: service) }
        }
        coordinator.start()
        service.start()
        refreshStatus(service: service)
    }

    /// User hit Go on the address bar. Normalize and load.
    func commitAddress() {
        let raw = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        let urlString = raw.contains("://") ? raw : "https://" + raw
        guard let url = URL(string: urlString) else { return }
        coordinator.load(url)
    }

    private func refreshStatus(service: CoreMIDIService) {
        let snap = service.snapshot()
        statusText = "MIDI: \(snap.inputs.count) in / \(snap.outputs.count) out"
    }
}

