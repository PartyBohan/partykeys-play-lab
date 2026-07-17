import Foundation

enum ConfigLoader {
    static func load(bundledAs name: String = "config") -> AppConfig {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let cfg = try? JSONDecoder().decode(AppConfig.self, from: data)
        else { return .default }
        return cfg
    }
}
