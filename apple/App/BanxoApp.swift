import SwiftUI
import WidgetKit
import BanxoCore

@main
struct BanxoApp: App {
    var body: some Scene { WindowGroup { SetupView() } }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var serverURL = ""
    @Published var token = ""
    @Published var snapshot: BalanceSnapshot?
    @Published var offline = false
    @Published var unauthorized = false
    @Published var busy = false
    @Published var message: String?
    private var operation = UUID()
    func load() async {
        do {
            guard let config = try DeviceStore.load() else { snapshot = nil; token = ""; return }
            serverURL = config.serverURL.absoluteString; token = config.token
            let cached = try await DeviceStore.cache(configuration: config).load(ifCurrent: { DeviceStore.isCurrent(config.revision) })
            if DeviceStore.isCurrent(config.revision) { snapshot = cached }
        } catch { snapshot = nil; message = "Stockage partagé indisponible. Vérifiez la signature de l’app." }
    }
    func saveAndRefresh() async {
        let requestID = UUID(); operation = requestID
        busy = true; defer { if operation == requestID { busy = false } }
        do {
            let candidate = try ServerConfiguration(serverURL: serverURL.trimmingCharacters(in: .whitespacesAndNewlines), token: token, allowLocalHTTP: DeviceStore.localHTTP)
            let previous = try DeviceStore.load()
            let config = previous.flatMap { $0.serverURL == candidate.serverURL && $0.token == candidate.token ? $0 : nil } ?? candidate
            if previous?.revision != config.revision { snapshot = nil; offline = false; unauthorized = false }
            try DeviceStore.save(config)
            WidgetCenter.shared.reloadAllTimelines()
            let result = await BalanceRepository(cache: try DeviceStore.cache(configuration: config), configurationIsCurrent: { DeviceStore.isCurrent($0) }).refresh(configuration: config)
            guard operation == requestID, DeviceStore.isCurrent(config.revision) else { return }
            snapshot = result.snapshot; offline = result.isOffline; unauthorized = result.unauthorized
            message = result.unauthorized ? "Jeton refusé. Vérifiez la configuration du serveur." : result.isOffline ? "Serveur indisponible. Aucun nouveau solde reçu." : nil
            WidgetCenter.shared.reloadAllTimelines()
        } catch { if operation == requestID { message = "Configuration invalide ou stockage sécurisé indisponible." } }
    }
    func disconnect() async {
        operation = UUID()
        token = ""; snapshot = nil; offline = false; unauthorized = false; message = nil; busy = false
        do { try DeviceStore.clear() }
        catch { message = "La suppression locale a échoué. Réessayez la déconnexion." }
        WidgetCenter.shared.reloadAllTimelines()
    }

}

struct SetupView: View {
    @StateObject private var model = AppModel()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Banxo").font(.largeTitle.bold())
                    Text("Votre solde, d’un coup d’œil.").foregroundStyle(.secondary)
                }
                BalanceCard(snapshot: model.snapshot, offline: model.offline, unauthorized: model.unauthorized)
                    .padding(24).frame(height: 230).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
                VStack(alignment: .leading, spacing: 12) {
                    Text("Connexion au serveur").font(.headline)
                    TextField("https://banxo.exemple.fr", text: $model.serverURL)
                        .textContentType(.URL).autocorrectionDisabled()
                    SecureField("Jeton de l’appareil", text: $model.token).autocorrectionDisabled()
                    Text("Le jeton est conservé dans le trousseau de cet appareil. Configurez le Mac séparément.")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("Enregistrer et actualiser") { Task { await model.saveAndRefresh() } }.buttonStyle(.borderedProminent)
                        if model.busy { ProgressView().controlSize(.small) }
                    }
                    .disabled(model.busy)
                    Button("Déconnecter cet appareil", role: .destructive) { Task { await model.disconnect() } }
                }
                .textFieldStyle(.roundedBorder)
                if let message = model.message { Text(message).font(.callout).foregroundStyle(.secondary).accessibilityAddTraits(.updatesFrequently) }
                Text("Le widget demande une actualisation toutes les 30 minutes. iOS et macOS choisissent l’heure réelle. Après 8 heures, le solde est signalé comme ancien.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(28).frame(maxWidth: 560)
        }
        .tint(.teal).frame(minWidth: 330, minHeight: 580)
        .task { await model.load() }
        .onOpenURL { _ in Task { await model.load() } }
    }
}
