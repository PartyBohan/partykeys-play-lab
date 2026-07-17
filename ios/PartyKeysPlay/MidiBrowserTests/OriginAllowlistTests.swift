import XCTest
@testable import MidiBrowser

final class OriginAllowlistTests: XCTestCase {
    private func url(_ s: String) -> URL { URL(string: s)! }

    func test_exact_match() {
        let allow = OriginAllowlist(patterns: ["https://music.example.com"])
        XCTAssertTrue(allow.matches(url("https://music.example.com/song")))
        XCTAssertFalse(allow.matches(url("http://music.example.com")))
    }

    func test_wildcard_subdomain() {
        let allow = OriginAllowlist(patterns: ["https://*.popumusic.com"])
        XCTAssertTrue(allow.matches(url("https://app.popumusic.com/x")))
        XCTAssertTrue(allow.matches(url("https://popumusic.com")))
        XCTAssertFalse(allow.matches(url("https://notpopumusic.com")))
    }

    func test_empty_allowlist_denies_all() {
        XCTAssertFalse(OriginAllowlist(patterns: []).matches(url("https://a.b")))
    }

    func test_case_insensitive() {
        let allow = OriginAllowlist(patterns: ["https://Music.Example.com"])
        XCTAssertTrue(allow.matches(url("https://music.example.com")))
    }

    func test_wildcard_sentinel_allows_all() {
        let allow = OriginAllowlist(patterns: ["*"])
        XCTAssertTrue(allow.matches(url("https://anything.com/x")))
        XCTAssertTrue(allow.matches(url("https://sub.other.org")))
    }
}
