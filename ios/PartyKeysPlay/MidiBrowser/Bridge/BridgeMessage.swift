import Foundation

struct BridgeMessage: Codable, Equatable {
    let id: Int
    let cmd: String
    let payload: Payload

    struct Payload: Codable, Equatable {
        let sysex: Bool?
        let portId: String?
        let data: [Int]?
        let timestamp: Double?
    }
}

struct AccessSnapshot: Codable, Equatable {
    let inputs: [PortInfo]
    let outputs: [PortInfo]

    struct PortInfo: Codable, Equatable {
        let id: String
        let name: String
        let manufacturer: String
        let version: String
    }
}
