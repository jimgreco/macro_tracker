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
    @State private var errorMessage: String?
    @State private var selectedDate = Date()

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
            .task { await loadDashboard() }
            .refreshable { await loadDashboard() }
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
                Text("\(Int(totalCal)) kcal · P:\(Int(totalP)) C:\(Int(totalC)) F:\(Int(totalF))")
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
                            Text("\(Int(item.calories)) kcal · P:\(Int(item.protein)) C:\(Int(item.carbs)) F:\(Int(item.fat))")
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
}
