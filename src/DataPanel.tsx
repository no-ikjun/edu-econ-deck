import { useRef, useState } from 'react'
import { MAX_SCORE, PARTS } from './data/answerKey'
import { CONDITIONS, CONDITION_LABEL } from './data/grade'
import type { Results } from './data/useResults'

function toLocalInput(d: Date) {
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function DataPanel({ results, onClose }: { results: Results; onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [sheetId, setSheetId] = useState(results.sheetId)
  const { source, status, parsed, responses, summary, since } = results

  const blankCounts = PARTS.map((p) => ({ id: p.id, n: responses.filter((r) => r.blanks.includes(p.id)).length })).filter(
    (b) => b.n > 0,
  )

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <aside className="panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>결과 데이터</h2>
          <button className="ghost" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </header>

        <section>
          <h3>가져올 곳</h3>
          <label className="row">
            <input type="radio" checked={source === 'sheet'} onChange={() => results.selectSheet(sheetId)} />
            구글 시트 (5초마다 새로 읽기)
          </label>
          <div className="row indent">
            <input
              className="grow"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value.replace(/.*\/d\/([^/]+).*/, '$1'))}
              placeholder="시트 ID 또는 주소"
            />
            <button onClick={() => results.selectSheet(sheetId)}>연결</button>
          </div>
          {source === 'sheet' && (
            <p className={`note indent ${status.ok ? 'ok' : 'err'}`}>
              {status.ok
                ? `연결됨 · ${status.at?.toLocaleTimeString('ko-KR')}에 읽음`
                : status.error
                  ? `읽지 못했어요: ${status.error}${status.at ? ` · 마지막 성공 ${status.at.toLocaleTimeString('ko-KR')}` : ''}`
                  : '읽는 중…'}
              {source === 'sheet' && (
                <button className="link" onClick={() => results.refresh()}>
                  지금 새로고침
                </button>
              )}
            </p>
          )}
          <label className="row">
            <input type="radio" checked={source === 'upload'} onChange={() => file.current?.click()} />
            CSV 파일 {results.csvName && source === 'upload' ? `· ${results.csvName}` : ''}
          </label>
          <div className="row indent">
            <button onClick={() => file.current?.click()}>파일 선택</button>
            <span className="note">화면 어디에나 끌어다 놓아도 돼요</span>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) results.selectUpload(await f.text(), f.name)
                e.target.value = ''
              }}
            />
          </div>
          <label className="row">
            <input type="radio" checked={source === 'sample'} onChange={() => results.selectSample()} />
            샘플 데이터 (리허설용)
          </label>
        </section>

        <section>
          <h3>집계 시작 시각</h3>
          <p className="note">이 시각 이전 응답(테스트 제출 등)은 빼고 집계해요.</p>
          <div className="row">
            <input
              type="datetime-local"
              value={since ? toLocalInput(new Date(since)) : ''}
              onChange={(e) => results.setSince(e.target.value ? new Date(e.target.value).toISOString() : null)}
            />
            <button onClick={() => results.setSince(new Date().toISOString())}>지금부터</button>
            {since && (
              <button className="ghost" onClick={() => results.setSince(null)}>
                해제
              </button>
            )}
          </div>
        </section>

        <section>
          <h3>지금 집계</h3>
          <table className="mini">
            <thead>
              <tr>
                <th />
                <th>인원</th>
                <th>평균</th>
              </tr>
            </thead>
            <tbody>
              {CONDITIONS.map((c) => {
                const rs = summary.byCondition[c]
                const mean = rs.length ? (rs.reduce((a, r) => a + r.score, 0) / rs.length).toFixed(1) : '—'
                return (
                  <tr key={c}>
                    <td>{CONDITION_LABEL[c]}</td>
                    <td>{rs.length}</td>
                    <td>
                      {mean} / {MAX_SCORE}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="note">
            전체 {parsed.responses.length}건 중 {responses.length}건 집계
            {parsed.skipped > 0 && ` · 조를 읽지 못한 ${parsed.skipped}건 제외`}
          </p>
          {parsed.missingColumns.length > 0 && (
            <p className="note err">시트에 없는 문항 열: {parsed.missingColumns.join(', ')}</p>
          )}
          {blankCounts.length > 0 && (
            <p className="note">빈 답: {blankCounts.map((b) => `${b.id} ${b.n}건`).join(' · ')}</p>
          )}
        </section>

        <section>
          <h3>단축키</h3>
          <p className="note keys">
            → / ← 넘기기 · 숫자+Enter 이동 · F 전체화면 · D 이 창
            <br />
            타이머 슬라이드: Space 시작/일시정지 · R 처음으로
          </p>
        </section>
      </aside>
    </div>
  )
}
