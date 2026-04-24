import Holidays from 'date-holidays'

export type Assignment = {
  dateKey: string
  date: Date
  child: string
}

const huHolidays = new Holidays('HU')

function isPublicHoliday(date: Date): boolean {
  const holidayData = huHolidays.isHoliday(date)
  if (!holidayData) {
    return false
  }
  const holidays = Array.isArray(holidayData) ? holidayData : [holidayData]
  return holidays.some((holiday) => holiday.type === 'public')
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function getMonthWorkingDays(
  year: number,
  monthIndex: number,
  extraOffDays: Set<string>,
): Date[] {
  const days: Date[] = []
  const current = new Date(year, monthIndex, 1)

  while (current.getMonth() === monthIndex) {
    const isWeekday = current.getDay() >= 1 && current.getDay() <= 5
    const dateKey = toDateKey(current)
    const isHoliday = isPublicHoliday(current)
    const isExtraOff = extraOffDays.has(dateKey)

    if (isWeekday && !isHoliday && !isExtraOff) {
      days.push(new Date(current))
    }

    current.setDate(current.getDate() + 1)
  }

  return days
}

export function generateAssignments(params: {
  children: string[]
  monthWorkingDays: Date[]
  startChild: string
  manualOverrides: Record<string, string>
  excludedChildren?: string[]
}): {
  assignments: Assignment[]
  nextStartChild: string
} {
  const { children, monthWorkingDays, startChild, manualOverrides, excludedChildren = [] } = params
  const clean = children.filter((name) => name.trim().length > 0)

  if (clean.length === 0) {
    return { assignments: [], nextStartChild: '' }
  }

  const excluded = new Set(excludedChildren)

  const findNextAllowedIndex = (fromIndex: number): number => {
    for (let step = 0; step < clean.length; step += 1) {
      const idx = (fromIndex + step) % clean.length
      if (!excluded.has(clean[idx])) {
        return idx
      }
    }
    return -1
  }

  let currentIndex = Math.max(clean.indexOf(startChild), 0)

  const assignments = monthWorkingDays.map((date) => {
    const dateKey = toDateKey(date)
    const overrideChild = manualOverrides[dateKey]
    const overrideIndex = overrideChild ? clean.indexOf(overrideChild) : -1
    const hasValidOverride = overrideIndex >= 0
    const allowedIndex = findNextAllowedIndex(currentIndex)
    const plannedChild = allowedIndex >= 0 ? clean[allowedIndex] : ''
    const assignedChild = hasValidOverride ? overrideChild : plannedChild

    if (assignedChild) {
      const assignedIndex = clean.indexOf(assignedChild)
      currentIndex = (assignedIndex + 1) % clean.length
    } else {
      currentIndex = (currentIndex + 1) % clean.length
    }

    return { dateKey, date, child: assignedChild }
  })

  const nextStartChild = clean[currentIndex]

  return { assignments, nextStartChild }
}

export function addOneMonth(year: number, monthIndex: number): {
  year: number
  monthIndex: number
} {
  if (monthIndex === 11) {
    return { year: year + 1, monthIndex: 0 }
  }
  return { year, monthIndex: monthIndex + 1 }
}

export function monthLabel(year: number, monthIndex: number): string {
  const huMonths = [
    'január',
    'február',
    'március',
    'április',
    'május',
    'június',
    'július',
    'augusztus',
    'szeptember',
    'október',
    'november',
    'december',
  ]
  return `${year}. ${huMonths[monthIndex]}`
}
