import SwiftUI
import UIKit

struct SwipeToDeleteRow<Content: View>: View {
    private enum DragAxis {
        case horizontal
        case vertical
    }

    private let actionWidth: CGFloat
    private let actionTint: Color
    private let onDelete: () -> Void
    private let content: Content

    @State private var offsetX: CGFloat = 0
    @State private var gestureStartOffsetX: CGFloat?
    @State private var dragAxis: DragAxis?
    @State private var isDragging = false
    @State private var isDeleting = false
    @State private var isRevealed = false

    init(
        actionWidth: CGFloat = 88,
        actionTint: Color = .red,
        onDelete: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.actionWidth = actionWidth
        self.actionTint = actionTint
        self.onDelete = onDelete
        self.content = content()
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(actionTint)
                .frame(width: actionSurfaceWidth)
                .opacity(actionOpacity)
                .scaleEffect(x: 1, y: 0.94 + (0.06 * easedRevealProgress), anchor: .trailing)

            Button {
                delete()
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "trash.fill")
                        .font(.body)
                    Text("Delete")
                        .font(.caption2.bold())
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .buttonStyle(.plain)
            .frame(width: actionWidth)
            .opacity(actionOpacity)
            .scaleEffect(0.92 + (0.08 * easedRevealProgress))
            .offset(x: actionButtonOffset)
            .allowsHitTesting(isRevealed && !isDeleting)

            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .offset(x: offsetX)
                .contentShape(Rectangle())
                .allowsHitTesting(!isRevealed && !isDragging && offsetX == 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .clipped()
        .simultaneousGesture(swipeGesture)
        .simultaneousGesture(TapGesture().onEnded {
            guard isRevealed && !isDeleting else { return }
            close()
        })
        .accessibilityAction(named: Text("Delete"), delete)
    }

    private var revealAmount: CGFloat {
        min(actionWidth, max(0, -offsetX))
    }

    private var overshootAmount: CGFloat {
        max(0, -offsetX - actionWidth)
    }

    private var revealProgress: CGFloat {
        guard actionWidth > 0 else { return 0 }
        return min(1, max(0, revealAmount / actionWidth))
    }

    private var easedRevealProgress: CGFloat {
        let remainingProgress = 1 - revealProgress
        return 1 - (remainingProgress * remainingProgress * remainingProgress)
    }

    private var actionSurfaceWidth: CGFloat {
        guard revealAmount > 0 else { return 0 }
        return revealAmount + overshootAmount
    }

    private var actionOpacity: CGFloat {
        guard revealProgress > 0 else { return 0 }
        return 0.5 + (0.5 * easedRevealProgress)
    }

    private var actionButtonOffset: CGFloat {
        actionWidth * 0.18 * (1 - easedRevealProgress)
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 14, coordinateSpace: .local)
            .onChanged { value in
                if dragAxis == nil {
                    dragAxis = resolvedAxis(for: value)
                }

                guard dragAxis == .horizontal else {
                    if isRevealed {
                        close()
                    }
                    return
                }

                if gestureStartOffsetX == nil {
                    gestureStartOffsetX = offsetX
                    isDragging = true
                }

                let baseOffset = gestureStartOffsetX ?? 0
                offsetX = rubberBandedOffset(baseOffset + value.translation.width)
            }
            .onEnded { value in
                defer {
                    gestureStartOffsetX = nil
                    dragAxis = nil
                    isDragging = false
                }
                guard dragAxis == .horizontal else { return }

                let baseOffset = gestureStartOffsetX ?? 0
                let predictedOffset = baseOffset + value.predictedEndTranslation.width
                let draggedOffset = baseOffset + value.translation.width
                settle(revealed: shouldReveal(draggedOffset: draggedOffset, predictedOffset: predictedOffset))
            }
    }

    private func resolvedAxis(for value: DragGesture.Value) -> DragAxis? {
        let horizontal = abs(value.translation.width)
        let vertical = abs(value.translation.height)
        let distance = max(horizontal, vertical)

        guard distance >= 10 else { return nil }
        return horizontal > vertical * 1.35 ? .horizontal : .vertical
    }

    private func rubberBandedOffset(_ value: CGFloat) -> CGFloat {
        let clampedValue = min(0, value)
        guard clampedValue < -actionWidth else { return clampedValue }

        let extraDistance = abs(clampedValue + actionWidth)
        let rubberBandedDistance = min(actionWidth * 0.42, extraDistance * 0.22)
        return -actionWidth - rubberBandedDistance
    }

    private func shouldReveal(draggedOffset: CGFloat, predictedOffset: CGFloat) -> Bool {
        let referenceOffset = predictedOffset.isFinite ? predictedOffset : draggedOffset

        if isRevealed {
            return draggedOffset < -actionWidth * 0.62 || referenceOffset < -actionWidth * 0.54
        }

        return draggedOffset < -actionWidth * 0.50 || referenceOffset < -actionWidth * 0.38
    }

    private func settle(revealed: Bool) {
        let wasRevealed = isRevealed

        withAnimation(.snappy(duration: 0.28, extraBounce: revealed ? 0.08 : 0.02)) {
            offsetX = revealed ? -actionWidth : 0
            isRevealed = revealed
        }

        if revealed && !wasRevealed {
            UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.65)
        }
    }

    private func close() {
        withAnimation(.snappy(duration: 0.24, extraBounce: 0.02)) {
            offsetX = 0
            isRevealed = false
        }
    }

    private func delete() {
        guard !isDeleting else { return }
        isDeleting = true
        UIImpactFeedbackGenerator(style: .medium).impactOccurred(intensity: 0.85)

        withAnimation(.smooth(duration: 0.14)) {
            offsetX = -actionWidth * 1.08
            isRevealed = true
        }

        onDelete()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            isDeleting = false
            close()
        }
    }
}
