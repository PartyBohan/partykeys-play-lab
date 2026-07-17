import XCTest
import CoreMIDI
@testable import MidiBrowser

final class MIDIPortMapTests: XCTestCase {
    // Real endpoints cannot be created on the iOS Simulator (MIDISourceCreate
    // returns kMIDIServerNotAvailable), so the map is tested with synthetic refs
    // and an injected id provider. Live CoreMIDI id-derivation is covered by
    // device-level testing of CoreMIDIService.
    private let refA: MIDIEndpointRef = 1001
    private let refB: MIDIEndpointRef = 1002

    private func provider(_ ids: [MIDIEndpointRef: String]) -> (MIDIEndpointRef) -> String? {
        return { ids[$0] }
    }

    func test_rebuild_maps_ids_and_refs() {
        var map = MIDIPortMap()
        map.rebuild(from: [refA, refB], idProvider: provider([refA: "port-A", refB: "port-B"]))

        XCTAssertEqual(map.id(for: refA), "port-A")
        XCTAssertEqual(map.id(for: refB), "port-B")
        XCTAssertNotEqual(map.id(for: refA), map.id(for: refB))
        XCTAssertEqual(map.ref(for: "port-A"), refA)
        XCTAssertEqual(map.ref(for: "port-B"), refB)
        XCTAssertEqual(Set(map.ids), Set(["port-A", "port-B"]))
    }

    func test_rebuild_skips_endpoints_with_nil_id() {
        var map = MIDIPortMap()
        map.rebuild(from: [refA, refB], idProvider: provider([refA: "port-A"]))
        XCTAssertEqual(Set(map.ids), Set(["port-A"]))
        XCTAssertNil(map.id(for: refB))
    }

    func test_rebuild_clears_previous() {
        var map = MIDIPortMap()
        map.rebuild(from: [refA], idProvider: provider([refA: "port-A"]))
        map.rebuild(from: [], idProvider: provider([:]))
        XCTAssertTrue(map.ids.isEmpty)
        XCTAssertNil(map.id(for: refA))
    }
}
