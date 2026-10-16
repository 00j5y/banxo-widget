import SwiftUI
import BanxoCore

struct BalanceCard: View {
    let snapshot: BalanceSnapshot?
    var offline = false
    var unauthorized = false
    var now = Date.now
    var compact = false
    private var status: BalanceStatus { unauthorized ? .reconnectRequired : snapshot?.effectiveStatus(at: now) ?? .notConnected }
    private var statusText: String {
        switch status {
        case .ready: offline ? "Hors ligne" : "À jour"
        case .stale: offline ? "Hors ligne · Données anciennes" : "Données anciennes"
        case .reconnectRequired: "Reconnecter la banque"
        case .notConnected: "Configurer Banxo"
        case .error: "Synchronisation indisponible"
        }
    }
    private var kindLabel: String {
        switch snapshot?.balanceKind {
        case .booked: "Solde comptable"
        case .available: "Solde disponible"
        case nil: "Solde"
        }
    }
    private var amount: String {
        guard let snapshot, let value = snapshot.amount else { return "--" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency; formatter.currencyCode = snapshot.currency
        formatter.locale = .current
        return formatter.string(from: NSDecimalNumber(decimal: value)) ?? "--"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 8 : 14) {
            HStack {
                Image(systemName: "building.columns.fill").foregroundStyle(.teal)
                Text(snapshot?.accountLabel ?? "Votre compte").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
            }
            Text(amount).font(.system(size: compact ? 27 : 40, weight: .semibold, design: .rounded))
                .minimumScaleFactor(0.45).lineLimit(1).privacySensitive()
                .accessibilityLabel("Solde \(amount)")
            if !compact { Text(kindLabel).font(.caption).foregroundStyle(.secondary) }
            Spacer(minLength: 0)
            Label(statusText, systemImage: status == .ready && !offline ? "checkmark.circle.fill" : "clock")
                .font(.caption2).foregroundStyle(status == .ready && !offline ? Color.teal : Color.secondary)
            if let date = snapshot?.fetchedAt {
                Text(date, format: .dateTime.day().month().hour().minute()).font(.caption2).foregroundStyle(.secondary)
            } else { Text("Aucune synchronisation").font(.caption2).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
