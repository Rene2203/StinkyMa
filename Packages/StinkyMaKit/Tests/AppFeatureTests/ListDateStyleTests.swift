import AppFeature
import Foundation
import Testing

@Suite("Datumsdarstellung in der Liste")
struct ListDateStyleTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Berlin") ?? .gmt
        return calendar
    }

    func date(_ day: Int, _ hour: Int) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour)) ?? .distantPast
    }

    @Test func classifiesRelativeToNow() {
        let now = date(29, 10) // Dienstag, 29.09.2026, 10 Uhr
        #expect(ListDateStyle(date: date(29, 1), now: now, calendar: calendar) == .time)
        #expect(ListDateStyle(date: date(28, 23), now: now, calendar: calendar) == .yesterday)
        #expect(ListDateStyle(date: date(24, 12), now: now, calendar: calendar) == .weekday)
        #expect(ListDateStyle(date: date(23, 0), now: now, calendar: calendar) == .weekday)
        #expect(ListDateStyle(date: date(22, 23), now: now, calendar: calendar) == .date)
        #expect(ListDateStyle(date: date(30, 9), now: now, calendar: calendar) == .date)
    }
}
