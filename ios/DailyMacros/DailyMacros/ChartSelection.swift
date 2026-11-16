import Accessibility
import SwiftUI

/// Tap-to-select for the app's `Canvas` charts. Tap a bar or point to select
/// it; the selection stays after the finger lifts. Tapping the selected point
/// again, or tapping outside the plot, clears it; tapping another point moves
/// it. The selected point gets a thin rule and a small caption pill
/// ("5.7 mi · Nov 11") that stays inside the chart. A light selection haptic
/// plays when the selection changes. VoiceOver can step through the points
/// with swipe up/down (adjustable) and use the chart descriptor (Audio Graph).

/// The pill text for one point.
struct ChartCalloutText: Equatable {
    let value: String
    let date: String
    /// What VoiceOver reads for the point; defaults to "value, date".
    var spoken: String?

    var text: String { "\(value) · \(date)" }
    var accessibilityText: String { spoken ?? "\(value), \(date)" }
}

/// Pure geometry and selection rules, kept free of SwiftUI state for tests.
enum ChartSelectionMath {
    /// Index of the point whose x is nearest to `x`, skipping points without a
    /// value (nil). Ties go to the earlier point. Nil when no point has a value.
    static func nearestIndex(to x: CGFloat, xPositions: [CGFloat?]) -> Int? {
        var best: (index: Int, distance: CGFloat)?
        for (index, position) in xPositions.enumerated() {
            guard let position else { continue }
            let distance = abs(position - x)
            if best == nil || distance < best!.distance {
                best = (index, distance)
            }
        }
        return best?.index
    }

    /// The selection after a tap. `tapped` is nil for a tap outside the plot.
    /// Tapping the selected point again clears the selection.
    static func selection(afterTapping tapped: Int?, current: Int?) -> Int? {
        guard let tapped else { return nil }
        return tapped == current ? nil : tapped
    }

    /// The selection after a VoiceOver increment/decrement over the points that
    /// have values. Starts at the first (increment) or last (decrement) point
    /// and stops at the ends.
    static func adjustedSelection(_ current: Int?, increment: Bool, selectable: [Int]) -> Int? {
        guard !selectable.isEmpty else { return nil }
        guard let current, let position = selectable.firstIndex(of: current) else {
            if let current {
                // The current index has no value: move to the neighbour in that direction.
                return increment
                    ? (selectable.first { $0 > current } ?? selectable.last)
                    : (selectable.last { $0 < current } ?? selectable.first)
            }
            return increment ? selectable.first : selectable.last
        }
        let next = increment ? min(position + 1, selectable.count - 1) : max(position - 1, 0)
        return selectable[next]
    }

    /// Top-left origin for a callout of `size` near `anchor`, inside `bounds`.
    /// Prefers above the point (`clearance` keeps it off the marker), then
    /// below, then beside it (right, flipping left near the right edge). The
    /// result is always clamped inside the bounds where it fits.
    static func calloutOrigin(
        anchor: CGPoint,
        calloutSize size: CGSize,
        bounds: CGSize,
        clearance: CGFloat = 4,
        gap: CGFloat = 4
    ) -> CGPoint {
        func clampX(_ x: CGFloat) -> CGFloat { min(max(x, 0), max(bounds.width - size.width, 0)) }
        func clampY(_ y: CGFloat) -> CGFloat { min(max(y, 0), max(bounds.height - size.height, 0)) }

        let above = anchor.y - clearance - gap - size.height
        if above >= 0 {
            return CGPoint(x: clampX(anchor.x - size.width / 2), y: clampY(above))
        }
        let below = anchor.y + clearance + gap
        if below + size.height <= bounds.height {
            return CGPoint(x: clampX(anchor.x - size.width / 2), y: clampY(below))
        }
        let right = anchor.x + clearance + gap
        let left = anchor.x - clearance - gap - size.width
        let x: CGFloat
        if right + size.width <= bounds.width {
            x = right
        } else if left >= 0 {
            x = left
        } else {
            x = clampX(anchor.x - size.width / 2)
        }
        return CGPoint(x: x, y: clampY(anchor.y - size.height / 2))
    }

    /// X of point `index` of `count` across a plot: line charts run edge to
    /// edge, bar charts sit in the middle of equal slots.
    static func xPosition(index: Int, count: Int, minX: CGFloat, width: CGFloat, centeredInSlots: Bool) -> CGFloat {
        if centeredInSlots {
            let slot = width / CGFloat(max(count, 1))
            return minX + slot * (CGFloat(index) + 0.5)
        }
        guard count > 1 else { return minX + width / 2 }
        return minX + CGFloat(index) / CGFloat(count - 1) * width
    }
}

/// Value and date text for chart callouts.
enum ChartValueFormat {
    static func whole(_ value: Double, locale: Locale = .current) -> String {
        Int(value.rounded()).formatted(.number.grouping(.automatic).locale(locale))
    }

    static func oneDecimal(_ value: Double, locale: Locale = .current) -> String {
        value.formatted(.number.precision(.fractionLength(1)).locale(locale))
    }

    static func steps(_ value: Double, locale: Locale = .current) -> String { "\(whole(value, locale: locale)) steps" }
    static func miles(_ value: Double, locale: Locale = .current) -> String { "\(oneDecimal(value, locale: locale)) mi" }
    static func kcal(_ value: Double, locale: Locale = .current) -> String { "\(whole(value, locale: locale)) kcal" }
    static func bpm(_ value: Double, locale: Locale = .current) -> String { "\(whole(value, locale: locale)) bpm" }
    static func milliseconds(_ value: Double, locale: Locale = .current) -> String { "\(whole(value, locale: locale)) ms" }
    static func weight(_ pounds: Double, locale: Locale = .current) -> String { "\(oneDecimal(pounds, locale: locale)) lbs" }

    /// An Activity metric value with its display unit: miles and mph keep one
    /// decimal, everything else is a grouped whole number.
    static func metric(_ value: Double, unit: String, locale: Locale = .current) -> String {
        switch unit {
        case "mi", "mph": return "\(oneDecimal(value, locale: locale)) \(unit)"
        default: return "\(whole(value, locale: locale)) \(unit)"
        }
    }

    /// A macro trend value: "2,150 cal" for calories, "142 g" for grams.
    static func macro(_ value: Double, macro: String, locale: Locale = .current) -> String {
        macro == "calories" ? "\(whole(value, locale: locale)) cal" : "\(whole(value, locale: locale)) g"
    }

    /// Sleep duration: "7h 30m", "8h", "45m".
    static func sleepHours(_ hours: Double) -> String {
        let totalMinutes = max(Int((hours * 60).rounded()), 0)
        let h = totalMinutes / 60
        let m = totalMinutes % 60
        if h == 0 { return "\(m)m" }
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    /// Spoken sleep duration: "7 hours 30 minutes".
    static func spokenSleepHours(_ hours: Double) -> String {
        let totalMinutes = max(Int((hours * 60).rounded()), 0)
        let h = totalMinutes / 60
        let m = totalMinutes % 60
        let hourText = "\(h) \(h == 1 ? "hour" : "hours")"
        let minuteText = "\(m) \(m == 1 ? "minute" : "minutes")"
        if h == 0 { return minuteText }
        return m == 0 ? hourText : "\(hourText) \(minuteText)"
    }

    /// Short date for a callout: "Nov 11".
    static func day(_ date: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }

    /// Short date for a "yyyy-MM-dd" day string; falls back to the raw string.
    static func day(isoDay: String, calendar: Calendar = .current, locale: Locale = .current) -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = calendar.timeZone
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: String(isoDay.prefix(10))) else { return isoDay }
        return day(date, calendar: calendar, locale: locale)
    }
}

/// Exposes a chart's points to VoiceOver's chart rotor and Audio Graph.
struct ChartAccessibilityDescriptor: AXChartDescriptorRepresentable {
    let title: String
    var summary: String?
    let yTitle: String
    let isContinuous: Bool
    /// One per point; nil for days without a value.
    let values: [Double?]
    /// The callout for each point, used for the x labels and point labels.
    let callouts: [ChartCalloutText?]

    func makeChartDescriptor() -> AXChartDescriptor {
        let present = values.compactMap { $0 }
        let low = present.min() ?? 0
        let high = present.max() ?? 1
        let dates = callouts.map { $0?.date ?? "" }
        let xAxis = AXNumericDataAxisDescriptor(
            title: "Date",
            range: 0...Double(max(values.count - 1, 1)),
            gridlinePositions: []
        ) { position in
            let index = Int(position.rounded())
            return dates.indices.contains(index) ? dates[index] : ""
        }
        let texts = callouts
        let yAxis = AXNumericDataAxisDescriptor(
            title: yTitle,
            range: low...(high > low ? high : low + 1),
            gridlinePositions: []
        ) { value in
            // Best effort: the label of a point with that value, else the number.
            if let index = values.firstIndex(where: { $0 == value }), let text = texts[index] {
                return text.value
            }
            return value.formatted()
        }
        let points = values.enumerated().compactMap { index, value -> AXDataPoint? in
            guard let value else { return nil }
            return AXDataPoint(x: Double(index), y: value, label: callouts[index]?.accessibilityText)
        }
        return AXChartDescriptor(
            title: title,
            summary: summary,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: [AXDataSeriesDescriptor(name: title, isContinuous: isContinuous, dataPoints: points)]
        )
    }
}

/// One selection shared by several charts on a screen, so selecting a point in
/// one chart clears the others.
struct ChartSelectionKey: Equatable {
    let chart: String
    let index: Int

    static func binding(_ state: Binding<ChartSelectionKey?>, chart: String) -> Binding<Int?> {
        Binding(
            get: { state.wrappedValue?.chart == chart ? state.wrappedValue?.index : nil },
            set: { newValue in
                if let newValue {
                    state.wrappedValue = ChartSelectionKey(chart: chart, index: newValue)
                } else if state.wrappedValue?.chart == chart {
                    state.wrappedValue = nil
                }
            }
        )
    }
}

/// Accessibility identifiers the UI tests use to find callouts.
enum ChartSelectionIdentifiers {
    static let callout = "chart-selection-callout"
}

private struct ChartSelectionModifier: ViewModifier {
    @Binding var selection: Int?
    let count: Int
    let resetID: String
    let plotRect: (CGSize) -> CGRect
    let anchor: (Int, CGSize) -> CGPoint?
    let markerClearance: CGFloat
    let callout: (Int) -> ChartCalloutText?
    let tint: Color
    let accessibilitySummary: String
    let descriptor: ChartAccessibilityDescriptor

    @State private var calloutSize: CGSize = .zero

    private var selectableIndices: [Int] {
        (0..<count).filter { callout($0) != nil }
    }

    private var validSelection: Int? {
        guard let selection, selection >= 0, selection < count else { return nil }
        return selection
    }

    func body(content: Content) -> some View {
        content
            .accessibilityValue(validSelection.flatMap(callout)?.accessibilityText ?? accessibilitySummary)
            .accessibilityHint("Swipe up or down to hear each day.")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment:
                    selection = ChartSelectionMath.adjustedSelection(validSelection, increment: true, selectable: selectableIndices)
                case .decrement:
                    selection = ChartSelectionMath.adjustedSelection(validSelection, increment: false, selectable: selectableIndices)
                @unknown default:
                    break
                }
            }
            .accessibilityChartDescriptor(descriptor)
            .overlay {
                GeometryReader { proxy in
                    overlay(size: proxy.size)
                }
            }
            .sensoryFeedback(.selection, trigger: validSelection) { old, new in
                new != nil && old != new
            }
            .onChange(of: resetID) { _, _ in selection = nil }
            .onChange(of: count) { _, _ in selection = nil }
    }

    @ViewBuilder
    private func overlay(size: CGSize) -> some View {
        let plot = plotRect(size)
        ZStack(alignment: .topLeading) {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(coordinateSpace: .local) { location in
                    handleTap(at: location, size: size, plot: plot)
                }
                .accessibilityHidden(true)

            if let index = validSelection, let point = anchor(index, size), let text = callout(index) {
                Path { path in
                    path.move(to: CGPoint(x: point.x, y: plot.minY))
                    path.addLine(to: CGPoint(x: point.x, y: plot.maxY))
                }
                .stroke(tint.opacity(0.55), lineWidth: 1)
                .allowsHitTesting(false)
                .accessibilityHidden(true)

                let origin = ChartSelectionMath.calloutOrigin(
                    anchor: point,
                    calloutSize: calloutSize,
                    bounds: size,
                    clearance: markerClearance
                )
                Text(text.text)
                    .font(.caption2.weight(.semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule().fill(AppVisualSystem.ColorToken.surfaceInteractive.opacity(0.95))
                    )
                    .overlay(Capsule().stroke(tint.opacity(0.6), lineWidth: 0.5))
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .fixedSize()
                    .onGeometryChange(for: CGSize.self) { $0.size } action: { calloutSize = $0 }
                    .offset(x: origin.x, y: origin.y)
                    .allowsHitTesting(false)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(text.accessibilityText)
                    .accessibilityIdentifier(ChartSelectionIdentifiers.callout)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    private func handleTap(at location: CGPoint, size: CGSize, plot: CGRect) {
        // A little slack around the plot so edge bars and points stay easy to hit.
        let hitArea = plot.insetBy(dx: -8, dy: -8)
        var tapped: Int?
        if hitArea.contains(location) {
            let xs: [CGFloat?] = (0..<count).map { index in
                callout(index) == nil ? nil : anchor(index, size)?.x
            }
            tapped = ChartSelectionMath.nearestIndex(to: location.x, xPositions: xs)
        }
        selection = ChartSelectionMath.selection(afterTapping: tapped, current: validSelection)
    }
}

extension View {
    /// Adds tap selection, a rule and callout, haptics and VoiceOver point
    /// access to a `Canvas` chart. Apply it after the chart's own
    /// `accessibilityElement()`/`accessibilityLabel`; it owns the
    /// accessibility value (`accessibilitySummary` when nothing is selected).
    ///
    /// - Parameters:
    ///   - selection: the selected point index; the chart reads it to highlight.
    ///   - count: number of points (x slots).
    ///   - resetID: selection clears when this changes (scope, metric).
    ///   - plotRect: the plot area for a chart size; taps outside it clear.
    ///   - anchor: where point `index` is drawn; nil when it has no value.
    ///   - callout: text for point `index`; nil when it has no value (not selectable).
    func chartSelection(
        _ selection: Binding<Int?>,
        count: Int,
        resetID: String,
        plotRect: @escaping (CGSize) -> CGRect,
        anchor: @escaping (Int, CGSize) -> CGPoint?,
        markerClearance: CGFloat = 4,
        callout: @escaping (Int) -> ChartCalloutText?,
        tint: Color,
        accessibilitySummary: String,
        descriptor: ChartAccessibilityDescriptor
    ) -> some View {
        modifier(
            ChartSelectionModifier(
                selection: selection,
                count: count,
                resetID: resetID,
                plotRect: plotRect,
                anchor: anchor,
                markerClearance: markerClearance,
                callout: callout,
                tint: tint,
                accessibilitySummary: accessibilitySummary,
                descriptor: descriptor
            )
        )
    }
}

/// Canvas helpers so every chart marks the selected point the same way.
enum ChartSelectionStyle {
    /// Opacity for unselected bars while a bar is selected.
    static let dimmedOpacity: Double = 0.5

    /// A ringed dot for the selected point of a line or dot chart.
    static func drawSelectedDot(at point: CGPoint, tint: Color, radius: CGFloat = 5, context: GraphicsContext) {
        let outer = CGRect(x: point.x - radius - 2, y: point.y - radius - 2, width: (radius + 2) * 2, height: (radius + 2) * 2)
        let inner = CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(ellipseIn: outer), with: .color(.white.opacity(0.9)))
        context.fill(Path(ellipseIn: inner), with: .color(tint))
    }
}
