import SwiftUI

@main
struct PartyKeysPlayApp: App {
    var body: some Scene {
        WindowGroup {
            BrowserScreen()
                .preferredColorScheme(.dark)
        }
    }
}
