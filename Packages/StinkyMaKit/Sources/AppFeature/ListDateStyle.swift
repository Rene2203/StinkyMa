import Foundation

/// Wie ein Datum in der Mail-Liste erscheint: heute nur die Uhrzeit, gestern als „Gestern“,
/// in der letzten Woche als Wochentag, sonst als Datum. Die Formatierung selbst macht die UI.
public enum ListDateStyle: Equatable, Sendable {
    case time
    case yesterday
    case weekday
    case date

    public init(date: Date, now: Date, calendar: Calendar = .current) {
        if calendar.isDate(date, inSameDayAs: now) {
            self = .time
        } else if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
                  calendar.isDate(date, inSameDayAs: yesterday) {
            self = .yesterday
        } else if let weekAgo = calendar.date(byAdding: .day, value: -6, to: calendar.startOfDay(for: now)),
                  date >= weekAgo, date < now {
            self = .weekday
        } else {
            self = .date
        }
    }
}
