import XCTest
@testable import MidiBrowser

final class MIDIBatcherTests: XCTestCase {
    func test_flush_returns_and_clears_buffer() {
        let batcher = MIDIBatcher()
        batcher.append(MIDIBatchEntry(portId: "p1", bytes: [0x90, 60, 100], timestamp: 1))
        batcher.append(MIDIBatchEntry(portId: "p1", bytes: [0x80, 60, 0], timestamp: 2))

        let out = batcher.flush()
        XCTAssertEqual(out.count, 2)
        XCTAssertEqual(out[0].bytes, [0x90, 60, 100])
        XCTAssertEqual(out[1].portId, "p1")
        XCTAssertTrue(batcher.flush().isEmpty)
    }

    func test_concurrent_append_is_safe() {
        let batcher = MIDIBatcher()
        let queue = DispatchQueue.global()
        let group = DispatchGroup()
        for _ in 0..<200 {
            group.enter()
            queue.async {
                batcher.append(MIDIBatchEntry(portId: "p", bytes: [1], timestamp: 0))
                group.leave()
            }
        }
        group.wait()
        XCTAssertEqual(batcher.flush().count, 200)
    }
}
