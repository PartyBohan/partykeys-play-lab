import Foundation

struct MIDIBatchEntry: Equatable {
    let portId: String
    let bytes: [UInt8]
    let timestamp: Double
}

final class MIDIBatcher {
    private var buffer: [MIDIBatchEntry] = []
    private let lock = NSLock()

    func append(_ entry: MIDIBatchEntry) {
        lock.lock(); defer { lock.unlock() }
        buffer.append(entry)
    }

    func flush() -> [MIDIBatchEntry] {
        lock.lock(); defer { lock.unlock() }
        let out = buffer
        buffer.removeAll(keepingCapacity: true)
        return out
    }
}
