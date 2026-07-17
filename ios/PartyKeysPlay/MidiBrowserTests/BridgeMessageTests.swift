import XCTest
@testable import MidiBrowser

final class BridgeMessageTests: XCTestCase {
    func test_decodes_send_command() throws {
        let json = #"{"id":1,"cmd":"send","payload":{"portId":"p1","data":[144,60,100],"timestamp":0}}"#.data(using: .utf8)!
        let msg = try JSONDecoder().decode(BridgeMessage.self, from: json)
        XCTAssertEqual(msg.id, 1)
        XCTAssertEqual(msg.cmd, "send")
        XCTAssertEqual(msg.payload.portId, "p1")
        XCTAssertEqual(msg.payload.data, [144, 60, 100])
        XCTAssertEqual(msg.payload.timestamp, 0)
    }

    func test_decodes_access_command() throws {
        let json = #"{"id":2,"cmd":"access","payload":{"sysex":false}}"#.data(using: .utf8)!
        let msg = try JSONDecoder().decode(BridgeMessage.self, from: json)
        XCTAssertEqual(msg.cmd, "access")
        XCTAssertEqual(msg.payload.sysex, false)
    }

    func test_encodes_snapshot() throws {
        let snap = AccessSnapshot(
            inputs: [AccessSnapshot.PortInfo(id: "i", name: "In", manufacturer: "M", version: "1")],
            outputs: []
        )
        let data = try JSONEncoder().encode(snap)
        let decoded = try JSONDecoder().decode(AccessSnapshot.self, from: data)
        XCTAssertEqual(decoded, snap)
    }
}
