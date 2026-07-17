import SwiftUI
import CoreAudioKit

/// Apple's built-in BLE-MIDI scan/connect screen (CoreAudioKit). Connected
/// devices then appear in CoreMIDI automatically. USB-MIDI needs no UI.
struct MIDIConnectorView: UIViewControllerRepresentable {
    @Binding var isPresented: Bool

    func makeUIViewController(context: Context) -> UINavigationController {
        let central = CABTMIDICentralViewController()
        let nav = UINavigationController(rootViewController: central)
        central.title = "连接 MIDI 设备"
        central.navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: context.coordinator,
            action: #selector(Coordinator.doneTapped)
        )
        return nav
    }

    func updateUIViewController(_ vc: UINavigationController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(isPresented: $isPresented) }

    final class Coordinator: NSObject {
        private let isPresented: Binding<Bool>
        init(isPresented: Binding<Bool>) { self.isPresented = isPresented }
        @objc func doneTapped() { isPresented.wrappedValue = false }
    }
}
