import SwiftUI

struct MacrosView: View {
    @EnvironmentObject var api: APIClient
    @State private var dashboard: DashboardResponse?
    @State private var savedItems: [SavedItem] = []
    @State private var mealText = ""
    @State private var parsedItems: [ParsedMealItem] = []
    @State private var parsedMealName: String?
    @State private var isParsing = false
    @State private var isSaving = false
    @State private var showParsed = false
    @State private var showQuickAdd = false
    @State private var showEditTargets = false
    @State private var errorMessage: String?
    @State private var selectedDate = Date()

    // Trend chart state
    @State private var trendPeriod = "week"
    @State private var trendData: [DailyTotals] = []
    @State private var trendTargets: MacroTargets?
    @State private var selectedTrendMacro = "calories"

    // Target editing state
    @State private var editCalories = ""
    @State private var editProtein = ""
    @State private var editCarbs = ""
    @State private var editFat = ""

    private let trendPeriods = ["week", "month", "year"]
    private let macroOptions = ["calories", "protein", "carbs", "fat"]

    private var dateString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/New_York")
        return f.string(from: selectedDate)
    }

    private var isoTimestamp: String {
        let f = ISO8601DateFormatter()
        f.timeZone = TimeZone(identifier: "America/New_York")
        return f.string(from: selectedDate)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    datePicker

                    if let dash = dashboard {
                        macroSummaryCard(dash)
                        entriesList(dash.entries)
                    }

                    trendSection
                }
                .padding()
            }
            .navigationTitle("Macros")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Log Meal") { showParsed = false; mealText = "" }
                        Button("Quick Add") { Task { await loadSavedItems(); showQuickAdd = true } }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: Binding(
                get: { !mealText.isEmpty || showParsed },
                set: { if !$0 { mealText = ""; showParsed = false; parsedItems = []; parsedMealName = nil } }
            )) {
                mealEntrySheet
            }
            .sheet(isPresented: $showQuickAdd) {
                quickAddSheet
            }
            .sheet(isPresented: $showEditTargets) {
                editTargetsSheet
            }
            .task {
                await loadDashboard()
                await loadTrend()
            }
            .refreshable {
                await loadDashboard()
                await loadTrend()
            }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Date Picker

    private var datePicker: some View {
        HStack {
            Button { selectedDate = Calendar.current.date(byAdding: .day, value: -1, to: selectedDate)!; Task { await loadDashboard() } } label: {
                Image(systemName: "chevron.left")
            }
            Spacer()
            Text(selectedDate, style: .date)
                .font(.headline)
            Spacer()
            Button { selectedDate = Calendar.current.date(byAdding: .day, value: 1, to: selectedDate)!; Task { await loadDashboard() } } label: {
                Image(systemName: "chevron.right")
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Macro Summary

    private func macroSummaryCard(_ dash: DashboardResponse) -> some View {
        let totals = dash.currentDayTotals
        let targets = dash.targets

        return VStack(spacing: 12) {
            HStack {
                Text("Daily Totals")
                    .font(.subheadline.bold())
                Spacer()
                Button("edit targets") {
                    editCalories = "\(Int(targets.calories))"
                    editProtein = "\(Int(targets.protein))"
                    editCarbs = "\(Int(targets.carbs))"
                    editFat = "\(Int(targets.fat))"
                    showEditTargets = true
                }
                .font(.caption)
                .foregroundStyle(.cyan)
            }

            macroRow("Calories", value: totals.calories, target: targets.calories, unit: "kcal", color: .cyan)
            macroRow("Protein", value: totals.protein, target: targets.protein, unit: "g", color: .red)
            macroRow("Carbs", value: totals.carbs, target: targets.carbs, unit: "g", color: .blue)
            macroRow("Fat", value: totals.fat, target: targets.fat, unit: "g", color: .yellow)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func macroRow(_ label: String, value: Double, target: Double, unit: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.subheadline.bold())
                Spacer()
                Text("\(Int(value)) / \(Int(target)) \(unit)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.systemGray5)).frame(height: 8)
                    Capsule().fill(color).frame(width: min(geo.size.width * (target > 0 ? value / target : 0), geo.size.width), height: 8)
                }
            }
            .frame(height: 8)
        }
    }

    // MARK: - Entries List

    private func entriesList(_ entries: [Entry]) -> some View {
        let grouped = Dictionary(grouping: entries, by: { $0.mealGroup ?? $0.itemName })
        let keys = entries.compactMap { $0.mealGroup ?? $0.itemName }
        let orderedKeys = keys.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }

        return VStack(alignment: .leading, spacing: 12) {
            ForEach(orderedKeys, id: \.self) { key in
                if let items = grouped[key] {
                    VStack(alignment: .leading, spacing: 4) {
                        if items.count > 1, let mealName = items.first?.mealName {
                            Text(mealName)
                                .font(.subheadline.bold())
                                .foregroundStyle(.cyan)
                        }
                        ForEach(items) { entry in
                            entryRow(entry)
                        }
                    }
                }
            }

            if entries.isEmpty {
                Text("No entries yet today")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
            }
        }
    }

    private func entryRow(_ entry: Entry) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.itemName)
                    .font(.subheadline)
                Text("\(Int(entry.quantity)) \(entry.unit ?? "serving")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(Int(entry.calories)) kcal")
                    .font(.subheadline)
                Text("P:\(Int(entry.protein)) C:\(Int(entry.carbs)) F:\(Int(entry.fat))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task { await deleteEntry(entry.id) }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    // MARK: - Trend Section

    private var trendSection: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Trend")
                    .font(.headline)
                Spacer()
            }

            Picker("Period", selection: $trendPeriod) {
                ForEach(trendPeriods, id: \.self) { p in
                    Text(p.capitalized).tag(p)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: trendPeriod) { _, _ in
                Task { await loadTrend() }
            }

            // Macro selector
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(macroOptions, id: \.self) { macro in
                        Button {
                            selectedTrendMacro = macro
                        } label: {
                            Text(macro.capitalized)
                                .font(.caption.bold())
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(selectedTrendMacro == macro ? macroColor(macro) : Color(.systemGray5))
                                .foregroundStyle(selectedTrendMacro == macro ? .white : .primary)
                                .cornerRadius(16)
                        }
                    }
                }
            }

            if trendData.count >= 2 {
                trendChart
            } else if !trendData.isEmpty {
                Text("Need at least 2 days of data for chart")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 20)
            }

            // Running averages
            if !trendData.isEmpty {
                trendAverages
            }
        }
    }

    private var trendChart: some View {
        Canvas { context, size in
            let values = trendData.map { valueForMacro($0, macro: selectedTrendMacro) }
            let targetValue = targetForMacro(selectedTrendMacro)
            let allValues = values + (targetValue > 0 ? [targetValue] : [])
            let minV = max(0, (allValues.min() ?? 0) * 0.8)
            let maxV = (allValues.max() ?? 0) * 1.1
            let range = max(maxV - minV, 1)

            let stepX = size.width / CGFloat(max(values.count - 1, 1))

            // Target line
            if targetValue > 0 {
                let targetY = size.height - ((targetValue - minV) / range) * size.height
                var targetPath = Path()
                targetPath.move(to: CGPoint(x: 0, y: targetY))
                targetPath.addLine(to: CGPoint(x: size.width, y: targetY))
                context.stroke(targetPath, with: .color(.white.opacity(0.3)), style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
            }

            // Average line
            let avg = values.reduce(0, +) / Double(values.count)
            let avgY = size.height - ((avg - minV) / range) * size.height
            var avgPath = Path()
            avgPath.move(to: CGPoint(x: 0, y: avgY))
            avgPath.addLine(to: CGPoint(x: size.width, y: avgY))
            context.stroke(avgPath, with: .color(.white.opacity(0.2)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))

            // Data line
            var path = Path()
            for (i, val) in values.enumerated() {
                let x = CGFloat(i) * stepX
                let y = size.height - ((val - minV) / range) * size.height
                if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                else { path.addLine(to: CGPoint(x: x, y: y)) }
            }
            context.stroke(path, with: .color(macroColor(selectedTrendMacro)), lineWidth: 2)

            // Dots
            for (i, val) in values.enumerated() {
                let x = CGFloat(i) * stepX
                let y = size.height - ((val - minV) / range) * size.height
                context.fill(Circle().path(in: CGRect(x: x - 3, y: y - 3, width: 6, height: 6)), with: .color(macroColor(selectedTrendMacro)))
            }
        }
        .frame(height: 180)
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var trendAverages: some View {
        let daysWithData = trendData.count
        let avgCal = trendData.reduce(0) { $0 + $1.calories } / Double(daysWithData)
        let avgProt = trendData.reduce(0) { $0 + $1.protein } / Double(daysWithData)
        let avgCarbs = trendData.reduce(0) { $0 + $1.carbs } / Double(daysWithData)
        let avgFat = trendData.reduce(0) { $0 + $1.fat } / Double(daysWithData)

        return VStack(spacing: 8) {
            HStack {
                Text("Averages (\(daysWithData) days)")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Spacer()
            }
            HStack(spacing: 16) {
                avgChip("Cal", value: avgCal, color: .cyan)
                avgChip("P", value: avgProt, color: .red)
                avgChip("C", value: avgCarbs, color: .blue)
                avgChip("F", value: avgFat, color: .yellow)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func avgChip(_ label: String, value: Double, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("\(Int(value))")
                .font(.subheadline.bold())
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Edit Targets Sheet

    private var editTargetsSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                targetField("Calories (kcal)", text: $editCalories)
                targetField("Protein (g)", text: $editProtein)
                targetField("Carbs (g)", text: $editCarbs)
                targetField("Fat (g)", text: $editFat)

                Button {
                    Task { await saveTargets() }
                } label: {
                    Text("Save Targets").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)

                Spacer()
            }
            .padding()
            .navigationTitle("Edit Targets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditTargets = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func targetField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
        }
    }

    // MARK: - Meal Entry Sheet

    private var mealEntrySheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if showParsed {
                    parsedResultsView
                } else {
                    mealInputView
                }
            }
            .padding()
            .navigationTitle(showParsed ? "Confirm Meal" : "Log Meal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { mealText = ""; showParsed = false; parsedItems = []; parsedMealName = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var mealInputView: some View {
        VStack(spacing: 16) {
            TextField("Describe your meal...", text: $mealText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)

            Button {
                Task { await parseMeal() }
            } label: {
                if isParsing {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Parse Meal").font(.headline).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(mealText.isEmpty || isParsing)

            Spacer()
        }
    }

    private var parsedResultsView: some View {
        VStack(spacing: 12) {
            if let name = parsedMealName {
                Text(name).font(.headline)
            }

            ForEach(Array(parsedItems.enumerated()), id: \.offset) { _, item in
                HStack {
                    VStack(alignment: .leading) {
                        Text(item.itemName).font(.subheadline)
                        Text("\(Int(item.quantity)) \(item.unit ?? "serving")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("\(Int(item.calories)) kcal").font(.subheadline)
                        Text("P:\(Int(item.protein)) C:\(Int(item.carbs)) F:\(Int(item.fat))")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 2)
            }

            let totalCal = parsedItems.reduce(0) { $0 + $1.calories }
            let totalP = parsedItems.reduce(0) { $0 + $1.protein }
            let totalC = parsedItems.reduce(0) { $0 + $1.carbs }
            let totalF = parsedItems.reduce(0) { $0 + $1.fat }

            Divider()
            HStack {
                Text("Total").font(.subheadline.bold())
                Spacer()
                Text("\(Int(totalCal)) kcal \u{00B7} P:\(Int(totalP)) C:\(Int(totalC)) F:\(Int(totalF))")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Button {
                Task { await saveParsedMeal() }
            } label: {
                if isSaving {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Save").font(.headline).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(isSaving)

            Spacer()
        }
    }

    // MARK: - Quick Add Sheet

    private var quickAddSheet: some View {
        NavigationStack {
            List(savedItems) { item in
                Button {
                    Task { await quickAddItem(item) }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).font(.subheadline)
                            Text("\(Int(item.calories)) kcal \u{00B7} P:\(Int(item.protein)) C:\(Int(item.carbs)) F:\(Int(item.fat))")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(.cyan)
                    }
                }
                .tint(.primary)
            }
            .navigationTitle("Quick Add")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { showQuickAdd = false }
                }
            }
            .overlay {
                if savedItems.isEmpty {
                    ContentUnavailableView("No Saved Items", systemImage: "bookmark", description: Text("Save meals from the web app to use Quick Add."))
                }
            }
        }
    }

    // MARK: - Actions

    private func loadDashboard() async {
        do {
            dashboard = try await api.getDashboard(date: dateString)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadTrend() async {
        do {
            let response = try await api.getDailyTotals(scope: trendPeriod)
            trendData = response.dailyTotals
            trendTargets = response.targets
        } catch {
            // Non-critical
        }
    }

    private func loadSavedItems() async {
        do {
            savedItems = try await api.getSavedItems()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func parseMeal() async {
        isParsing = true
        defer { isParsing = false }
        do {
            let response = try await api.parseMeal(text: mealText, consumedAt: isoTimestamp)
            parsedItems = response.items
            parsedMealName = response.mealName
            showParsed = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveParsedMeal() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let items: [[String: Any]] = parsedItems.map { item in
                var dict: [String: Any] = [
                    "itemName": item.itemName,
                    "quantity": item.quantity,
                    "calories": item.calories,
                    "protein": item.protein,
                    "carbs": item.carbs,
                    "fat": item.fat
                ]
                if let unit = item.unit { dict["unit"] = unit }
                return dict
            }
            try await api.saveMealEntries(items: items, consumedAt: isoTimestamp, mealName: parsedMealName)
            mealText = ""
            showParsed = false
            parsedItems = []
            parsedMealName = nil
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func quickAddItem(_ item: SavedItem) async {
        do {
            try await api.quickAdd(savedItemId: item.id, consumedAt: isoTimestamp)
            showQuickAdd = false
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteEntry(_ id: Int) async {
        do {
            try await api.deleteEntry(id: id)
            await loadDashboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveTargets() async {
        do {
            if let cal = Double(editCalories) { try await api.setMacroTarget(macro: "calories", target: cal) }
            if let prot = Double(editProtein) { try await api.setMacroTarget(macro: "protein", target: prot) }
            if let carbs = Double(editCarbs) { try await api.setMacroTarget(macro: "carbs", target: carbs) }
            if let fat = Double(editFat) { try await api.setMacroTarget(macro: "fat", target: fat) }
            showEditTargets = false
            await loadDashboard()
            await loadTrend()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func valueForMacro(_ totals: DailyTotals, macro: String) -> Double {
        switch macro {
        case "calories": return totals.calories
        case "protein": return totals.protein
        case "carbs": return totals.carbs
        case "fat": return totals.fat
        default: return totals.calories
        }
    }

    private func targetForMacro(_ macro: String) -> Double {
        guard let targets = trendTargets else { return 0 }
        switch macro {
        case "calories": return targets.calories
        case "protein": return targets.protein
        case "carbs": return targets.carbs
        case "fat": return targets.fat
        default: return targets.calories
        }
    }

    private func macroColor(_ macro: String) -> Color {
        switch macro {
        case "calories": return .cyan
        case "protein": return .red
        case "carbs": return .blue
        case "fat": return .yellow
        default: return .cyan
        }
    }
}
