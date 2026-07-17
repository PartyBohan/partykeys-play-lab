import Foundation
import CoreMIDI

struct MIDIPortMap {
    private var idToRef: [String: MIDIEndpointRef] = [:]
    private var refToId: [MIDIEndpointRef: String] = [:]

    // Reads live CoreMIDI properties. Injected in tests so the map logic can be
    // exercised without a CoreMIDI server (unavailable on the iOS Simulator).
    static let defaultIdProvider: (MIDIEndpointRef) -> String? = { ref in
        var uniqueID: Int32 = 0
        MIDIObjectGetIntegerProperty(ref, kMIDIPropertyUniqueID, &uniqueID)
        var nameCF: Unmanaged<CFString>?
        MIDIObjectGetStringProperty(ref, kMIDIPropertyName, &nameCF)
        let name = (nameCF?.takeUnretainedValue() as String?) ?? "unknown"
        return "port-\(uniqueID)-\(name)"
    }

    mutating func rebuild(
        from endpoints: [MIDIEndpointRef],
        idProvider: (MIDIEndpointRef) -> String? = MIDIPortMap.defaultIdProvider
    ) {
        idToRef.removeAll(keepingCapacity: true)
        refToId.removeAll(keepingCapacity: true)
        for ref in endpoints {
            guard let id = idProvider(ref) else { continue }
            idToRef[id] = ref
            refToId[ref] = id
        }
    }

    func ref(for id: String) -> MIDIEndpointRef? { idToRef[id] }
    func id(for ref: MIDIEndpointRef) -> String? { refToId[ref] }
    var ids: [String] { Array(idToRef.keys) }
}
