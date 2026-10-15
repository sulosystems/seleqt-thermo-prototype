import { describe, expect, it } from 'vitest'
import { formatInches, formatSheetDate, formatThickness, isNonStandardThickness, qcStation } from './format'

describe('fractional inches (checked against the client cut list: mm -> inches)', () => {
  // [mm shown on the sheet, inches shown on the sheet]
  it.each([
    [454, '17 7/8'], [302, '11 7/8'], [759, '29 7/8'], [606, '23 7/8'], [340, '13 3/8'],
    [149, '5 7/8'], [572, '22 1/2'], [419, '16 1/2'], [570, '22 7/16'], [83, '3 1/4'], [127, '5'], [914, '36'],
  ])('%d mm -> %s in', (mm, text) => {
    expect(formatInches(mm / 25.4)).toBe(text)
  })

  it('formats whole numbers, bare fractions and decimals', () => {
    expect(formatInches(54)).toBe('54')
    expect(formatInches(0.75)).toBe('3/4')
    expect(formatInches(17.5)).toBe('17 1/2')
    expect(formatInches(17.0625)).toBe('17 1/16')
  })

  it('rounds to the nearest 1/16 and carries into the whole number', () => {
    expect(formatInches(17.99)).toBe('18')
    expect(formatInches(10.03)).toBe('10')
  })

  it('returns blank for zero or invalid values', () => {
    expect(formatInches(0)).toBe('')
    expect(formatInches(NaN)).toBe('')
    expect(formatInches(-2)).toBe('')
  })
})

describe('thickness', () => {
  it('shows fractions and passes text through', () => {
    expect(formatThickness(0.75)).toBe('3/4')
    expect(formatThickness(0.625)).toBe('5/8')
    expect(formatThickness(0.6875)).toBe('11/16')
    expect(formatThickness(1.25)).toBe('1 1/4')
    expect(formatThickness('NA/None')).toBe('NA/None')
  })
  it('flags anything other than 3/4 (the highlighted 5/8 on the sheet)', () => {
    expect(isNonStandardThickness(0.75)).toBe(false)
    expect(isNonStandardThickness(0.625)).toBe(true)
    expect(isNonStandardThickness('NA/None')).toBe(false)
  })
})

describe('sheet dates', () => {
  it('matches the sheet style', () => {
    expect(formatSheetDate('2026-05-29')).toBe('MAY 29-2026')
    expect(formatSheetDate('2026-06-11')).toBe('JUNE 11-2026')
    expect(formatSheetDate('2026-08-07')).toBe('AUGUST 7-2026')
  })
  it('is blank for empty or invalid input', () => {
    expect(formatSheetDate('')).toBe('')
    expect(formatSheetDate('nonsense')).toBe('')
  })
})

describe('QC sign-off stations (rows 2, 6, 10, 14 on the sheet)', () => {
  it('cycles CNC, SAND, SPRAY, PRESS every 4th row', () => {
    expect([2, 6, 10, 14, 18, 22].map(qcStation)).toEqual(['CNC', 'SAND', 'SPRAY', 'PRESS', 'CNC', 'SAND'])
  })
  it('leaves other rows without a station', () => {
    expect([1, 3, 4, 5, 7, 8, 9].map(qcStation)).toEqual([null, null, null, null, null, null, null])
  })
})
