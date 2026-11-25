import GRDB
import Persistence
import SwiftUI

/// Renders `content` with a database value that stays current as writes land.
struct Live<Value: Sendable, Content: View>: View {
    @Environment(AppModel.self) private var app
    @State private var value: Value?
    @State private var failure: String?

    let key: String
    let fetch: @Sendable (Database) throws -> Value
    @ViewBuilder let content: (Value) -> Content

    /// - Parameter key: change it when `fetch` depends on new inputs, to restart observation.
    init(key: String = "", _ fetch: @escaping @Sendable (Database) throws -> Value, @ViewBuilder content: @escaping (Value) -> Content) {
        self.key = key
        self.fetch = fetch
        self.content = content
    }

    var body: some View {
        Group {
            if let value {
                content(value)
            } else if let failure {
                EmptyState(symbol: "exclamationmark.triangle", title: "Couldn't load", message: failure)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: key) {
            do {
                for try await next in app.database.observe(fetch) {
                    value = next
                }
            } catch {
                failure = AppModel.describe(error)
            }
        }
    }
}
