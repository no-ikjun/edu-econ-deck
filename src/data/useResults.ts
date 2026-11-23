import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PARTS } from './answerKey'
import { CONDITION_LABEL, CONDITIONS, parseCsv, summarize, type ParseResult, type Response } from './grade'

export const DEFAULT_SHEET_ID = '1YF-k7SX1jh2KG1TmAgjwruE2-CFvjI4DzKiseO4AwCI'
const POLL_MS = 5000

type Source = 'sheet' | 'upload' | 'sample'

type Stored = {
  source: Source
  sheetId: string
  since: string | null
  csv: string | null
  csvName: string | null
}

const KEY = 'edu-econ-deck:data'

function load(): Stored {
  const fallback: Stored = { source: 'sheet', sheetId: DEFAULT_SHEET_ID, since: null, csv: null, csvName: null }
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function save(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private windows can refuse storage; the deck still works for this session.
  }
}

export function sheetCsvUrl(sheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&_=${Date.now()}`
}

/** Fake responses for rehearsing the result slides before real data arrives. */
function sampleCsv(): string {
  const header = ['타임스탬프', '이름을 알려주세요', '자신이 속한 조는?', ...PARTS.map((p) => p.id), '이번 시험의 난이도는 어땠나요?']
  const labels = { ai: 'AI 활용', helper: '학습 도우미에게 질문 가능', self: '독학' }
  const skill = { ai: 0.62, helper: 0.72, self: 0.66 }
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const rows = [header.join(',')]
  for (const c of CONDITIONS) {
    for (let i = 0; i < 8; i++) {
      const cells = PARTS.map((p) => {
        const right = rand() < skill[c]
        if (p.kind === 'choice') return right ? p.answer : ((p.answer as number) % 4) + 1
        if (p.kind === 'yesno') return right ? p.answer : '예'
        return right ? p.answer : (p.answer as number) + 10
      })
      const minute = String(10 + Math.floor(rand() * 50)).padStart(2, '0')
      rows.push([`2026. 11. 25 오후 3:${minute}:00`, `${CONDITION_LABEL[c]} ${i + 1}`, labels[c], ...cells, String(1 + Math.floor(rand() * 5))].join(','))
    }
  }
  return rows.join('\n')
}

export type Results = ReturnType<typeof useResults>

export function useResults() {
  const [stored, setStored] = useState<Stored>(load)
  const [sheetCsv, setSheetCsv] = useState<string | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; at: Date | null; error?: string }>({ ok: false, at: null })
  const timer = useRef<number | undefined>(undefined)

  const update = useCallback((patch: Partial<Stored>) => {
    setStored((s) => {
      const next = { ...s, ...patch }
      save(next)
      return next
    })
  }, [])

  const fetchSheet = useCallback(async () => {
    try {
      const res = await fetch(sheetCsvUrl(stored.sheetId), { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.trimStart().startsWith('<')) throw new Error('시트가 공개되어 있지 않아요')
      setSheetCsv(text)
      // Keep the last good copy so a reload without network still shows results.
      update({ csv: text, csvName: null })
      setStatus({ ok: true, at: new Date() })
    } catch (e) {
      setStatus((s) => ({ ok: false, at: s.at, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [stored.sheetId, update])

  useEffect(() => {
    window.clearInterval(timer.current)
    if (stored.source !== 'sheet') return
    fetchSheet()
    timer.current = window.setInterval(fetchSheet, POLL_MS)
    return () => window.clearInterval(timer.current)
  }, [stored.source, fetchSheet])

  const csv = stored.source === 'sample' ? sampleCsv() : stored.source === 'sheet' ? (sheetCsv ?? stored.csv) : stored.csv

  const parsed: ParseResult = useMemo(
    () => (csv ? parseCsv(csv) : { responses: [], skipped: 0, missingColumns: [] }),
    [csv],
  )

  const responses: Response[] = useMemo(() => {
    const since = stored.since ? new Date(stored.since) : null
    return parsed.responses.filter((r) => !since || !r.timestamp || r.timestamp >= since)
  }, [parsed, stored.since])

  const summary = useMemo(() => summarize(responses), [responses])

  return {
    source: stored.source,
    sheetId: stored.sheetId,
    since: stored.since,
    csvName: stored.csvName,
    status,
    parsed,
    responses,
    summary,
    refresh: fetchSheet,
    selectSheet: (sheetId?: string) => update({ source: 'sheet', sheetId: sheetId || stored.sheetId }),
    selectUpload: (text: string, name: string) => update({ source: 'upload', csv: text, csvName: name }),
    selectSample: () => update({ source: 'sample' }),
    setSince: (since: string | null) => update({ since }),
  }
}
