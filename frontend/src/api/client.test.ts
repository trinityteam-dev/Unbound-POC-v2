import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { ApiError, api } from './client'

describe('api.fileUrl', () => {
  it('builds a PDF stream URL and encodes the filename', () => {
    expect(api.fileUrl('job_1', 'staging', 'Accountancy - $270.41.pdf')).toBe(
      '/api/jobs/job_1/file/staging/Accountancy%20-%20%24270.41.pdf',
    )
    expect(api.fileUrl('j', 'workpaper', 'a.pdf')).toBe('/api/jobs/j/file/workpaper/a.pdf')
  })
})

describe('api request wrappers (MSW)', () => {
  it('getFunds returns the funds array', async () => {
    const funds = await api.getFunds()
    expect(Array.isArray(funds)).toBe(true)
    expect(funds[0]).toHaveProperty('id')
  })

  it('getJobDetails returns a job record with files', async () => {
    const job = await api.getJobDetails('job_x')
    expect(job).toHaveProperty('files')
    expect(job).toHaveProperty('status')
  })

  it('createJob posts and returns the new job_id', async () => {
    const res = await api.createJob({ fund_id: 'f1', job_type: 'Accounting_Audit' })
    expect(res.job_id).toBe('job_test_new')
  })

  it('setQueryStatus posts the chosen status', async () => {
    const res = (await api.setQueryStatus('j1', 'q1', { status: 'sent', query_text: 'hi' })) as {
      new_status?: string
    }
    expect(res.new_status).toBe('sent')
  })

  it('throws ApiError with the status code on a non-OK response', async () => {
    server.use(http.get('/api/funds', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    await expect(api.getFunds()).rejects.toBeInstanceOf(ApiError)
    await expect(api.getFunds()).rejects.toMatchObject({ status: 500 })
  })
})
