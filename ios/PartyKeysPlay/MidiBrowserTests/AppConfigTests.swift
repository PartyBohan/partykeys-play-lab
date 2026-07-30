import XCTest
@testable import MidiBrowser

final class AppConfigTests: XCTestCase {
    func test_product_config_is_locked_to_partykeys_play() {
        let cfg = ConfigLoader.load()
        XCTAssertEqual(cfg.homeURL, URL(string: "https://op1.partykeys.ai/?appBuild=5"))
        XCTAssertEqual(cfg.allowedOrigins, [
            "https://op1.partykeys.ai",
            "https://partykeys-play-lab.vercel.app",
        ])
        XCTAssertEqual(cfg.title, "PartyKeys Play")
        XCTAssertTrue(cfg.enableSysex)
        XCTAssertFalse(cfg.showsAddressBar)
        XCTAssertTrue(cfg.opensHomeOnLaunch)
    }

    func test_decodes_valid_json() throws {
        let json = """
        {"homeURL":"https://music.example.com","allowedOrigins":["https://music.example.com"],"title":"T","enableSysex":false}
        """.data(using: .utf8)!
        let cfg = try JSONDecoder().decode(AppConfig.self, from: json)
        XCTAssertEqual(cfg.homeURL, URL(string: "https://music.example.com"))
        XCTAssertEqual(cfg.allowedOrigins, ["https://music.example.com"])
        XCTAssertEqual(cfg.title, "T")
        XCTAssertFalse(cfg.enableSysex)
    }

    func test_show_address_bar_defaults_true_when_missing() throws {
        let json = """
        {"homeURL":"https://a.b","allowedOrigins":["https://a.b"],"title":"T","enableSysex":false}
        """.data(using: .utf8)!
        let cfg = try JSONDecoder().decode(AppConfig.self, from: json)
        XCTAssertNil(cfg.showAddressBar)
        XCTAssertTrue(cfg.showsAddressBar)
    }

    func test_show_address_bar_false_decodes() throws {
        let json = """
        {"homeURL":"https://a.b","allowedOrigins":["https://a.b"],"title":"T","enableSysex":false,"showAddressBar":false}
        """.data(using: .utf8)!
        let cfg = try JSONDecoder().decode(AppConfig.self, from: json)
        XCTAssertFalse(cfg.showsAddressBar)
    }

    func test_auto_open_defaults_true_when_missing() throws {
        let json = """
        {"homeURL":"https://a.b","allowedOrigins":["https://a.b"],"title":"T","enableSysex":false}
        """.data(using: .utf8)!
        let cfg = try JSONDecoder().decode(AppConfig.self, from: json)
        XCTAssertTrue(cfg.opensHomeOnLaunch)
    }

    func test_auto_open_false_when_set() throws {
        let json = """
        {"homeURL":"https://a.b","allowedOrigins":["https://a.b"],"title":"T","enableSysex":false,"autoOpenHome":false}
        """.data(using: .utf8)!
        let cfg = try JSONDecoder().decode(AppConfig.self, from: json)
        XCTAssertFalse(cfg.opensHomeOnLaunch)
    }

    func test_kiosk_mode_forces_auto_open() throws {
        // No address bar => must auto-open home even if autoOpenHome=false.
        let json = """
        {"homeURL":"https://a.b","allowedOrigins":["https://a.b"],"title":"T","enableSysex":false,"showAddressBar":false,"autoOpenHome":false}
        """.data(using: .utf8)!
        let cfg = try JSONDecoder().decode(AppConfig.self, from: json)
        XCTAssertFalse(cfg.showsAddressBar)
        XCTAssertTrue(cfg.opensHomeOnLaunch)
    }

    func test_loader_falls_back_to_default_when_missing() {
        let cfg = ConfigLoader.load(bundledAs: "does-not-exist")
        XCTAssertEqual(cfg, AppConfig.default)
    }
}
