import SwiftUI

struct SwipeToDeleteRow<Content: View>: View {
    private let onDelete: () -> Void
    private let content: Content

    init(
        actionWidth: CGFloat = 88,
        actionTint: Color = .red,
        onDelete: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.onDelete = onDelete
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .contextMenu {
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
            .accessibilityAction(named: Text("Delete"), onDelete)
    }
}
