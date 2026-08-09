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

struct IntegrationDataAccessMatrixRow: Identifiable, Equatable {
    let id: String
    let displayName: String
}

enum IntegrationAccessDirection {
    case read
    case write
}

enum IntegrationDataAccessMatrixDirectionState: Equatable {
    case enabled
    case disabled
    case reviewRequired
    case disconnected
    case unavailable(String?)
    case unsupported(String?)
}

func integrationDataAccessMatrixRows(
    for sources: [IntegrationDataSource]
) -> [IntegrationDataAccessMatrixRow] {
    var seenIDs = Set<String>()
    var rows: [IntegrationDataAccessMatrixRow] = []

    for source in sources {
        for dataType in source.dataTypes where seenIDs.insert(dataType.id).inserted {
            rows.append(
                IntegrationDataAccessMatrixRow(
                    id: dataType.id,
                    displayName: dataType.displayName
                )
            )
        }
    }

    return rows
}

func integrationDataAccessMatrixDirectionState(
    for dataType: IntegrationDataType,
    direction: IntegrationAccessDirection,
    source: IntegrationDataSource
) -> IntegrationDataAccessMatrixDirectionState {
    let capability = direction == .read ? dataType.read : dataType.write
    guard capability.supported else {
        return .unsupported(capability.disabledReason)
    }
    guard source.available else {
        return .unavailable(source.unavailableReason)
    }
    guard source.connected else {
        return .disconnected
    }
    guard let selection = dataType.selection else {
        return .reviewRequired
    }
    let enabled = direction == .read ? selection.readEnabled : selection.writeEnabled
    return enabled ? .enabled : .disabled
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

struct IntegrationDataAccessMatrixView: View {
    @EnvironmentObject private var store: IntegrationDataAccessStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var visibleSourceID: String?

    @ScaledMetric(relativeTo: .caption) private var scaledRowLabelWidth: CGFloat = 112
    @ScaledMetric(relativeTo: .caption) private var scaledSourceColumnWidth: CGFloat = 132
    @ScaledMetric(relativeTo: .caption) private var headerHeight: CGFloat = 108
    @ScaledMetric(relativeTo: .caption) private var rowHeight: CGFloat = 82
    @ScaledMetric(relativeTo: .caption) private var matrixBodyMaxHeight: CGFloat = 410

    private var rowLabelWidth: CGFloat {
        min(scaledRowLabelWidth, 124)
    }

    private var sourceColumnWidth: CGFloat {
        min(scaledSourceColumnWidth, 168)
    }

    private var rows: [IntegrationDataAccessMatrixRow] {
        integrationDataAccessMatrixRows(for: store.sources)
    }

    var body: some View {
        Group {
            if store.sources.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: AppVisualSystem.Spacing.standard) {
                        VStack(alignment: .leading, spacing: AppVisualSystem.Spacing.small) {
                            Label("Your data, at a glance", systemImage: "tablecells")
                                .font(.headline)
                                .foregroundStyle(AppVisualSystem.ColorToken.accent)

                            Text(
                                dynamicTypeSize.isAccessibilitySize
                                    ? "Review every source in a large-text list. Open a connected source to change its Read and Write choices."
                                    : "Data types stay on the left while you swipe through sources. Tap a connected source heading to change its Read and Write choices."
                            )
                                .font(.subheadline)
                                .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)

                            Text("Read: source → Macrovana   ·   Write: Macrovana → source")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                        .appSurface(.tinted(AppVisualSystem.ColorToken.accent))

                        if dynamicTypeSize.isAccessibilitySize {
                            accessibilityOverview
                        } else {
                            matrix

                            Text("✓ On   ·   ○ Off   ·   ! Choose   ·   N/A Not supported")
                                .font(.caption)
                                .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
                                .accessibilityLabel("Legend. Checkmark means on. Circle means off. Exclamation mark means choose. N A means not supported.")
                        }

                        Text("Apple Health choices describe what Macrovana may request to transfer. Apple controls native Health authorization separately on this device.")
                            .font(.caption)
                            .foregroundStyle(AppVisualSystem.ColorToken.textTertiary)

                        sourceNotices
                    }
                    .padding(AppVisualSystem.Spacing.standard)
                }
                .appScreenBackground()
            }
        }
        .navigationTitle("Data Sources")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var emptyState: some View {
        ContentUnavailableView(
            "Data Sources Unavailable",
            systemImage: "externaldrive.badge.questionmark",
            description: Text(store.errorMessage ?? "Reload Data Sources in Settings and try again.")
        )
        .appScreenBackground()
    }

    private var accessibilityOverview: some View {
        VStack(alignment: .leading, spacing: AppVisualSystem.Spacing.standard) {
            Text("Large Text Overview")
                .font(.headline)
                .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)

            ForEach(store.sources) { source in
                VStack(alignment: .leading, spacing: AppVisualSystem.Spacing.medium) {
                    accessibilitySourceHeader(source)

                    ForEach(rows) { row in
                        accessibilityDataTypeRow(source: source, row: row)
                    }
                }
                .appSurface(.standard)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("integration-data-access-accessibility-overview")
    }

    @ViewBuilder
    private func accessibilitySourceHeader(_ source: IntegrationDataSource) -> some View {
        if source.connected {
            NavigationLink {
                IntegrationDataAccessView(sourceID: source.id, isRequired: false)
            } label: {
                accessibilitySourceHeaderContent(source, showsDisclosure: true)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens Read and Write choices for this source")
        } else {
            accessibilitySourceHeaderContent(source, showsDisclosure: false)
                .accessibilityElement(children: .combine)
                .accessibilityHint(sourceNotice(source))
        }
    }

    private func accessibilitySourceHeaderContent(
        _ source: IntegrationDataSource,
        showsDisclosure: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: AppVisualSystem.Spacing.medium) {
            Image(systemName: sourceSystemImage(source))
                .font(.title3.weight(.semibold))
                .foregroundStyle(sourceStatusTint(source))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(source.displayName)
                    .font(.headline)
                    .foregroundStyle(.primary)

                Text(sourceStatusText(source))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(sourceStatusTint(source))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            if showsDisclosure {
                Image(systemName: "chevron.right")
                    .foregroundStyle(AppVisualSystem.ColorToken.accent)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func accessibilityDataTypeRow(
        source: IntegrationDataSource,
        row: IntegrationDataAccessMatrixRow
    ) -> some View {
        VStack(alignment: .leading, spacing: AppVisualSystem.Spacing.small) {
            Text(row.displayName)
                .font(.headline)
                .foregroundStyle(.primary)

            if let dataType = source.dataTypes.first(where: { $0.id == row.id }) {
                if let detail = dataType.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                accessibilityDirectionStatus(
                    integrationDataAccessMatrixDirectionState(
                        for: dataType,
                        direction: .read,
                        source: source
                    ),
                    label: "Read"
                )
                accessibilityDirectionStatus(
                    integrationDataAccessMatrixDirectionState(
                        for: dataType,
                        direction: .write,
                        source: source
                    ),
                    label: "Write"
                )
            } else {
                Label("Not offered by \(source.displayName)", systemImage: "minus")
                    .font(.subheadline)
                    .foregroundStyle(AppVisualSystem.ColorToken.textTertiary)
            }
        }
        .padding(.vertical, AppVisualSystem.Spacing.small)
        .overlay(alignment: .bottom) { matrixHorizontalDivider }
    }

    private func accessibilityDirectionStatus(
        _ state: IntegrationDataAccessMatrixDirectionState,
        label: String
    ) -> some View {
        HStack(alignment: .top, spacing: AppVisualSystem.Spacing.small) {
            Text(label)
                .font(.subheadline.weight(.bold))
                .frame(minWidth: 54, alignment: .leading)

            Image(systemName: state.systemImage)
                .font(.subheadline.weight(.semibold))

            VStack(alignment: .leading, spacing: 2) {
                Text(state.longLabel)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                if let reason = state.disabledReason, !reason.isEmpty {
                    Text(reason)
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .foregroundStyle(state.tint)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            state.disabledReason.map {
                "\(label) \(state.accessibilityValue). \($0)"
            } ?? "\(label) \(state.accessibilityValue)"
        )
    }

    private var matrix: some View {
        VStack(spacing: 0) {
            HStack(alignment: .bottom, spacing: 0) {
                Text("Data type")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
                    .padding(.leading, AppVisualSystem.Spacing.medium)
                    .padding(.bottom, AppVisualSystem.Spacing.medium)
                    .frame(width: rowLabelWidth, height: headerHeight, alignment: .bottomLeading)
                    .accessibilityHidden(true)

                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .bottom, spacing: 0) {
                        ForEach(store.sources) { source in
                            sourceHeader(source)
                                .id(source.id)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .scrollPosition(id: $visibleSourceID)
                .overlay(alignment: .leading) { matrixVerticalDivider }
            }
            .background(AppVisualSystem.ColorToken.surfaceRaised)
            .overlay(alignment: .bottom) { matrixHorizontalDivider }

            ScrollView(.vertical, showsIndicators: true) {
                HStack(alignment: .top, spacing: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                            Text(row.displayName)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(2)
                                .minimumScaleFactor(0.85)
                                .padding(.leading, AppVisualSystem.Spacing.medium)
                                .frame(width: rowLabelWidth, height: rowHeight, alignment: .leading)
                                .background(matrixRowBackground(index: index))
                                .overlay(alignment: .bottom) { matrixHorizontalDivider }
                                .accessibilityHidden(true)
                        }
                    }
                    .background(AppVisualSystem.ColorToken.surfaceRaised)
                    .overlay(alignment: .trailing) { matrixVerticalDivider }
                    .zIndex(1)

                    ScrollView(.horizontal, showsIndicators: true) {
                        LazyHStack(alignment: .top, spacing: 0) {
                            ForEach(store.sources) { source in
                                sourceBodyColumn(source)
                                    .id(source.id)
                            }
                        }
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.viewAligned)
                    .scrollPosition(id: $visibleSourceID)
                    .accessibilityIdentifier("integration-data-access-source-scroll")
                }
            }
            .accessibilityIdentifier("integration-data-access-row-scroll")
            .frame(height: min(CGFloat(rows.count) * rowHeight, matrixBodyMaxHeight))
        }
        .background(AppVisualSystem.ColorToken.surface)
        .clipShape(RoundedRectangle(cornerRadius: AppVisualSystem.Radius.card, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AppVisualSystem.Radius.card, style: .continuous)
                .stroke(AppVisualSystem.ColorToken.borderStrong, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("integration-data-access-matrix")
    }

    private func sourceBodyColumn(_ source: IntegrationDataSource) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                sourceCell(source, row: row, rowIndex: index)
            }
        }
        .overlay(alignment: .trailing) { matrixVerticalDivider }
    }

    @ViewBuilder
    private func sourceHeader(_ source: IntegrationDataSource) -> some View {
        if source.connected {
            NavigationLink {
                IntegrationDataAccessView(sourceID: source.id, isRequired: false)
            } label: {
                sourceHeaderContent(source, actionLabel: "Manage")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(source.displayName), \(sourceStatusText(source))")
            .accessibilityHint("Opens Read and Write choices for this source")
            .accessibilityIdentifier("integration-data-access-source-\(source.id)")
        } else {
            sourceHeaderContent(
                source,
                actionLabel: source.available ? "Connect first" : "Unavailable"
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(source.displayName), \(sourceStatusText(source))")
            .accessibilityHint(sourceNotice(source))
            .accessibilityIdentifier("integration-data-access-source-\(source.id)")
        }
    }

    private func sourceHeaderContent(
        _ source: IntegrationDataSource,
        actionLabel: String
    ) -> some View {
        VStack(spacing: 6) {
            Image(systemName: sourceSystemImage(source))
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(sourceStatusTint(source))
                .accessibilityHidden(true)

            Text(source.displayName)
                .font(.caption.weight(.bold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.82)

            Text(sourceStatusText(source))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(sourceStatusTint(source))
                .lineLimit(1)

            if source.connected {
                Label(actionLabel, systemImage: "chevron.right")
                    .foregroundStyle(AppVisualSystem.ColorToken.accent)
            } else {
                Label(
                    actionLabel,
                    systemImage: source.available ? "link.badge.plus" : "lock.fill"
                )
                .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
            }
        }
        .font(.caption2.weight(.semibold))
        .frame(width: sourceColumnWidth, height: headerHeight)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func sourceCell(
        _ source: IntegrationDataSource,
        row: IntegrationDataAccessMatrixRow,
        rowIndex: Int
    ) -> some View {
        let dataType = source.dataTypes.first { $0.id == row.id }

        Group {
            if let dataType {
                VStack(spacing: 5) {
                    directionStatus(
                        integrationDataAccessMatrixDirectionState(
                            for: dataType,
                            direction: .read,
                            source: source
                        ),
                        direction: .read,
                        dataType: dataType,
                        source: source
                    )
                    directionStatus(
                        integrationDataAccessMatrixDirectionState(
                            for: dataType,
                            direction: .write,
                            source: source
                        ),
                        direction: .write,
                        dataType: dataType,
                        source: source
                    )
                }
                .padding(.horizontal, 8)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    matrixCellAccessibilityLabel(
                        source: source,
                        dataType: dataType
                    )
                )
                .accessibilityHint(
                    matrixCellAccessibilityHint(
                        source: source,
                        dataType: dataType
                    )
                )
            } else {
                VStack(spacing: 3) {
                    Image(systemName: "minus")
                    Text("Not offered")
                        .font(.caption2)
                }
                .foregroundStyle(AppVisualSystem.ColorToken.textTertiary)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(source.displayName) does not offer \(row.displayName)")
            }
        }
        .frame(width: sourceColumnWidth, height: rowHeight)
        .background(matrixRowBackground(index: rowIndex))
        .overlay(alignment: .bottom) { matrixHorizontalDivider }
    }

    private func directionStatus(
        _ state: IntegrationDataAccessMatrixDirectionState,
        direction: IntegrationAccessDirection,
        dataType: IntegrationDataType,
        source: IntegrationDataSource
    ) -> some View {
        HStack(spacing: 5) {
            Text(direction == .read ? "R" : "W")
                .font(.system(.caption2, design: .monospaced, weight: .heavy))
                .frame(width: 14)
            Image(systemName: state.systemImage)
                .font(.caption2.weight(.semibold))
            Text(state.shortLabel)
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .foregroundStyle(state.tint)
        .padding(.horizontal, 7)
        .frame(maxWidth: .infinity, minHeight: 30)
        .background(state.tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var sourceNotices: some View {
        ForEach(store.sources.filter { !$0.connected || !$0.available }) { source in
            Label {
                Text(sourceNotice(source))
            } icon: {
                Image(systemName: source.available ? "link.badge.plus" : "exclamationmark.triangle")
            }
            .font(.caption)
            .foregroundStyle(
                source.available
                    ? AppVisualSystem.ColorToken.textSecondary
                    : AppVisualSystem.ColorToken.warning
            )
            .appSurface(.standard, cornerRadius: AppVisualSystem.Radius.control, padding: 12)
        }
    }

    private var matrixHorizontalDivider: some View {
        Rectangle()
            .fill(AppVisualSystem.ColorToken.border)
            .frame(height: 1)
    }

    private var matrixVerticalDivider: some View {
        Rectangle()
            .fill(AppVisualSystem.ColorToken.border)
            .frame(width: 1)
    }

    private func matrixRowBackground(index: Int) -> Color {
        index.isMultiple(of: 2)
            ? AppVisualSystem.ColorToken.surface
            : AppVisualSystem.ColorToken.surfaceRaised
    }

    private func sourceSystemImage(_ source: IntegrationDataSource) -> String {
        let normalized = source.id.lowercased()
        if normalized.contains("health") { return "heart.fill" }
        if normalized.contains("oura") { return "circle.circle.fill" }
        if normalized.contains("workout") { return "figure.run.circle.fill" }
        return "externaldrive.connected.to.line.below"
    }

    private func sourceStatusText(_ source: IntegrationDataSource) -> String {
        if !source.available { return "Unavailable" }
        if !source.connected { return "Not connected" }
        if source.needsAccessConfiguration { return "Review needed" }
        if source.enabledDirectionCount == 0 { return "No access" }
        let suffix = source.enabledDirectionCount == 1 ? "direction" : "directions"
        return "\(source.enabledDirectionCount) \(suffix) enabled"
    }

    private func sourceStatusTint(_ source: IntegrationDataSource) -> Color {
        if !source.available { return AppVisualSystem.ColorToken.warning }
        if !source.connected { return AppVisualSystem.ColorToken.textSecondary }
        if source.needsAccessConfiguration { return AppVisualSystem.ColorToken.warning }
        if source.enabledDirectionCount > 0 { return AppVisualSystem.ColorToken.success }
        return AppVisualSystem.ColorToken.textSecondary
    }

    private func sourceNotice(_ source: IntegrationDataSource) -> String {
        if !source.available {
            return source.unavailableReason ?? "\(source.displayName) is unavailable on this device."
        }
        if !source.connected {
            return "\(source.displayName) is not connected. Connect it before changing data access."
        }
        return "\(source.displayName) data access can be changed here."
    }

    private func matrixCellAccessibilityLabel(
        source: IntegrationDataSource,
        dataType: IntegrationDataType
    ) -> String {
        let readState = integrationDataAccessMatrixDirectionState(
            for: dataType,
            direction: .read,
            source: source
        )
        let writeState = integrationDataAccessMatrixDirectionState(
            for: dataType,
            direction: .write,
            source: source
        )
        return "\(dataType.displayName), \(source.displayName). Read \(readState.accessibilityValue). Write \(writeState.accessibilityValue)."
    }

    private func matrixCellAccessibilityHint(
        source: IntegrationDataSource,
        dataType: IntegrationDataType
    ) -> String {
        let states = [
            integrationDataAccessMatrixDirectionState(
                for: dataType,
                direction: .read,
                source: source
            ),
            integrationDataAccessMatrixDirectionState(
                for: dataType,
                direction: .write,
                source: source
            )
        ]
        var seenDetails = Set<String>()
        return ([dataType.detail].compactMap { $0 } + states.compactMap(\.disabledReason))
            .filter { !$0.isEmpty && seenDetails.insert($0).inserted }
            .joined(separator: " ")
    }
}

private extension IntegrationDataAccessMatrixDirectionState {
    var longLabel: String {
        switch self {
        case .enabled: return "On"
        case .disabled: return "Off"
        case .reviewRequired: return "Choose access"
        case .disconnected: return "Connect source first"
        case .unavailable: return "Source unavailable"
        case .unsupported: return "Not supported"
        }
    }

    var shortLabel: String {
        switch self {
        case .enabled: return "On"
        case .disabled: return "Off"
        case .reviewRequired: return "Choose"
        case .disconnected: return "Connect"
        case .unavailable: return "Unavailable"
        case .unsupported: return "N/A"
        }
    }

    var systemImage: String {
        switch self {
        case .enabled: return "checkmark.circle.fill"
        case .disabled: return "circle"
        case .reviewRequired: return "exclamationmark.circle.fill"
        case .disconnected: return "link.badge.plus"
        case .unavailable: return "exclamationmark.triangle.fill"
        case .unsupported: return "lock.fill"
        }
    }

    var tint: Color {
        switch self {
        case .enabled: return AppVisualSystem.ColorToken.success
        case .disabled: return AppVisualSystem.ColorToken.textSecondary
        case .reviewRequired: return AppVisualSystem.ColorToken.warning
        case .disconnected: return AppVisualSystem.ColorToken.textSecondary
        case .unavailable: return AppVisualSystem.ColorToken.warning
        case .unsupported: return AppVisualSystem.ColorToken.textTertiary
        }
    }

    var accessibilityValue: String {
        switch self {
        case .enabled: return "On"
        case .disabled: return "Off"
        case .reviewRequired: return "Choice required"
        case .disconnected: return "Connect source first"
        case .unavailable: return "Source unavailable"
        case .unsupported: return "Not supported"
        }
    }

    var disabledReason: String? {
        switch self {
        case .unsupported(let reason), .unavailable(let reason):
            return reason
        case .enabled, .disabled, .reviewRequired, .disconnected:
            return nil
        }
    }
}

struct IntegrationDataAccessView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var store: IntegrationDataAccessStore

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
            if source.available {
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
            } else {
                Button(role: .destructive) {
                    Task { await save(source: source, denyAll: true) }
                } label: {
                    HStack {
                        Spacer()
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Turn Off All Access")
                                .fontWeight(.semibold)
                        }
                        Spacer()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || !source.connected)
            }

            if isRequired && source.available {
                Button("Continue Without Access") {
                    Task { await save(source: source, denyAll: true) }
                }
                .disabled(isSaving || !source.connected)
                .frame(maxWidth: .infinity, alignment: .center)
            }
        } footer: {
            if !source.available {
                Text("Turning off all access remains available even while this source cannot connect. Existing imported records are not silently deleted.")
            } else if isRequired {
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
