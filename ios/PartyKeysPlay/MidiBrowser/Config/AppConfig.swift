import Foundation

struct AppConfig: Codable, Equatable {
    var homeURL: URL
    var allowedOrigins: [String]
    var title: String
    var enableSysex: Bool
    /// Show a URL address bar the user can edit. nil defaults to true.
    /// Set false only when shipping a kiosk build locked to `homeURL`.
    var showAddressBar: Bool?
    /// Open `homeURL` automatically on launch. nil defaults to true.
    /// Forced true in kiosk mode (no address bar). Set false to start on a
    /// blank page with the address bar pre-filled, awaiting a manual Go.
    var autoOpenHome: Bool?

    var showsAddressBar: Bool { showAddressBar ?? true }
    var opensHomeOnLaunch: Bool {
        showsAddressBar ? (autoOpenHome ?? true) : true
    }

    static let `default` = AppConfig(
        homeURL: URL(string: "https://example.com")!,
        allowedOrigins: ["https://example.com"],
        title: "MIDI Browser",
        enableSysex: false,
        showAddressBar: true,
        autoOpenHome: true
    )
}
