import Foundation

struct OriginAllowlist {
    let patterns: [String]

    func matches(_ url: URL) -> Bool {
        // Sentinel "*" allows every origin. Use sparingly (kiosk lock is void).
        if patterns.contains("*") { return true }
        guard let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased() else { return false }
        for pattern in patterns {
            let parts = pattern.lowercased().components(separatedBy: "://")
            guard parts.count == 2 else { continue }
            let pScheme = parts[0]
            let pHost = parts[1]
            guard pScheme == scheme else { continue }
            if pHost == host { return true }
            if pHost.hasPrefix("*.") {
                let domain = String(pHost.dropFirst(2))
                if host == domain || host.hasSuffix("." + domain) { return true }
            }
        }
        return false
    }
}
