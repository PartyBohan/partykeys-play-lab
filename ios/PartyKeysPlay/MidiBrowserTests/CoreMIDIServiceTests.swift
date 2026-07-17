import XCTest
import CoreMIDI
@testable import MidiBrowser

final class CoreMIDIServiceTests: XCTestCase {
    func test_session_endpoint_name_filtering() {
        XCTAssertTrue(CoreMIDIService.isSessionEndpointName("Session 1"))
        XCTAssertTrue(CoreMIDIService.isSessionEndpointName("Session 12"))
        XCTAssertFalse(CoreMIDIService.isSessionEndpointName("蓝牙"))
        XCTAssertFalse(CoreMIDIService.isSessionEndpointName("Keystation 49"))
        XCTAssertFalse(CoreMIDIService.isSessionEndpointName("Session Pro"))
        XCTAssertFalse(CoreMIDIService.isSessionEndpointName("Session"))
        XCTAssertFalse(CoreMIDIService.isSessionEndpointName(""))
    }

    // CoreMIDI's server is unavailable to sandboxed apps on the iOS Simulator
    // (MIDISourceCreate returns kMIDIServerNotAvailable = -10844). This is a
    // device-only integration test; skip it when no virtual source can be created.
    func test_receives_packet_from_virtual_source() throws {
        var client = MIDIClientRef()
        MIDIClientCreate("test-inject" as CFString, nil, nil, &client)
        var src = MIDIEndpointRef()
        let createStatus = MIDISourceCreate(client, "TestKey" as CFString, &src)
        try XCTSkipUnless(createStatus == noErr && src != 0,
                          "CoreMIDI server unavailable (simulator); run on device")

        let service = CoreMIDIService()
        service.start()

        let exp = expectation(description: "packet")
        var received: MIDIBatchEntry?
        service.onPacket = { entry in
            received = entry
            exp.fulfill()
        }

        // Give the service a moment to discover the new source via notify.
        Thread.sleep(forTimeInterval: 0.2)

        var packetList = MIDIPacketList()
        var packet = MIDIPacket()
        packet.timeStamp = 0
        packet.length = 3
        let bytes: [UInt8] = [0x90, 60, 100]
        withUnsafeMutableBytes(of: &packet.data) { ptr in
            for i in 0..<bytes.count { ptr[i] = bytes[i] }
        }
        packetList.numPackets = 1
        packetList.packet = packet
        MIDIReceived(src, &packetList)

        wait(for: [exp], timeout: 2.0)
        XCTAssertEqual(received?.bytes, [0x90, 60, 100])

        service.stop()
    }
}
