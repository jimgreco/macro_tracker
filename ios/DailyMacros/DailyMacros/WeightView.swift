import SwiftUI

struct WeightView: View {
    @EnvironmentObject var api: APIClient
    @State private var entries: [WeightEntry] = []
    @State private var target: WeightTarget?
    @State private var scope = "month"
    @State private var newWeight = ""
    @State private var newWeightDate = Date()
    @State private var showAddSheet = false
    @State private var showEditTarget = false
    @State private var editingEntry: WeightEntry?
    @State private var isLoading = false
    @State private var weightOffset = 0
    @State private var hasMoreWeightEntries = true
    @State private var isLoadingWeightPage = false
    @State private var errorMessage: String?

    // Target editing state
    @State private var editTargetWeight = ""
    @State private var editTargetDate = Date()
    @State private var editWeightValue = ""
    @State private var editWeightDate = Date()

    private let scopes = ["week", "month", "year"]
    private let logPageSize = 30

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    scopePicker
                    targetCard
                    chartView
                    entriesList
                }
                .padding()
            }
            .navigationTitle("Weight")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showAddSheet = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                addWeightSheet
            }
            .sheet(isPresented: $showEditTarget) {
                editTargetSheet
            }
            .sheet(item: $editingEntry) { entry in
                editWeightSheet(entry)
            }
            .task { await loadData() }
            .refreshable { await loadData() }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Scope Picker

    private var scopePicker: some View {
        Picker("Scope", selection: $scope) {
            ForEach(scopes, id: \.self) { s in
                Text(s.capitalized).tag(s)
            }
        }
        .pickerStyle(.segmented)
        .onChange(of: scope) { _, _ in
            Task { await loadEntries(reset: true) }
        }
    }

    // MARK: - Target Card

    private var targetCard: some View {
        Group {
            if let target, let tw = target.targetWeight {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("Target Weight")
                            .font(.subheadline.bold())

                        Spacer()

                        Button("edit targets") {
                            editTargetWeight = String(format: "%.1f", tw)
                            if let dateStr = target.targetDate {
                                editTargetDate = parseTargetDate(dateStr) ?? Date()
                            }
                            showEditTarget = true
                        }
                        .font(.caption)
                        .foregroundStyle(.cyan)
                    }

                    HStack(alignment: .firstTextBaseline) {
                        Text(String(format: "%.1f lbs", tw))
                            .font(.title2.bold())

                        Spacer()

                        if let date = target.targetDate {
                            Text(formatShortDate(date))
                                .font(.title3.weight(.semibold))
                        }
                    }
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)
            } else {
                Button {
                    editTargetWeight = ""
                    editTargetDate = Date()
                    showEditTarget = true
                } label: {
                    HStack {
                        Image(systemName: "target")
                        Text("Set Weight Target")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.cyan)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(12)
                }
            }
        }
    }

    // MARK: - Chart

    private var chartView: some View {
        Group {
            if entries.count >= 2 {
                VStack(alignment: .leading, spacing: 8) {
                    let chartEntries = weightChartEntries
                    let scale = weightChartScale

                    HStack(alignment: .center, spacing: 4) {
                        Text("Weight (lb)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .rotationEffect(.degrees(-90))
                            .fixedSize()
                            .frame(width: 18, height: 220)

                        Canvas { context, size in
                            drawWeightChart(entries: chartEntries, scale: scale, context: context, size: size)
                        }
                        .frame(height: 220)
                    }
                    .accessibilityLabel("Weight chart with dates on the horizontal axis and pounds on the vertical axis")

                    Text("Date")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)

                    // Legend
                    HStack(spacing: 16) {
                        legendItem("Avg: \(String(format: "%.1f", entries.map(\.weight).reduce(0, +) / Double(entries.count)))", color: .white.opacity(0.4))
                        if let tw = target?.targetWeight {
                            legendItem("Target: \(String(format: "%.1f", tw))", color: .green.opacity(0.7))
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(12)
            }
        }
    }

    private var weightChartEntries: [WeightEntry] {
        entries.sorted { parseISO($0.loggedAt) < parseISO($1.loggedAt) }
    }

    private var weightChartScale: (min: Double, max: Double, span: Double) {
        var values = entries.map(\.weight)
        if let targetWeight = target?.targetWeight {
            values.append(targetWeight)
        }

        let minValue = (values.min() ?? 0) - 2
        let rawMaxValue = (values.max() ?? 0) + 2
        let span = max(rawMaxValue - minValue, 1)
        return (minValue, minValue + span, span)
    }

    private func drawWeightChart(entries chartEntries: [WeightEntry], scale: (min: Double, max: Double, span: Double), context: GraphicsContext, size: CGSize) {
        guard !chartEntries.isEmpty else { return }

        let topPadding: CGFloat = 10
        let rightPadding: CGFloat = 8
        let bottomPadding: CGFloat = 30
        let leftPadding: CGFloat = 46
        let plotWidth = max(size.width - leftPadding - rightPadding, 1)
        let plotHeight = max(size.height - topPadding - bottomPadding, 1)
        let tickCount = 4

        func xPosition(_ index: Int) -> CGFloat {
            guard chartEntries.count > 1 else {
                return leftPadding + plotWidth / 2
            }
            return leftPadding + (CGFloat(index) / CGFloat(chartEntries.count - 1)) * plotWidth
        }

        func yPosition(_ value: Double) -> CGFloat {
            topPadding + plotHeight - CGFloat((value - scale.min) / scale.span) * plotHeight
        }

        for tickIndex in 0...tickCount {
            let ratio = CGFloat(tickIndex) / CGFloat(tickCount)
            let y = topPadding + ratio * plotHeight
            let tickValue = scale.max - Double(tickIndex) * scale.span / Double(tickCount)

            var gridPath = Path()
            gridPath.move(to: CGPoint(x: leftPadding, y: y))
            gridPath.addLine(to: CGPoint(x: leftPadding + plotWidth, y: y))
            context.stroke(gridPath, with: .color(.white.opacity(0.07)), lineWidth: 1)

            context.draw(
                Text(formatWeightAxisValue(tickValue)).font(.caption2).foregroundColor(.secondary),
                at: CGPoint(x: leftPadding - 6, y: y),
                anchor: .trailing
            )
        }

        var axisPath = Path()
        axisPath.move(to: CGPoint(x: leftPadding, y: topPadding))
        axisPath.addLine(to: CGPoint(x: leftPadding, y: topPadding + plotHeight))
        axisPath.addLine(to: CGPoint(x: leftPadding + plotWidth, y: topPadding + plotHeight))
        context.stroke(axisPath, with: .color(.white.opacity(0.15)), lineWidth: 1)

        if let targetWeight = target?.targetWeight {
            let y = yPosition(targetWeight)
            var targetPath = Path()
            targetPath.move(to: CGPoint(x: leftPadding, y: y))
            targetPath.addLine(to: CGPoint(x: leftPadding + plotWidth, y: y))
            context.stroke(targetPath, with: .color(.green.opacity(0.5)), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
        }

        let weights = chartEntries.map(\.weight)
        let average = weights.reduce(0, +) / Double(weights.count)
        let averageY = yPosition(average)
        var averagePath = Path()
        averagePath.move(to: CGPoint(x: leftPadding, y: averageY))
        averagePath.addLine(to: CGPoint(x: leftPadding + plotWidth, y: averageY))
        context.stroke(averagePath, with: .color(.white.opacity(0.2)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))

        var linePath = Path()
        for (index, entry) in chartEntries.enumerated() {
            let x = xPosition(index)
            let y = yPosition(entry.weight)
            if index == 0 {
                linePath.move(to: CGPoint(x: x, y: y))
            } else {
                linePath.addLine(to: CGPoint(x: x, y: y))
            }
        }
        context.stroke(linePath, with: .color(.cyan), lineWidth: 2)

        for (index, entry) in chartEntries.enumerated() {
            let x = xPosition(index)
            let y = yPosition(entry.weight)
            context.fill(Circle().path(in: CGRect(x: x - 3, y: y - 3, width: 6, height: 6)), with: .color(.cyan))
        }

        let labelIndices = chartAxisLabelIndices(count: chartEntries.count, desired: 4)
        for (position, index) in labelIndices.enumerated() {
            let anchor: UnitPoint
            if position == 0 {
                anchor = .topLeading
            } else if position == labelIndices.count - 1 {
                anchor = .topTrailing
            } else {
                anchor = .top
            }

            context.draw(
                Text(formatChartDate(chartEntries[index].loggedAt)).font(.caption2).foregroundColor(.secondary),
                at: CGPoint(x: xPosition(index), y: topPadding + plotHeight + 8),
                anchor: anchor
            )
        }
    }

    private func chartAxisLabelIndices(count: Int, desired: Int) -> [Int] {
        guard count > 0 else { return [] }
        guard count > desired else { return Array(0..<count) }

        return (0..<desired).reduce(into: [Int]()) { indices, labelIndex in
            let index = Int((Double(labelIndex) * Double(count - 1) / Double(desired - 1)).rounded())
            if indices.last != index {
                indices.append(index)
            }
        }
    }

    private func formatWeightAxisValue(_ value: Double) -> String {
        let rounded = value.rounded()
        if abs(value - rounded) < 0.05 {
            return "\(Int(rounded))"
        }
        return String(format: "%.1f", value)
    }

    private func formatChartDate(_ iso: String) -> String {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("M/d")
        return formatter.string(from: parseISO(iso))
    }

    private func legendItem(_ text: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Rectangle()
                .fill(color)
                .frame(width: 12, height: 2)
            Text(text)
        }
    }

    // MARK: - Entries List

    private var entriesList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("History")
                .font(.headline)

            ForEach(entries) { entry in
                SwipeToDeleteRow {
                    Task { await deleteWeight(entry.id) }
                } content: {
                    HStack {
                        Text(formatDate(entry.loggedAt))
                            .font(.subheadline)
                        Spacer()
                        Text(String(format: "%.1f lbs", entry.weight))
                            .font(.subheadline.bold())
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        editWeightValue = String(format: "%.1f", entry.weight)
                        editWeightDate = parseISO(entry.loggedAt)
                        editingEntry = entry
                    }
                }
                .onAppear {
                    loadMoreWeightsIfNeeded(current: entry)
                }
            }

            if entries.isEmpty {
                if isLoadingWeightPage {
                    ProgressView("Loading entries...")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                } else {
                    Text("No weight entries")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                }
            } else if isLoadingWeightPage {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
        }
    }

    // MARK: - Add Weight Sheet

    private var addWeightSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    TextField("Weight (lbs)", text: $newWeight)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.decimalPad)

                    DatePicker("Logged At", selection: $newWeightDate)
                        .datePickerStyle(.compact)

                    Button {
                        Task { await addWeight() }
                    } label: {
                        if isLoading {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Log Weight").font(.headline).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(newWeight.isEmpty || isLoading)

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Log Weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showAddSheet = false }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
    }

    // MARK: - Edit Weight Sheet

    private func editWeightSheet(_ entry: WeightEntry) -> some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    TextField("Weight (lbs)", text: $editWeightValue)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.decimalPad)

                    DatePicker("Logged At", selection: $editWeightDate)
                        .datePickerStyle(.compact)

                    Button {
                        Task { await updateWeight(entry) }
                    } label: {
                        if isLoading {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Save").font(.headline).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(editWeightValue.isEmpty || isLoading)

                    Button(role: .destructive) {
                        Task {
                            await deleteWeight(entry.id)
                            editingEntry = nil
                        }
                    } label: {
                        Text("Delete Entry").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Edit Weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingEntry = nil }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
    }

    // MARK: - Edit Target Sheet

    private var editTargetSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Target Weight (lbs)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Target Weight", text: $editTargetWeight)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Target Date")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        DatePicker("", selection: $editTargetDate, displayedComponents: .date)
                            .datePickerStyle(.compact)
                            .labelsHidden()
                    }

                    Button {
                        Task { await saveTarget() }
                    } label: {
                        Text("Save Target").font(.headline).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(editTargetWeight.isEmpty)

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Weight Target")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditTarget = false }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
    }

    // MARK: - Actions

    private func loadData() async {
        await loadEntries(reset: true)
        do {
            target = try await api.getWeightTarget()
        } catch { /* target is optional */ }
    }

    private func loadEntries(reset: Bool = true) async {
        guard !isLoadingWeightPage else { return }
        isLoadingWeightPage = true
        defer { isLoadingWeightPage = false }

        let offset = reset ? 0 : weightOffset

        do {
            let response = try await api.getWeights(scope: scope, limit: logPageSize, offset: offset)
            if reset {
                entries = response.entries
            } else {
                appendUniqueWeightEntries(response.entries)
            }
            weightOffset = offset + response.entries.count
            hasMoreWeightEntries = response.entries.count == logPageSize
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func appendUniqueWeightEntries(_ newEntries: [WeightEntry]) {
        let existingIds = Set(entries.map(\.id))
        entries.append(contentsOf: newEntries.filter { !existingIds.contains($0.id) })
    }

    private func loadMoreWeightsIfNeeded(current entry: WeightEntry) {
        guard hasMoreWeightEntries, entry.id == entries.last?.id else { return }
        Task { await loadEntries(reset: false) }
    }

    private func addWeight() async {
        guard let weight = Double(newWeight) else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addWeight(weight, loggedAt: f.string(from: newWeightDate))
            newWeight = ""
            newWeightDate = Date()
            showAddSheet = false
            await loadEntries(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateWeight(_ entry: WeightEntry) async {
        guard let weight = Double(editWeightValue) else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.updateWeight(id: entry.id, weight: weight, loggedAt: f.string(from: editWeightDate))
            editingEntry = nil
            await loadEntries(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteWeight(_ id: Int) async {
        do {
            try await api.deleteWeight(id: id)
            await loadEntries(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveTarget() async {
        guard let weight = Double(editTargetWeight) else { return }
        do {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            let dateStr = f.string(from: editTargetDate)
            try await api.setWeightTarget(targetWeight: weight, targetDate: dateStr)
            showEditTarget = false
            await loadData()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func formatDate(_ iso: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        if let date = f.date(from: iso) {
            f.dateStyle = .medium
            f.timeStyle = .none
            return f.string(from: date)
        }
        return String(iso.prefix(10))
    }

    private func formatShortDate(_ dateStr: String) -> String {
        guard let date = parseTargetDate(dateStr) else {
            return String(dateStr.prefix(10))
        }

        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f.string(from: date)
    }

    private func parseTargetDate(_ dateStr: String) -> Date? {
        let trimmed = dateStr.trimmingCharacters(in: .whitespacesAndNewlines)

        let dateOnlyFormatter = DateFormatter()
        dateOnlyFormatter.dateFormat = "yyyy-MM-dd"
        if let date = dateOnlyFormatter.date(from: trimmed) {
            return date
        }

        let isoFormatter = ISO8601DateFormatter()
        if let date = isoFormatter.date(from: trimmed) {
            return date
        }

        let jsDateFormatter = DateFormatter()
        jsDateFormatter.locale = Locale(identifier: "en_US_POSIX")
        jsDateFormatter.dateFormat = "EEE MMM d yyyy HH:mm:ss 'GMT'Z '('zzzz')'"
        return jsDateFormatter.date(from: trimmed)
    }

    private func parseISO(_ iso: String) -> Date {
        let isoFormatter = ISO8601DateFormatter()
        if let date = isoFormatter.date(from: iso) {
            return date
        }

        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return f.date(from: iso) ?? Date()
    }
}
