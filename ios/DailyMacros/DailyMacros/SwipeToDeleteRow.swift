import SwiftUI

struct SwipeToDeleteRow<Content: View>: View {
    private let actionWidth: CGFloat
    private let actionTint: Color
    private let onDelete: () -> Void
    private let content: Content

    @State private var offsetX: CGFloat = 0
    @State private var gestureStartOffsetX: CGFloat?
    @State private var isDeleting = false

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
                .frame(width: max(actionWidth, -offsetX))
                .opacity(offsetX < 0 ? 1 : 0)

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
            .opacity(offsetX < 0 ? 1 : 0)
            .allowsHitTesting(offsetX < 0 && !isDeleting)

            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .offset(x: offsetX)
                .contentShape(Rectangle())
                .allowsHitTesting(offsetX == 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .clipped()
        .simultaneousGesture(swipeGesture)
        .simultaneousGesture(TapGesture().onEnded {
            guard offsetX < 0 else { return }
            close()
        })
        .accessibilityAction(named: Text("Delete"), delete)
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .local)
            .onChanged { value in
                guard isHorizontalSwipe(value) || offsetX < 0 else { return }
                if gestureStartOffsetX == nil {
                    gestureStartOffsetX = offsetX
                }

                let baseOffset = gestureStartOffsetX ?? 0
                offsetX = clampedOffset(baseOffset + value.translation.width)
            }
            .onEnded { value in
                defer { gestureStartOffsetX = nil }
                guard isHorizontalSwipe(value) || offsetX < 0 else { return }

                let baseOffset = gestureStartOffsetX ?? 0
                let predictedOffset = baseOffset + value.predictedEndTranslation.width
                let draggedOffset = baseOffset + value.translation.width
                let shouldDelete = draggedOffset < -actionWidth * 1.7 || predictedOffset < -actionWidth * 2.25
                let shouldReveal = predictedOffset < -actionWidth * 0.45 || draggedOffset < -actionWidth * 0.5

                if shouldDelete {
                    delete()
                    return
                }

                withAnimation(.interactiveSpring(response: 0.22, dampingFraction: 0.86)) {
                    offsetX = shouldReveal ? -actionWidth : 0
                }
            }
    }

    private func isHorizontalSwipe(_ value: DragGesture.Value) -> Bool {
        abs(value.translation.width) > abs(value.translation.height) * 1.15
    }

    private func clampedOffset(_ value: CGFloat) -> CGFloat {
        min(0, max(-actionWidth * 2.4, value))
    }

    private func close() {
        withAnimation(.interactiveSpring(response: 0.22, dampingFraction: 0.86)) {
            offsetX = 0
        }
    }

    private func delete() {
        guard !isDeleting else { return }
        isDeleting = true
        withAnimation(.easeInOut(duration: 0.12)) {
            offsetX = -actionWidth * 2.4
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            close()
            isDeleting = false
            onDelete()
        }
    }
}
