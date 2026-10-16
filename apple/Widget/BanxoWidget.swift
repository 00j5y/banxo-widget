import WidgetKit
import SwiftUI
import BanxoCore

struct BalanceEntry: TimelineEntry {
    let date: Date
    let snapshot: BalanceSnapshot?
    var offline = false
    var unauthorized = false
}
struct BalanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> BalanceEntry { BalanceEntry(date: .now, snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping @Sendable (BalanceEntry) -> Void) {
        // La galerie ne déclenche jamais de requête bancaire et n'invente aucun solde.
        Task {
            var snapshot: BalanceSnapshot?
            if let config = try? DeviceStore.load() {
                snapshot = try? await DeviceStore.cache(configuration: config).load(ifCurrent: { DeviceStore.isCurrent(config.revision) })
                if !DeviceStore.isCurrent(config.revision) { snapshot = nil }
            }
            completion(BalanceEntry(date: .now, snapshot: snapshot))
        }
    }
    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<BalanceEntry>) -> Void) {
        Task {
            var entry = BalanceEntry(date: .now, snapshot: nil)
            do {
                if let config = try DeviceStore.load() {
                    let cache = try DeviceStore.cache(configuration: config)
                    let result = await BalanceRepository(cache: cache, configurationIsCurrent: { DeviceStore.isCurrent($0) }).refresh(configuration: config)
                    if DeviceStore.isCurrent(config.revision) {
                        entry = BalanceEntry(date: .now, snapshot: result.snapshot, offline: result.isOffline, unauthorized: result.unauthorized)
                    }
                }
            } catch { entry = BalanceEntry(date: .now, snapshot: entry.snapshot, offline: true) }
            // Une entrée au seuil des 8 h garantit le changement visuel même sans nouvelle requête.
            var entries = [entry]
            if let fetched = entry.snapshot?.fetchedAt, fetched.addingTimeInterval(8 * 3600) > entry.date {
                entries.append(BalanceEntry(date: fetched.addingTimeInterval(8 * 3600), snapshot: entry.snapshot, offline: entry.offline, unauthorized: entry.unauthorized))
            }
            completion(Timeline(entries: entries, policy: .after(Date.now.addingTimeInterval(30 * 60))))
        }
    }
}
struct BalanceWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: BalanceEntry
    var body: some View {
        BalanceCard(snapshot: entry.snapshot, offline: entry.offline, unauthorized: entry.unauthorized, now: entry.date, compact: family == .systemSmall)
            .containerBackground(.background, for: .widget)
            .widgetURL(URL(string: "banxo://setup"))
    }
}
@main
struct BanxoWidget: Widget {
    let kind = "BanxoBalance"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BalanceProvider()) { entry in BalanceWidgetView(entry: entry) }
            .configurationDisplayName("Solde Banxo")
            .description("Le dernier solde synchronisé de votre compte.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
