import SwiftUI

enum AppVisualSystem {
    enum ColorToken {
        static let background = Color(red: 7 / 255, green: 9 / 255, blue: 15 / 255)
        static let surface = Color(red: 13 / 255, green: 17 / 255, blue: 30 / 255)
        static let surfaceRaised = Color(red: 18 / 255, green: 24 / 255, blue: 40 / 255)
        static let surfaceInteractive = Color(red: 23 / 255, green: 31 / 255, blue: 50 / 255)

        static let border = Color.white.opacity(0.09)
        static let borderStrong = Color.white.opacity(0.15)
        static let textSecondary = Color(red: 166 / 255, green: 179 / 255, blue: 198 / 255)
        static let textTertiary = Color(red: 121 / 255, green: 137 / 255, blue: 160 / 255)

        static let accent = Color(red: 0 / 255, green: 207 / 255, blue: 255 / 255)
        static let success = Color(red: 25 / 255, green: 224 / 255, blue: 151 / 255)
        static let warning = Color(red: 244 / 255, green: 196 / 255, blue: 81 / 255)
        static let danger = Color(red: 255 / 255, green: 79 / 255, blue: 121 / 255)

        static let calories = Color(red: 244 / 255, green: 201 / 255, blue: 93 / 255)
        static let protein = Color(red: 45 / 255, green: 226 / 255, blue: 166 / 255)
        static let carbs = Color(red: 57 / 255, green: 200 / 255, blue: 241 / 255)
        static let fat = Color(red: 244 / 255, green: 91 / 255, blue: 148 / 255)
        static let recovery = Color(red: 143 / 255, green: 138 / 255, blue: 247 / 255)
        static let workout = Color(red: 74 / 255, green: 214 / 255, blue: 109 / 255)
        static let weight = Color(red: 230 / 255, green: 106 / 255, blue: 194 / 255)
    }

    enum Spacing {
        static let xSmall: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let standard: CGFloat = 16
        static let large: CGFloat = 20
        static let xLarge: CGFloat = 24
        static let section: CGFloat = 28
    }

    enum Radius {
        static let control: CGFloat = 12
        static let card: CGFloat = 18
        static let hero: CGFloat = 22
    }
}

enum AppSurfaceStyle {
    case standard
    case elevated
    case tinted(Color)

    fileprivate var fill: Color {
        switch self {
        case .standard:
            return AppVisualSystem.ColorToken.surface
        case .elevated, .tinted:
            return AppVisualSystem.ColorToken.surfaceRaised
        }
    }

    fileprivate var tint: Color? {
        guard case .tinted(let tint) = self else { return nil }
        return tint
    }

    fileprivate var castsShadow: Bool {
        if case .elevated = self { return true }
        return false
    }
}

struct AppScreenBackground: View {
    var accent = AppVisualSystem.ColorToken.accent

    var body: some View {
        ZStack {
            AppVisualSystem.ColorToken.background

            RadialGradient(
                colors: [
                    accent.opacity(0.075),
                    .clear
                ],
                center: UnitPoint(x: 0.86, y: 0.02),
                startRadius: 8,
                endRadius: 420
            )

            LinearGradient(
                colors: [
                    Color.white.opacity(0.018),
                    .clear
                ],
                startPoint: .top,
                endPoint: .center
            )
        }
    }
}

private struct AppSurfaceModifier: ViewModifier {
    let style: AppSurfaceStyle
    let cornerRadius: CGFloat
    let padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(style.fill)
                    .overlay {
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.035),
                                style.tint?.opacity(0.055) ?? .clear,
                                .clear
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        style.tint?.opacity(0.22) ?? AppVisualSystem.ColorToken.border,
                        lineWidth: 1
                    )
            }
            .shadow(
                color: style.castsShadow ? .black.opacity(0.22) : .clear,
                radius: 16,
                y: 8
            )
    }
}

extension View {
    func appScreenBackground(accent: Color = AppVisualSystem.ColorToken.accent) -> some View {
        background {
            AppScreenBackground(accent: accent)
                .ignoresSafeArea()
        }
    }

    func appSurface(
        _ style: AppSurfaceStyle = .standard,
        cornerRadius: CGFloat = AppVisualSystem.Radius.card,
        padding: CGFloat = AppVisualSystem.Spacing.standard
    ) -> some View {
        modifier(
            AppSurfaceModifier(
                style: style,
                cornerRadius: cornerRadius,
                padding: padding
            )
        )
    }
}

struct AppStatusPill: View {
    let title: String
    let systemImage: String
    let tint: Color

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tint)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(tint.opacity(0.11), in: Capsule())
            .overlay {
                Capsule()
                    .stroke(tint.opacity(0.2), lineWidth: 1)
            }
    }
}

struct AppMetricTile: View {
    let title: String
    let value: String
    var detail: String?
    let systemImage: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: AppVisualSystem.Spacing.small) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
                .background(tint.opacity(0.11), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            Text(value)
                .font(.title3.weight(.bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.78)

            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)

            if let detail {
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(AppVisualSystem.ColorToken.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .appSurface(.tinted(tint), cornerRadius: AppVisualSystem.Radius.card, padding: 14)
        .accessibilityElement(children: .combine)
    }
}

struct AppSectionHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var systemImage: String?
    var tint = AppVisualSystem.ColorToken.accent
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: AppVisualSystem.Spacing.medium) {
            VStack(alignment: .leading, spacing: 3) {
                if let systemImage {
                    Label(title, systemImage: systemImage)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .symbolRenderingMode(.hierarchical)
                } else {
                    Text(title)
                        .font(.headline)
                }

                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
                }
            }

            Spacer(minLength: AppVisualSystem.Spacing.small)
            trailing()
                .foregroundStyle(tint)
        }
    }
}

extension AppSectionHeader where Trailing == EmptyView {
    init(
        _ title: String,
        subtitle: String? = nil,
        systemImage: String? = nil,
        tint: Color = AppVisualSystem.ColorToken.accent
    ) {
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.tint = tint
        self.trailing = { EmptyView() }
    }
}

// Compatibility aliases keep the existing macro-specific code readable while
// moving its palette into the shared semantic system.
extension Color {
    static let neonGreen = AppVisualSystem.ColorToken.protein
    static let neonCyan = AppVisualSystem.ColorToken.carbs
    static let neonPink = AppVisualSystem.ColorToken.fat
    static let neonYellow = AppVisualSystem.ColorToken.calories
    static let panelBg = AppVisualSystem.ColorToken.surface
    static let deepBg = AppVisualSystem.ColorToken.background
    static let mutedText = AppVisualSystem.ColorToken.textSecondary
}
