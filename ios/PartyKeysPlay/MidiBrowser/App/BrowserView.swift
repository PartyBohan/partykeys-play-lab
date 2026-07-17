import SwiftUI
import WebKit

/// UIViewControllerRepresentable (not UIViewRepresentable) because SwiftUI does
/// not reliably size a bare WKWebView — viewDidLayoutSubviews confirms the frame
/// matches the window. The webview is pinned to all edges with Auto Layout.
struct BrowserView: UIViewControllerRepresentable {
    let coordinator: WebViewCoordinator

    func makeUIViewController(context: Context) -> WebViewController {
        WebViewController(webView: coordinator.webView)
    }
    func updateUIViewController(_ vc: WebViewController, context: Context) {}
}

final class WebViewController: UIViewController {
    private let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) not implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }
}

struct BrowserScreen: View {
    @StateObject private var vm = BrowserViewModel()
    @State private var showConnector = false

    var body: some View {
        VStack(spacing: 0) {
            if vm.coordinator.config.showsAddressBar {
                AddressBar(text: $vm.address) { vm.commitAddress() }
            }
            BrowserView(coordinator: vm.coordinator)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                StatusChip(text: vm.statusText)
                Spacer()
                Button { showConnector = true } label: {
                    Text("连接 MIDI 设备")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.tint)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity)
            .background(.ultraThinMaterial.opacity(0.96))
        }
        .sheet(isPresented: $showConnector) {
            MIDIConnectorView(isPresented: $showConnector)
        }
    }
}

struct AddressBar: View {
    @Binding var text: String
    var onCommit: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill")
                .foregroundStyle(.secondary)
                .font(.footnote)
            TextField("输入网址", text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .keyboardType(.URL)
                .submitLabel(.go)
                .onSubmit(onCommit)
            Button(action: onCommit) {
                Image(systemName: "arrow.right.circle.fill")
                    .font(.title3)
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}
