import SwiftUI

struct HealthKitAccessPlan: Equatable, Sendable {
    let workouts: IntegrationDirectionSelection
    let weight: IntegrationDirectionSelection
    let sleep: IntegrationDirectionSelection
    let sexualActivity: IntegrationDirectionSelection
    let revisionKey: Int

    static let denied = HealthKitAccessPlan(
        workouts: .denied,
        weight: .denied,
        sleep: .denied,
        sexualActivity: .denied,
        revisionKey: 0
    )

    var hasAnyAccess: Bool {
        [workouts, weight, sleep, sexualActivity].contains { selection in
            selection.readEnabled || selection.writeEnabled
        }
    }

    func includingSexualActivity(_ enabled: Bool) -> HealthKitAccessPlan {
        guard !enabled else { return self }
        return HealthKitAccessPlan(
            workouts: workouts,
            weight: weight,
            sleep: sleep,
            sexualActivity: .denied,
            revisionKey: revisionKey
        )
    }
}

enum IntegrationDataAccessLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

@MainActor
final class IntegrationDataAccessStore: ObservableObject {
    static let shared = IntegrationDataAccessStore()

    @Published private(set) var sources: [IntegrationDataSource] = []
    @Published private(set) var loadState: IntegrationDataAccessLoadState = .idle
    @Published private(set) var revision = 0
    @Published private(set) var prioritizedSourceID: String?
    @Published private(set) var presentedSourceID: String?

    private var loadedUserID: String?
    private var loadGeneration = 0

    var requiredSource: IntegrationDataSource? {
        let pending = sources.filter { source in
            source.connected
                && source.needsAccessConfiguration
                && source.id != presentedSourceID
        }
        if let prioritizedSourceID,
           let prioritized = pending.first(where: { $0.id == prioritizedSourceID }) {
            return prioritized
        }
        return pending.first
    }

    var errorMessage: String? {
        guard case .failed(let message) = loadState else { return nil }
        return message
    }

    func source(id: String) -> IntegrationDataSource? {
        sources.first { $0.id == id }
    }

    func loadIfNeeded(api: APIClient, userID: String) async {
        let normalizedUserID = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserID.isEmpty else {
            reset()
            return
        }
        if loadedUserID == normalizedUserID,
           (loadState == .loaded || loadState == .loading) {
            return
        }
        await refresh(api: api, userID: normalizedUserID)
    }

    func refresh(
        api: APIClient,
        userID: String,
        prioritizing sourceID: String? = nil
    ) async {
        let normalizedUserID = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserID.isEmpty else {
            reset()
            return
        }

        if loadedUserID != normalizedUserID {
            sources = []
            prioritizedSourceID = nil
            presentedSourceID = nil
            revision &+= 1
        }
        loadedUserID = normalizedUserID
        if let sourceID {
            prioritizedSourceID = sourceID
        }

        loadGeneration &+= 1
        let generation = loadGeneration
        loadState = .loading

        do {
            let response = try await api.getIntegrationDataAccess()
            guard generation == loadGeneration, loadedUserID == normalizedUserID else { return }
            apply(response, userID: normalizedUserID, prioritizing: sourceID)
        } catch {
            guard generation == loadGeneration, loadedUserID == normalizedUserID else { return }
            failClosed(error.localizedDescription)
        }
    }

    @discardableResult
    func save(
        sourceID: String,
        selections: [String: IntegrationDirectionSelection],
        api: APIClient
    ) async throws -> IntegrationDataSource {
        guard let currentSource = source(id: sourceID) else {
            throw APIError.serverError("This data source is no longer available.")
        }

        let updates = currentSource.dataTypes.map { dataType in
            let selection = selections[dataType.id] ?? dataType.selection ?? .denied
            return IntegrationDataTypeUpdate(
                id: dataType.id,
                readEnabled: dataType.read.supported && selection.readEnabled,
                writeEnabled: dataType.write.supported && selection.writeEnabled
            )
        }
        let updatedSource = try await api.updateIntegrationDataAccess(
            sourceID: sourceID,
            dataTypes: updates
        )
        replace(updatedSource)
        if prioritizedSourceID == sourceID, !updatedSource.needsAccessConfiguration {
            prioritizedSourceID = nil
        }
        if presentedSourceID == sourceID, !updatedSource.needsAccessConfiguration {
            presentedSourceID = nil
        }
        loadState = .loaded
        return updatedSource
    }

    func prioritizeSource(id: String) {
        prioritizedSourceID = id
    }

    func beginPresentation(for sourceID: String) {
        prioritizedSourceID = sourceID
        presentedSourceID = sourceID
    }

    func endPresentation(for sourceID: String) {
        if presentedSourceID == sourceID {
            presentedSourceID = nil
        }
    }

    func healthKitAccessPlan(includeSexualActivity: Bool) -> HealthKitAccessPlan {
        guard loadState == .loaded,
              let source = sources.first(where: { $0.isHealthKitSource }),
              source.connected,
              source.available,
              !source.needsAccessConfiguration else {
            return HealthKitAccessPlan(
                workouts: .denied,
                weight: .denied,
                sleep: .denied,
                sexualActivity: .denied,
                revisionKey: revision
            )
        }

        let plan = HealthKitAccessPlan(
            workouts: source.effectiveSelection(forAnyID: ["workouts", "workout"]),
            weight: source.effectiveSelection(forAnyID: ["weight", "body_mass"]),
            sleep: source.effectiveSelection(forAnyID: ["sleep"]),
            sexualActivity: source.effectiveSelection(
                forAnyID: ["sexual_activity", "sexualActivity"]
            ),
            revisionKey: revision
        )
        return plan.includingSexualActivity(includeSexualActivity)
    }

    func apply(
        _ response: IntegrationDataAccessResponse,
        userID: String,
        prioritizing sourceID: String? = nil
    ) {
        loadedUserID = userID
        if let sourceID {
            prioritizedSourceID = sourceID
        }
        if sources != response.sources {
            sources = response.sources
            revision &+= 1
        }
        loadState = .loaded
    }

    func reset() {
        loadGeneration &+= 1
        loadedUserID = nil
        prioritizedSourceID = nil
        presentedSourceID = nil
        loadState = .idle
        if !sources.isEmpty {
            sources = []
            revision &+= 1
        }
    }

    private func replace(_ updatedSource: IntegrationDataSource) {
        if let index = sources.firstIndex(where: { $0.id == updatedSource.id }) {
            guard sources[index] != updatedSource else { return }
            sources[index] = updatedSource
        } else {
            sources.append(updatedSource)
        }
        revision &+= 1
    }

    private func failClosed(_ message: String) {
        if !sources.isEmpty {
            sources = []
            revision &+= 1
        }
        loadState = .failed(message)
    }
}

extension IntegrationDataSource {
    var needsAccessConfiguration: Bool {
        configurationRequired || dataTypes.contains { $0.selection == nil }
    }

    var enabledDirectionCount: Int {
        dataTypes.reduce(0) { count, dataType in
            guard let selection = dataType.selection else { return count }
            return count
                + (dataType.read.supported && selection.readEnabled ? 1 : 0)
                + (dataType.write.supported && selection.writeEnabled ? 1 : 0)
        }
    }

    fileprivate var isHealthKitSource: Bool {
        let normalized = id.lowercased().replacingOccurrences(of: "-", with: "_")
        return ["healthkit", "apple_health", "applehealth"].contains(normalized)
    }

    fileprivate func effectiveSelection(forAnyID ids: [String]) -> IntegrationDirectionSelection {
        let normalizedIDs = Set(ids.map {
            $0.lowercased().replacingOccurrences(of: "-", with: "_")
        })
        guard let dataType = dataTypes.first(where: {
            normalizedIDs.contains($0.id.lowercased().replacingOccurrences(of: "-", with: "_"))
        }), let selection = dataType.selection else {
            return .denied
        }
        return IntegrationDirectionSelection(
            readEnabled: dataType.read.supported && selection.readEnabled,
            writeEnabled: dataType.write.supported && selection.writeEnabled
        )
    }
}

struct IntegrationDataAccessGate<Content: View>: View {
    @ObservedObject var store: IntegrationDataAccessStore
    @EnvironmentObject private var api: APIClient

    let userID: String
    private let content: () -> Content

    init(
        store: IntegrationDataAccessStore,
        userID: String,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.store = store
        self.userID = userID
        self.content = content
    }

    var body: some View {
        Group {
            switch store.loadState {
            case .idle:
                loadingView
            case .loading where store.sources.isEmpty:
                loadingView
            case .loaded:
                if let source = store.requiredSource {
                    NavigationStack {
                        IntegrationDataAccessView(sourceID: source.id, isRequired: true)
                            .id(source.id)
                    }
                } else {
                    content()
                }
            case .loading, .failed(_):
                // A refresh failure never grants integration access. Keep the
                // rest of the app usable while every provider plan stays denied.
                content()
            }
        }
        .task(id: userID) {
            await store.loadIfNeeded(api: api, userID: userID)
        }
    }

    private var loadingView: some View {
        VStack(spacing: AppVisualSystem.Spacing.medium) {
            ProgressView()
            Text("Loading data access…")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .appScreenBackground()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Loading macrovana data access settings")
    }
}

struct IntegrationDataAccessView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var api: APIClient
    @ObservedObject private var store = IntegrationDataAccessStore.shared

    let sourceID: String
    let isRequired: Bool

    @State private var selections: [String: IntegrationDirectionSelection] = [:]
    @State private var didHydrate = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var source: IntegrationDataSource? {
        store.source(id: sourceID)
    }

    var body: some View {
        Group {
            if let source {
                List {
                    introductionSection(source)

                    ForEach(source.dataTypes) { dataType in
                        dataTypeSection(dataType, source: source)
                    }

                    actionSection(source)
                }
                .scrollContentBackground(.hidden)
                .appScreenBackground()
                .navigationTitle("\(source.displayName) Data Access")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if !isRequired {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { dismiss() }
                        }
                    }
                }
                .onAppear {
                    hydrateSelectionsIfNeeded(from: source)
                }
            } else {
                ContentUnavailableView(
                    "Data Source Unavailable",
                    systemImage: "externaldrive.badge.questionmark",
                    description: Text("Reload Data Sources in Settings and try again.")
                )
            }
        }
        .interactiveDismissDisabled(isRequired)
        .alert(
            "Data Access",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func introductionSection(_ source: IntegrationDataSource) -> some View {
        Section {
            Text("Choose how macrovana may exchange each type of data with \(source.displayName). You can change these choices later in Settings.")

            if !source.connected {
                Label("Connect \(source.displayName) before choosing data access.", systemImage: "link.badge.plus")
                    .foregroundStyle(.secondary)
            } else if !source.available {
                Label(
                    source.unavailableReason ?? "This data source is unavailable on this device.",
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.orange)
            } else if source.needsAccessConfiguration {
                Label("Your choice is required before macrovana uses this data source.", systemImage: "hand.raised.fill")
                    .foregroundStyle(AppVisualSystem.ColorToken.accent)
            }
        } header: {
            Text("About Data Access")
        } footer: {
            Text("Read means \(source.displayName) to macrovana. Write means macrovana to \(source.displayName). Turning access off stops future transfers; it does not silently delete existing records.")
        }
    }

    private func dataTypeSection(
        _ dataType: IntegrationDataType,
        source: IntegrationDataSource
    ) -> some View {
        Section {
            if let detail = dataType.detail, !detail.isEmpty {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            directionControl(
                label: "Read from \(source.displayName)",
                direction: .read,
                capability: dataType.read,
                dataType: dataType,
                source: source
            )
            directionControl(
                label: "Write to \(source.displayName)",
                direction: .write,
                capability: dataType.write,
                dataType: dataType,
                source: source
            )
        } header: {
            Text(dataType.displayName)
        }
    }

    @ViewBuilder
    private func directionControl(
        label: String,
        direction: IntegrationAccessDirection,
        capability: IntegrationDirectionCapability,
        dataType: IntegrationDataType,
        source: IntegrationDataSource
    ) -> some View {
        if capability.supported {
            Toggle(
                label,
                isOn: selectionBinding(for: dataType, direction: direction)
            )
            .disabled(isSaving || !source.connected || !source.available)
            .accessibilityHint("Controls \(dataType.displayName) access")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label)
                    Spacer()
                    Label("Not supported", systemImage: "lock.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                if let reason = capability.disabledReason, !reason.isEmpty {
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func actionSection(_ source: IntegrationDataSource) -> some View {
        Section {
            Button {
                Task { await save(source: source, denyAll: false) }
            } label: {
                HStack {
                    Spacer()
                    if isSaving {
                        ProgressView()
                    } else {
                        Text("Save Choices")
                            .fontWeight(.semibold)
                    }
                    Spacer()
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSaving || !source.connected)

            if isRequired {
                Button("Continue Without Access") {
                    Task { await save(source: source, denyAll: true) }
                }
                .disabled(isSaving || !source.connected)
                .frame(maxWidth: .infinity, alignment: .center)
            }
        } footer: {
            if isRequired {
                Text("Continue Without Access saves an explicit no-access choice, so macrovana will not keep asking unless this source adds a new data type.")
            }
        }
    }

    private func selectionBinding(
        for dataType: IntegrationDataType,
        direction: IntegrationAccessDirection
    ) -> Binding<Bool> {
        Binding(
            get: {
                let selection = selections[dataType.id] ?? dataType.selection ?? .denied
                return direction == .read ? selection.readEnabled : selection.writeEnabled
            },
            set: { enabled in
                let current = selections[dataType.id] ?? dataType.selection ?? .denied
                selections[dataType.id] = IntegrationDirectionSelection(
                    readEnabled: direction == .read ? enabled : current.readEnabled,
                    writeEnabled: direction == .write ? enabled : current.writeEnabled
                )
            }
        )
    }

    private func hydrateSelectionsIfNeeded(from source: IntegrationDataSource) {
        guard !didHydrate else { return }
        selections = Dictionary(uniqueKeysWithValues: source.dataTypes.map { dataType in
            (dataType.id, dataType.selection ?? .denied)
        })
        didHydrate = true
    }

    private func save(source: IntegrationDataSource, denyAll: Bool) async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        var requestedSelections = selections
        if denyAll {
            requestedSelections = Dictionary(uniqueKeysWithValues: source.dataTypes.map {
                ($0.id, IntegrationDirectionSelection.denied)
            })
        }

        do {
            _ = try await store.save(
                sourceID: source.id,
                selections: requestedSelections,
                api: api
            )
            if !isRequired {
                dismiss()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum IntegrationAccessDirection {
    case read
    case write
}

struct IntegrationDataSourceRow: View {
    let source: IntegrationDataSource

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: sourceSystemImage)
                .foregroundStyle(source.connected ? AppVisualSystem.ColorToken.accent : .secondary)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(source.displayName)
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(statusColor)
            }

            Spacer()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(source.displayName), \(statusText)")
    }

    private var sourceSystemImage: String {
        let normalized = source.id.lowercased()
        if normalized.contains("health") { return "heart.fill" }
        if normalized.contains("oura") { return "circle.circle.fill" }
        return "externaldrive.connected.to.line.below"
    }

    private var statusText: String {
        if !source.connected { return "Not connected" }
        if !source.available { return "Unavailable" }
        if source.needsAccessConfiguration { return "Review required" }
        if source.enabledDirectionCount == 0 { return "No access" }
        let suffix = source.enabledDirectionCount == 1 ? "direction" : "directions"
        return "\(source.enabledDirectionCount) \(suffix) enabled"
    }

    private var statusColor: Color {
        if source.needsAccessConfiguration { return .orange }
        if source.enabledDirectionCount > 0 { return AppVisualSystem.ColorToken.success }
        return .secondary
    }
}
