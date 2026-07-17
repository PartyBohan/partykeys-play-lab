import Foundation
import CoreMIDI

final class CoreMIDIService {
    var onPacket: ((MIDIBatchEntry) -> Void)?
    var onDevicesChanged: (() -> Void)?

    private var client = MIDIClientRef()
    private var inPort = MIDIPortRef()
    private var outPort = MIDIPortRef()
    private var inputMap = MIDIPortMap()
    private var outputMap = MIDIPortMap()
    private var sourceBoxes: [MIDIEndpointRef: SourceBox] = [:]
    private var started = false
    private var refreshWorkItem: DispatchWorkItem?

    // Retained refcon so the read block can recover the source endpoint.
    private final class SourceBox { let ref: MIDIEndpointRef; init(_ r: MIDIEndpointRef) { self.ref = r } }

    func start() {
        guard !started else { return }
        started = true

        let notify: MIDINotifyBlock = { [weak self] _ in
            DispatchQueue.main.async { self?.scheduleRefresh() }
        }
        MIDIClientCreateWithBlock("MidiBrowser" as CFString, &client, notify)

        MIDIInputPortCreateWithBlock(client, "Input" as CFString, &inPort) { [weak self] pktList, refcon in
            self?.handle(pktList, refcon: refcon)
        }
        MIDIOutputPortCreate(client, "Output" as CFString, &outPort)

        refresh()
    }

    func stop() {
        guard started else { return }
        started = false
        MIDIPortDispose(inPort)
        MIDIPortDispose(outPort)
        MIDIClientDispose(client)
        sourceBoxes.removeAll()
    }

    /// Coalesce hot-plug notifications: CoreMIDI fires several during one
    /// connect/disconnect, and a transient mid-event refresh can momentarily
    /// see 0 endpoints and wipe consumers. Wait for a quiet window, then refresh.
    private func scheduleRefresh() {
        refreshWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.refresh() }
        refreshWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    private func refresh() {
        // Inputs = all sources, minus iOS auto-created "Session N" endpoints.
        let srcCount = MIDIGetNumberOfSources()
        var srcs: [MIDIEndpointRef] = []
        for i in 0..<srcCount {
            let ref = MIDIGetSource(i)
            if isSystemSession(ref) { continue }
            srcs.append(ref)
        }
        inputMap.rebuild(from: srcs)
        for ref in srcs { connectSource(ref) }

        // Outputs = all destinations, minus "Session N".
        let dstCount = MIDIGetNumberOfDestinations()
        var dsts: [MIDIEndpointRef] = []
        for i in 0..<dstCount {
            let ref = MIDIGetDestination(i)
            if isSystemSession(ref) { continue }
            dsts.append(ref)
        }
        outputMap.rebuild(from: dsts)

        onDevicesChanged?()
    }

    /// iOS CoreMIDI auto-creates a virtual "Session N" endpoint per app for
    /// Network/inter-app MIDI. It is not a hardware device, so hide it from
    /// the Web MIDI surface.
    static func isSessionEndpointName(_ name: String) -> Bool {
        guard name.hasPrefix("Session ") else { return false }
        let rest = name.dropFirst("Session ".count)
        return !rest.isEmpty && rest.allSatisfy(\.isNumber)
    }

    private func isSystemSession(_ ref: MIDIEndpointRef) -> Bool {
        Self.isSessionEndpointName(stringProp(ref, kMIDIPropertyName) ?? "")
    }

    private func connectSource(_ ref: MIDIEndpointRef) {
        guard sourceBoxes[ref] == nil else { return }
        let box = SourceBox(ref)
        sourceBoxes[ref] = box
        let refcon = Unmanaged.passUnretained(box).toOpaque()
        MIDIPortConnectSource(inPort, ref, refcon)
    }

    private func handle(_ pktList: UnsafePointer<MIDIPacketList>, refcon: UnsafeMutableRawPointer?) {
        guard let raw = refcon,
              let box = Unmanaged<SourceBox>.fromOpaque(raw).takeUnretainedValue() as SourceBox?,
              let portId = inputMap.id(for: box.ref) else { return }
        let packetCount = Int(pktList.pointee.numPackets)
        var packet = UnsafeMutablePointer<MIDIPacket>(mutating: withUnsafePointer(to: pktList.pointee.packet) { $0 })
        let now = Date().timeIntervalSince1970 * 1000
        for i in 0..<packetCount {
            let length = Int(packet.pointee.length)
            let bytes = withUnsafeBytes(of: packet.pointee.data) { ptr -> [UInt8] in
                Array(ptr.prefix(length))
            }
            onPacket?(MIDIBatchEntry(portId: portId, bytes: bytes, timestamp: now))
            if i + 1 < packetCount {
                packet = UnsafeMutablePointer<MIDIPacket>(mutating: MIDIPacketNext(packet))
            }
        }
    }

    func send(portId: String, data: [UInt8]) {
        guard let dest = outputMap.ref(for: portId), !data.isEmpty, data.count <= 256 else { return }
        var packetList = MIDIPacketList()
        var packet = MIDIPacket()
        packet.timeStamp = 0
        packet.length = UInt16(data.count)
        withUnsafeMutableBytes(of: &packet.data) { ptr in
            for i in 0..<data.count { ptr[i] = data[i] }
        }
        packetList.numPackets = 1
        packetList.packet = packet
        MIDISend(outPort, dest, &packetList)
    }

    func snapshot() -> AccessSnapshot {
        AccessSnapshot(inputs: portInfos(map: inputMap, isInput: true),
                       outputs: portInfos(map: outputMap, isInput: false))
    }

    private func portInfos(map: MIDIPortMap, isInput: Bool) -> [AccessSnapshot.PortInfo] {
        map.ids.compactMap { id in
            guard let ref = map.ref(for: id) else { return nil }
            return AccessSnapshot.PortInfo(
                id: id,
                name: stringProp(ref, kMIDIPropertyName) ?? "Unknown",
                manufacturer: stringProp(ref, kMIDIPropertyManufacturer) ?? "",
                version: stringProp(ref, kMIDIPropertyDriverVersion) ?? "1"
            )
        }
    }

    private func stringProp(_ ref: MIDIEndpointRef, _ prop: CFString) -> String? {
        var value: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(ref, prop, &value) == noErr else { return nil }
        return value?.takeUnretainedValue() as String?
    }
}
