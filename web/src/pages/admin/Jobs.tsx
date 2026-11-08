import { useState } from 'react';
import { getJobs, type JobStatus, retryJob } from '../../api/client';
import { useRemote } from '../../hooks/useRemote';
import { formatDate } from '../../lib/orderText';
import { RemoteView } from './RemoteView';

const LABEL: Record<JobStatus, string> = { PENDING: 'Waiting', RUNNING: 'Running', DONE: 'Done', DEAD: 'Failed' };

/** Background jobs (emails for now). Message contents are never shown; failed jobs can be retried. */
export function Jobs() {
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const jobs = useRemote((s) => getJobs(status, s), `jobs:${status}:${version}`);
  return (
    <>
      <div className="admin-toolbar">
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as JobStatus | '')}>
            <option value="">All</option>
            {(Object.keys(LABEL) as JobStatus[]).map((s) => (
              <option key={s} value={s}>
                {LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && (
        <p className={`notice${message.ok ? '' : ' notice--bad'}`} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <RemoteView state={jobs}>
        {(data) => (
          <>
            <ul className="tiles tiles--stats">
              {(Object.keys(LABEL) as JobStatus[]).map((s) => (
                <li key={s}>
                  <span className="tile__label">{LABEL[s]}</span>
                  <strong className="tile__value">{data.counts[s]}</strong>
                </li>
              ))}
            </ul>
            {data.items.length === 0 ? (
              <p className="notice">No jobs here.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Background jobs</caption>
                  <thead>
                    <tr>
                      <th scope="col">Created</th>
                      <th scope="col">Type</th>
                      <th scope="col">Status</th>
                      <th scope="col">Attempts</th>
                      <th scope="col">Last error</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((j) => (
                      <tr key={j.id}>
                        <td className="nowrap">{formatDate(j.createdAt)}</td>
                        <th scope="row" className="code">
                          {j.type}
                        </th>
                        <td>{LABEL[j.status]}</td>
                        <td className="num">
                          {j.attempts}/{j.maxAttempts}
                        </td>
                        <td className="small">{j.lastError ?? '—'}</td>
                        <td>
                          {j.status === 'DEAD' && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              onClick={() =>
                                void retryJob(j.id)
                                  .then(() => {
                                    setMessage({ ok: true, text: 'The job will run again shortly.' });
                                    setVersion((v) => v + 1);
                                  })
                                  .catch((e: unknown) => setMessage({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong' }))
                              }
                            >
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </RemoteView>
    </>
  );
}
