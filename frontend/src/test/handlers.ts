import { http, HttpResponse } from 'msw'
import jobsSlim from './fixtures/jobs_slim.json'
import fundsList from './fixtures/funds_list.json'
import pendingProcessor from './fixtures/job_details__pending_processor_review.json'
import pendingReviewer from './fixtures/job_details__pending_reviewer_approval.json'

// Minimal handlers backed by Phase-0 fixtures. Detail route returns a fixture
// chosen by the job's status where we have one; falls back to processor review.
const detailByStatus: Record<string, unknown> = {
  pending_processor_review: pendingProcessor,
  pending_reviewer_approval: pendingReviewer,
}

export const handlers = [
  http.get('/api/jobs', () => HttpResponse.json(jobsSlim)),
  http.get('/api/funds', () => HttpResponse.json(fundsList)),
  http.get('/api/jobs/:id/details', ({ params }) => {
    const job = (jobsSlim as Array<{ job_id: string; status: string }>).find(
      (j) => j.job_id === params.id,
    )
    const fixture =
      (job && detailByStatus[job.status]) ?? pendingProcessor
    return HttpResponse.json(fixture)
  }),
  http.post('/api/jobs/create', async ({ request }) => {
    const body = (await request.json()) as { fund_id?: string }
    if (!body?.fund_id) {
      return HttpResponse.json({ error: 'fund_id required' }, { status: 400 })
    }
    return HttpResponse.json({
      status: 'started',
      job_id: 'job_test_new',
      message: 'Job created.',
    })
  }),
]
