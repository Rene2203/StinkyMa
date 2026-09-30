import AppFeature
import MailCore
import SwiftUI

struct MessageRow: View {
    let message: Message
    let account: Account?
    let showsAccount: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            statusColumn
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if showsAccount, let account {
                        Circle()
                            .fill(account.color.color)
                            .frame(width: 8, height: 8)
                            .accessibilityLabel(Text("Konto \(account.displayName)"))
                    }
                    Text(verbatim: message.from.displayName)
                        .font(.headline)
                        .fontWeight(message.isRead ? .regular : .semibold)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if message.hasAttachments {
                        Image(systemName: "paperclip")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(Text("Mit Anhang"))
                    }
                    ListDateText(date: message.date)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(verbatim: message.subject)
                    .font(.subheadline)
                    .fontWeight(message.isRead ? .regular : .medium)
                    .lineLimit(1)
                Text(verbatim: message.snippet)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if let category = message.category {
                    CategoryChip(category: category)
                        .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("messageRow")
    }

    private var statusColumn: some View {
        VStack(spacing: 6) {
            Circle()
                .fill(message.isRead ? Color.clear : Color.accentColor)
                .frame(width: 9, height: 9)
                .accessibilityHidden(message.isRead)
                .accessibilityLabel(Text("Ungelesen"))
            if message.isFlagged {
                Image(systemName: "flag.fill")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .accessibilityLabel(Text("Markiert"))
            }
        }
        .frame(width: 12)
        .padding(.top, 5)
    }
}

/// Datum in der Liste: heute Uhrzeit, gestern „Gestern“, diese Woche Wochentag, sonst Datum.
struct ListDateText: View {
    let date: Date

    var body: some View {
        switch ListDateStyle(date: date, now: .now) {
        case .time:
            Text(date, format: .dateTime.hour().minute())
        case .yesterday:
            Text("Gestern")
        case .weekday:
            Text(date, format: .dateTime.weekday(.wide))
        case .date:
            Text(date, format: .dateTime.day().month(.twoDigits).year(.twoDigits))
        }
    }
}

struct CategoryChip: View {
    let category: MessageCategory

    var body: some View {
        Label {
            Text(category.title)
        } icon: {
            Image(systemName: category.systemImage)
        }
        .font(.caption2.weight(.medium))
        .foregroundStyle(category.tint)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(category.tint.opacity(0.12), in: Capsule())
        .accessibilityLabel(Text("Kategorie: \(Text(category.title))"))
    }
}
